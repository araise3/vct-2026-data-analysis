"""
Builds public/data/player_act_stats.json -- each linked player's PERSONAL
ranked-ladder stats for the current VALORANT Act, from HenrikDev's
unofficial VALORANT API (a thin wrapper over Riot's own in-game API;
docs.henrikdev.xyz), keyed by the puuids src/lib/trackerLinks.json already
carries.

WHY THIS EXISTS / WHY NOT tracker.gg
-------------------------------------
The goal was "show the same Act stats tracker.gg shows on a player's
profile". tracker.gg itself is not an option: their public developer API
covers only Apex Legends and The Division 2 (no VALORANT), and their staff
have explicitly answered this exact question -- reading the internal
api.tracker.gg endpoints their own site calls is "scraping; it's not
something we offer for public use", with Cloudflare bot-protection actively
enforcing it (community wrappers need a full FlareSolverr headless-browser
proxy just to get a response). Riot's own VALORANT API is also out: no
personal keys are issued for VALORANT at all, and match/stat endpoints
require a production key PLUS each individual player completing a Riot
Sign-On OAuth consent -- unworkable for an aggregator showing hundreds of
players who aren't sitting there authorising it.

HenrikDev is the same API this repo already uses for tracker-link upkeep
(data_prep/resolve_tracker_puuids.py, same HENRIKDEV_API_KEY secret), so
this adds no new trust decision or credential.

NO PRE-AGGREGATED "ACT STATS" FIELD EXISTS -- THIS SUMS MATCHES
----------------------------------------------------------------
Checked the full OpenAPI spec (api.henrikdev.xyz/openapi.json, 57 paths):
nothing returns a ready-made per-Act win%/K-D/ACS/HS% summary. MMR
endpoints give rank/RR progression only; leaderboards give ladder position;
match endpoints give raw per-match records. So this script aggregates match
records itself -- which is only worth doing because of the incremental
cache below (a full re-sum every run would not be).

Two things make the aggregation cheap and correct:
  - `metadata.season` on every v4 match carries BOTH `id` (the Act's uuid)
    and `short` (a human label) -- so the Act boundary is a real field on
    the data, not something inferred from dates, and no separate
    /v1/content lookup is needed to name it.
  - Raw counters are stored, not percentages (kills/deaths/score/rounds/
    headshots/...), and every displayed rate is divided out at the end.
    That's the same sum-first-divide-later rule the site's own bucket model
    already follows (see CLAUDE.md) -- and here it's also what makes the
    incremental cache arithmetically sound: new matches just add into the
    stored counters. Averaging percentages across runs could not work.

INCREMENTAL BY DEFAULT
-----------------------
Each player's stored record keeps `newestMatchId`. On the next run, paging
stops the moment that id reappears, so a scheduled run costs only "how many
ranked games has this player queued since last time" -- not their whole Act
history. The expensive full pass happens once per player (first run, or
when a new Act starts and the stored `actId` no longer matches, which
resets that player's counters). `--full` forces a rebuild.

RATE LIMITING -- DRIVEN BY THE RESPONSE HEADERS, NOT A GUESSED SLEEP
---------------------------------------------------------------------
The API advertises its own limit state. Confirmed against the live endpoint
(its `access-control-expose-headers` lists exactly these):
    RateLimit-Limit / RateLimit-Remaining / RateLimit-Reset
    X-RateLimit-Limit / X-RateLimit-Remaining / X-RateLimit-Reset
    X-RateLimit-Bucket, X-Request-ID, X-Version
`_RateLimiter` below reads Remaining/Reset off EVERY response (including
error responses -- urllib's HTTPError still carries headers) and, once
Remaining drops to RATE_LIMIT_FLOOR, sleeps until the advertised Reset
rather than continuing and eating a 429. A 429 that happens anyway is
honoured via `Retry-After`. This is why the script doesn't hardcode a
requests-per-minute number: the free tier's limit isn't documented as a
fixed figure, and an Advanced Key raises it -- reading the headers adapts
to whichever key it's run with instead of pessimistically pacing for the
smaller one.

USAGE
-----
    python data_prep/fetch_act_stats.py
    python data_prep/fetch_act_stats.py --inspect aspas
    python data_prep/fetch_act_stats.py --limit 5        # smoke test
    python data_prep/fetch_act_stats.py --full           # ignore cache

Requires HENRIKDEV_API_KEY (same GitHub Actions secret
resolve_tracker_puuids.py uses; never committed). Standard library only, so
the workflow needs no pip install.

SCOPE CAVEATS (deliberate, and surfaced in the UI)
---------------------------------------------------
  - These are SOLO/personal competitive ladder games, a completely
    different population from the VLR-sourced pro-match stats the rest of
    the site shows. The frontend labels them separately for that reason;
    they are not comparable numbers and must never be merged.
  - Only the FIRST account per handle (trackerLinks.json's "main", see that
    file's own comment) is aggregated. Alts are separate ladder accounts
    with their own MMR -- summing them together would be meaningless.
  - HenrikDev's region enum is na/eu/ap/kr; there is no China region, so
    CN-server players resolve to nothing here. That mirrors the China data
    gaps this project already documents elsewhere.
  - No dedicated `kast` field on this schema -- confirmed against the full
    OpenAPI spec, it only exists as a precomputed field on the Esports
    endpoints (real VCT match data), never on the regular match/player-stats
    schema personal games use. It IS derivable by hand, though: each v4
    match object carries top-level `kills[]` (round, timestamp, killer,
    victim, assistants) and `rounds[]` (per-player per-round participation)
    -- everything KAST's own K/A/S/T definition needs. See
    `_round_kast_participants()` below for the derivation this script
    actually does with them.

RANK / RR / LEADERBOARD
-------------------------
One extra call per player (`/v3/by-puuid/mmr/...`) gets current tier, RR,
and leaderboard placement all in one response -- `current.leaderboard_placement`
is null off the board, `{rank, updated_at}` on it, so no separate
leaderboard search is needed. Refreshed on EVERY run regardless of the
incremental match cache: RR changes after every single game, so gating it
behind "only fetch what's new" (correct for match history) would leave it
stale.
"""
import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone

_REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LINKS_PATH = os.path.join(_REPO_ROOT, "src", "lib", "trackerLinks.json")
OUT_PATH = os.path.join(_REPO_ROOT, "public", "data", "player_act_stats.json")

API_BASE = "https://api.henrikdev.xyz/valorant"
PLATFORM = "pc"
QUEUE_MODE = "competitive"

# Matches per page. Not a documented maximum (the OpenAPI spec declares
# `size` as a bare integer with no min/max), so this is a deliberately
# conservative page size rather than a limit-probing one -- the incremental
# cache means the steady-state run reads well under one page per player
# anyway, and a smaller page costs nothing but makes a first-run backfill
# take a few more requests.
PAGE_SIZE = 10
# Hard stop on how deep a single player's backfill will page. An Act is
# ~2 months; nobody's competitive history for one Act legitimately runs past
# this, so hitting it means something is wrong (bad `mode` filter, an Act id
# that never stops matching) and the run should give up on that player
# rather than page forever burning rate limit.
MAX_PAGES_PER_PLAYER = 30

# Pause once the API says this few requests remain in the current window,
# instead of spending the last of them and risking a 429 mid-run. 3 leaves
# room for an in-flight retry.
RATE_LIMIT_FLOOR = 3
# Floor between requests even when the headers say there's plenty of room --
# politeness, matching resolve_tracker_puuids.py's own REQUEST_DELAY_S.
MIN_REQUEST_INTERVAL_S = 1.1
MAX_RETRIES = 4


class _RateLimiter:
    """Paces requests off the API's own advertised limit headers.

    Header names confirmed against the live endpoint's
    `access-control-expose-headers` (see the module docstring). Both the
    unprefixed (`RateLimit-*`, the IETF draft spelling) and `X-` prefixed
    spellings are read, since the API exposes both and which one is
    actually populated isn't documented.
    """

    def __init__(self):
        self.remaining = None
        self.reset_at = None
        self.limit = None
        self._last_request_at = 0.0

    @staticmethod
    def _header_int(headers, *names):
        for n in names:
            v = headers.get(n)
            if v is None:
                continue
            try:
                return int(float(v))
            except (TypeError, ValueError):
                continue
        return None

    def observe(self, headers):
        """Records the limit state from a response's headers."""
        self.limit = self._header_int(headers, "RateLimit-Limit", "X-RateLimit-Limit") or self.limit
        remaining = self._header_int(headers, "RateLimit-Remaining", "X-RateLimit-Remaining")
        reset = self._header_int(headers, "RateLimit-Reset", "X-RateLimit-Reset")
        if remaining is not None:
            self.remaining = remaining
        if reset is not None:
            # `Reset` is documented nowhere as either "seconds from now" or
            # "absolute unix timestamp", and the two are trivially
            # distinguishable: a delta is a small number, an epoch timestamp
            # is ~1.7e9. Treating a delta as an epoch would compute a
            # sleep of zero (harmless); treating an epoch as a delta would
            # sleep for ~54 years (not harmless), hence the explicit check.
            self.reset_at = float(reset) if reset > 10_000_000 else time.time() + reset

    def wait_before_request(self):
        """Sleeps as long as the advertised limit state requires."""
        elapsed = time.time() - self._last_request_at
        if elapsed < MIN_REQUEST_INTERVAL_S:
            time.sleep(MIN_REQUEST_INTERVAL_S - elapsed)

        if self.remaining is not None and self.remaining <= RATE_LIMIT_FLOOR and self.reset_at:
            sleep_for = self.reset_at - time.time()
            if sleep_for > 0:
                print(f"  [rate limit] {self.remaining} left; sleeping {sleep_for:.1f}s until reset")
                time.sleep(sleep_for + 0.5)
                # Window has rolled over; assume budget is restored and let
                # the next response's own headers correct this.
                self.remaining = None
                self.reset_at = None
        self._last_request_at = time.time()

    def note_spent(self):
        """Optimistically decrements between responses, so a burst can't
        overshoot the floor if a response omits the headers entirely."""
        if self.remaining is not None:
            self.remaining -= 1


class ApiError(Exception):
    pass


class Client:
    def __init__(self, api_key):
        self.api_key = api_key
        self.limiter = _RateLimiter()

    def get(self, path, params=None):
        url = f"{API_BASE}{path}"
        if params:
            url += "?" + urllib.parse.urlencode(params)

        for attempt in range(1, MAX_RETRIES + 1):
            self.limiter.wait_before_request()
            req = urllib.request.Request(url, headers={
                "Authorization": self.api_key,
                "Accept": "application/json",
                "User-Agent": "vct-2026-data-analysis/1.0 (act-stats)",
            })
            try:
                with urllib.request.urlopen(req, timeout=25) as resp:
                    self.limiter.observe(resp.headers)
                    self.limiter.note_spent()
                    return json.load(resp)
            except urllib.error.HTTPError as e:
                # HTTPError still carries the response headers, so the
                # limiter learns from a rejection exactly as it does from a
                # success -- which is the whole point on a 429.
                self.limiter.observe(e.headers)
                if e.code == 429:
                    retry_after = self.limiter._header_int(e.headers, "Retry-After")
                    wait = retry_after if retry_after is not None else min(60, 2 ** attempt)
                    print(f"  [429] rate limited; waiting {wait}s (attempt {attempt})", file=sys.stderr)
                    time.sleep(wait + 0.5)
                    continue
                if e.code == 404:
                    return None
                if 500 <= e.code < 600:
                    time.sleep(2 ** attempt)
                    continue
                raise ApiError(f"HTTP {e.code} for {path}")
            except Exception as e:  # noqa: BLE001 -- transient network errors
                print(f"  [error] {path}: {e} (attempt {attempt})", file=sys.stderr)
                time.sleep(2 ** attempt)
        raise ApiError(f"failed after {MAX_RETRIES} attempts: {path}")


def load_links():
    with open(LINKS_PATH, encoding="utf-8") as f:
        return json.load(f)


def load_existing():
    if os.path.exists(OUT_PATH):
        with open(OUT_PATH, encoding="utf-8") as f:
            return json.load(f)
    return {"_meta": {}, "players": {}}


def save(out):
    os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
    with open(OUT_PATH, "w", encoding="utf-8") as f:
        json.dump(out, f, indent=2, ensure_ascii=False, sort_keys=True)
        f.write("\n")


def blank_counters():
    return {
        "matches": 0, "wins": 0, "losses": 0, "draws": 0, "rounds": 0,
        "kills": 0, "deaths": 0, "assists": 0, "score": 0,
        "headshots": 0, "bodyshots": 0, "legshots": 0, "damage": 0,
        # Damage RECEIVED, not just dealt -- `damage` above is ADR's own
        # numerator; this is the second half needed for tracker.gg's real
        # "Damage Delta/Round" (see derive()'s own comment on why this
        # matters -- it's a genuinely different stat from ADR, not ADR
        # under another name).
        "damageReceived": 0,
        # KAST's own two counters -- see _round_kast_participants(). Kept
        # separate from `rounds` above (that one comes from team round
        # totals) since kastEligibleRounds is however many rounds this
        # match's own `rounds[]` array actually lists this player as having
        # played, which is the correct KAST denominator even on a rare
        # match where the two counts would otherwise disagree (e.g. a
        # remake).
        "kastRounds": 0, "kastEligibleRounds": 0,
    }


# Commonly cited across community KAST explainers (VLR/tracker writeups) as
# the window a trade must land within; Riot has never published an exact
# figure. Chosen as the conservative end of the "3-5s" range typically
# quoted, rather than guessed.
TRADE_WINDOW_MS = 5000


def _round_kast_participants(match, puuid):
    """Returns (kast_qualifying_round_ids, total_round_ids) for one player
    in one match, or (None, None) if this match's data doesn't cover them
    (e.g. an unreadable/partial match already skipped by accumulate()).

    There's no dedicated `kast` field on this schema (see module docstring),
    but `match['kills']` and `match['rounds']` together carry everything
    KAST's own definition needs: a round counts if the player got a Kill,
    an Assist, Survived to round end, or was killed but a teammate killed
    that same killer within TRADE_WINDOW_MS (Traded). Meeting more than one
    of these in the same round still only counts once, per KAST's own
    definition -- this returns a set of round ids for exactly that reason
    (adding the same id twice is a no-op).
    """
    rounds = match.get("rounds") or []
    kills = match.get("kills") or []
    if not rounds:
        return None, None

    # Which team this player was on -- needed to know who a "teammate" is
    # for trade purposes. Read off any kill/death event this player
    # appears in rather than match['players'], so this function only
    # depends on the two arrays it's already walking.
    my_team = None
    for k in kills:
        killer, victim = k.get("killer") or {}, k.get("victim") or {}
        if killer.get("puuid") == puuid:
            my_team = killer.get("team")
            break
        if victim.get("puuid") == puuid:
            my_team = victim.get("team")
            break
    if my_team is None:
        return None, None

    total_round_ids = {
        r.get("id") for r in rounds
        if any((s.get("player") or {}).get("puuid") == puuid for s in (r.get("stats") or []))
    }
    if not total_round_ids:
        return None, None

    kills_by_round = {}
    for k in kills:
        kills_by_round.setdefault(k.get("round"), []).append(k)

    qualifying = set()
    for round_id in total_round_ids:
        events = kills_by_round.get(round_id, [])
        got_kill_or_assist = False
        died_at = None
        killer_puuid = None
        for k in events:
            killer = k.get("killer") or {}
            victim = k.get("victim") or {}
            assistants = k.get("assistants") or []
            if killer.get("puuid") == puuid or any(a.get("puuid") == puuid for a in assistants):
                got_kill_or_assist = True
                break
            if victim.get("puuid") == puuid:
                died_at = k.get("time_in_round_in_ms")
                killer_puuid = killer.get("puuid")

        if got_kill_or_assist or died_at is None:
            # Either a K/A this round, or no death recorded at all -- the
            # latter means they survived to round end.
            qualifying.add(round_id)
            continue

        # Died with no kill/assist of their own this round -- qualifies
        # only if a teammate traded their killer within the window.
        for k2 in events:
            k2_killer = k2.get("killer") or {}
            k2_victim = k2.get("victim") or {}
            t2 = k2.get("time_in_round_in_ms")
            if (k2_victim.get("puuid") == killer_puuid
                    and k2_killer.get("team") == my_team
                    and t2 is not None and died_at is not None
                    and t2 >= died_at and t2 - died_at <= TRADE_WINDOW_MS):
                qualifying.add(round_id)
                break

    return qualifying, total_round_ids


def accumulate(counters, match, puuid):
    """Folds one v4 match into `counters`. Returns False if the match
    couldn't be read (missing player row / malformed), so the caller can
    count it rather than silently treating it as a zero-stat game."""
    players = (match.get("players") or [])
    me = next((p for p in players if p.get("puuid") == puuid), None)
    if not me:
        return False
    stats = me.get("stats") or {}
    if stats.get("kills") is None:
        return False

    teams = match.get("teams") or []
    my_team = next((t for t in teams if t.get("team_id") == me.get("team_id")), None)

    # Total rounds in the match = this team's won + lost. Needed as the ACS
    # denominator (Riot's `score` is a match TOTAL combat score, and ACS is
    # that averaged per round) -- there's no rounds field on the player.
    rounds = 0
    if my_team:
        r = my_team.get("rounds") or {}
        rounds = (r.get("won") or 0) + (r.get("lost") or 0)

    counters["matches"] += 1
    counters["rounds"] += rounds
    counters["kills"] += stats.get("kills") or 0
    counters["deaths"] += stats.get("deaths") or 0
    counters["assists"] += stats.get("assists") or 0
    counters["score"] += stats.get("score") or 0
    counters["headshots"] += stats.get("headshots") or 0
    counters["bodyshots"] += stats.get("bodyshots") or 0
    counters["legshots"] += stats.get("legshots") or 0
    counters["damage"] += ((stats.get("damage") or {}).get("dealt") or 0)
    counters["damageReceived"] += ((stats.get("damage") or {}).get("received") or 0)

    kast_rounds, kast_eligible = _round_kast_participants(match, puuid)
    if kast_rounds is not None:
        counters["kastRounds"] += len(kast_rounds)
        counters["kastEligibleRounds"] += len(kast_eligible)

    if my_team is not None:
        if my_team.get("won"):
            counters["wins"] += 1
        else:
            r = my_team.get("rounds") or {}
            # `won` is false for BOTH teams on a draw, so a draw is only
            # distinguishable by equal round counts -- without this check
            # every draw would be miscounted as a loss.
            if (r.get("won") or 0) == (r.get("lost") or 0):
                counters["draws"] += 1
            else:
                counters["losses"] += 1
    return True


def derive(counters):
    """Divides the raw counters out into display rates. Every rate is
    computed from the totals here, never averaged from per-match rates."""
    m = counters["matches"]
    rounds = counters["rounds"]
    shots = counters["headshots"] + counters["bodyshots"] + counters["legshots"]
    decided = counters["wins"] + counters["losses"]
    return {
        "winPct": (counters["wins"] / decided) if decided else None,
        "kd": (counters["kills"] / counters["deaths"]) if counters["deaths"] else None,
        "acs": (counters["score"] / rounds) if rounds else None,
        "adr": (counters["damage"] / rounds) if rounds else None,
        # tracker.gg's real "DDΔ/Round" -- confirmed against their own live
        # tooltip: "Damage Dealt - Damage Received, averaged over Rounds
        # played". A self-contained per-player stat, NOT a comparison
        # against the opposing team's own average (the earlier, wrong
        # assumption this pipeline was built on -- see this module's own
        # "WHY ADR STANDS IN" note, since corrected). Genuinely different
        # from ADR: two players with identical ADR can have very different
        # DDΔ if one takes far more damage than the other on the way to it.
        "ddDelta": ((counters["damage"] - counters["damageReceived"]) / rounds) if rounds else None,
        "hsPct": (counters["headshots"] / shots) if shots else None,
        # See _round_kast_participants() -- derived from raw kill/round
        # events, not a field the API provides directly. None (not 0) for a
        # player whose matches were all fetched/cached before this field
        # existed, until a --full re-run backfills kastEligibleRounds.
        "kast": (counters["kastRounds"] / counters["kastEligibleRounds"]) if counters.get("kastEligibleRounds") else None,
        "kpr": (counters["kills"] / rounds) if rounds else None,
        "kda": ((counters["kills"] + counters["assists"]) / counters["deaths"]) if counters["deaths"] else None,
        "avgKills": (counters["kills"] / m) if m else None,
    }


def fetch_region(client, puuid):
    data = client.get(f"/v1/by-puuid/account/{puuid}")
    return ((data or {}).get("data") or {}).get("region")


def fetch_rank(client, region, puuid):
    """Current competitive tier/RR + leaderboard placement, if the player is
    ranked on it -- one MMR v3 call gives all three, no separate leaderboard
    lookup needed (confirmed against the schema: `current.leaderboard_placement`
    is null off the board, {rank, updated_at} on it). Fetched on EVERY run,
    not gated by the incremental match cache -- RR moves after every game,
    so it would go stale under the same "only fetch what's new" logic that's
    correct for match history."""
    data = client.get(f"/v3/by-puuid/mmr/{region}/{PLATFORM}/{puuid}")
    current = ((data or {}).get("data") or {}).get("current") or {}
    if not current:
        return None
    tier = current.get("tier") or {}
    placement = current.get("leaderboard_placement") or {}
    return {
        "tier": tier.get("name"),
        "rr": current.get("rr"),
        "leaderboardRank": placement.get("rank"),
    }


def fetch_player(client, handle, riot_id, puuid, prev, full):
    """Aggregates one account's current-Act competitive stats.

    Paging stops at whichever comes first: a match from a different Act
    (the Act boundary -- a real field, `metadata.season.id`), the
    previously-seen newest match id (the incremental cache), or an empty
    page.
    """
    region = (prev or {}).get("region")
    if not region:
        region = fetch_region(client, puuid)
        if not region:
            return None, "no region"

    rank = fetch_rank(client, region, puuid)

    prev_newest = None if full else (prev or {}).get("newestMatchId")
    prev_act = (prev or {}).get("actId")

    counters = None
    act_id = None
    act_short = None
    newest_match_id = None
    unreadable = 0
    hit_cache = False
    # Guards against a live-list drift: `start=N` pagination assumes the
    # list is stable across requests, but a single player's fetch can span
    # 20+ paginated requests (a top pro's Act history easily runs past 200
    # matches) -- tens of seconds, comfortably enough for an actively
    # laddering account to finish another ranked game mid-fetch. When that
    # happens the newest-first list shifts by one, and the next page
    # re-serves the boundary match the previous page already processed.
    # Confirmed concretely by simulation: one live insertion during a fetch
    # produces exactly one duplicated row AND silently drops the genuinely
    # new match (it landed before the page that would have covered it was
    # fetched) -- net effect on the stored count is +1 relative to the true
    # number of distinct matches actually captured. `seen_match_ids` makes
    # a repeated row a no-op instead of counting it twice.
    seen_match_ids = set()

    for page in range(MAX_PAGES_PER_PLAYER):
        resp = client.get(
            f"/v4/by-puuid/matches/{region}/{PLATFORM}/{puuid}",
            {"mode": QUEUE_MODE, "size": PAGE_SIZE, "start": page * PAGE_SIZE},
        )
        matches = (resp or {}).get("data") or []
        if not matches:
            break

        for match in matches:
            meta = match.get("metadata") or {}
            season = meta.get("season") or {}
            sid = season.get("id")
            match_id = meta.get("match_id")

            if match_id and match_id in seen_match_ids:
                continue
            if match_id:
                seen_match_ids.add(match_id)

            if act_id is None and sid:
                act_id = sid
                act_short = season.get("short")
                # A new Act invalidates the stored counters entirely --
                # they belong to the previous Act, and adding this Act's
                # matches onto them would silently blend two seasons.
                if prev_act and prev_act != act_id:
                    prev_newest = None
                    counters = blank_counters()
                elif prev_newest and prev:
                    counters = {k: prev.get(k, 0) for k in blank_counters()}
                else:
                    counters = blank_counters()

            # Past the Act boundary -- everything older belongs to a
            # previous season, so stop rather than keep paging.
            if sid and act_id and sid != act_id:
                return _finish(counters, act_id, act_short, newest_match_id or prev_newest,
                               region, riot_id, unreadable, rank), None

            if prev_newest and match_id == prev_newest:
                hit_cache = True
                break

            if newest_match_id is None:
                newest_match_id = match_id
            if counters is None:
                counters = blank_counters()
            if not accumulate(counters, match, puuid):
                unreadable += 1

        if hit_cache:
            break
        if len(matches) < PAGE_SIZE:
            break

    if counters is None:
        return None, "no competitive matches this act"
    return _finish(counters, act_id, act_short, newest_match_id or prev_newest,
                   region, riot_id, unreadable, rank), None


def _finish(counters, act_id, act_short, newest_match_id, region, riot_id, unreadable, rank=None):
    if counters is None:
        counters = blank_counters()
    rec = dict(counters)
    rec.update(derive(counters))
    if rank:
        rec["rank"] = rank
    rec.update({
        "riotId": riot_id,
        "region": region,
        "actId": act_id,
        "actShort": act_short,
        "newestMatchId": newest_match_id,
        "updatedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    })
    if unreadable:
        rec["unreadableMatches"] = unreadable
    return rec


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--inspect", nargs="+", metavar="HANDLE",
                    help="Fetch specific handles and print the result, no write.")
    ap.add_argument("--limit", type=int, default=None, help="Only process the first N linked players.")
    ap.add_argument("--full", action="store_true",
                    help="Ignore the incremental cache and re-sum each player's whole current Act.")
    args = ap.parse_args()

    api_key = os.environ.get("HENRIKDEV_API_KEY")
    if not api_key:
        print("[FATAL] HENRIKDEV_API_KEY not set.", file=sys.stderr)
        return 1

    client = Client(api_key)
    links = load_links()
    out = load_existing()
    players = out.setdefault("players", {})

    # First (main) account only -- see the module docstring.
    targets = []
    for handle, accounts in sorted(links.items()):
        if not accounts:
            continue
        main_account = accounts[0]
        if not main_account.get("puuid"):
            continue
        targets.append((handle, main_account["riotId"], main_account["puuid"]))

    if args.inspect:
        wanted = {h.lower() for h in args.inspect}
        targets = [t for t in targets if t[0].lower() in wanted]
    if args.limit:
        targets = targets[:args.limit]

    print(f"Fetching current-Act stats for {len(targets)} linked account(s).")
    ok = skipped = failed = 0

    for i, (handle, riot_id, puuid) in enumerate(targets, start=1):
        try:
            rec, err = fetch_player(client, handle, riot_id, puuid, players.get(handle), args.full)
        except ApiError as e:
            print(f"  [warn] {handle}: {e}", file=sys.stderr)
            failed += 1
            continue
        if rec is None:
            print(f"  [skip] {handle}: {err}")
            skipped += 1
            continue
        players[handle] = rec
        ok += 1
        if args.inspect:
            r = rec.get("rank") or {}
            rank_str = f"{r.get('tier')} {r.get('rr')}RR" + (f" #{r['leaderboardRank']}" if r.get("leaderboardRank") else "") if r else "unranked"
            print(f"  {handle} ({riot_id}, {rec['region']}): act={rec.get('actShort')} rank={rank_str} "
                  f"{rec['matches']} matches, {rec['wins']}W-{rec['losses']}L, "
                  f"ACS {rec['acs'] and round(rec['acs'])}, K/D {rec['kd'] and round(rec['kd'], 2)}, "
                  f"HS% {rec['hsPct'] and round(rec['hsPct'] * 100, 1)}, "
                  f"KAST {rec['kast'] and round(rec['kast'] * 100, 1)}")
        elif i % 10 == 0 or i == len(targets):
            print(f"  ...{i}/{len(targets)}")
        # Persist as we go -- a run interrupted partway (or aborted by a
        # persistent API failure) keeps everything already fetched, same
        # reasoning as add_tracker_link.py's save-per-entry.
        if not args.inspect:
            out["_meta"] = {
                "generated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
                "source": "HenrikDev API (api.henrikdev.xyz), unofficial VALORANT API over Riot's own",
                "note": ("Personal competitive ladder stats for the player's CURRENT Act, from their "
                         "linked Riot account -- a different population from this site's pro-match "
                         "stats and not comparable with them."),
            }
            save(out)

    if args.inspect:
        return 0

    save(out)
    print(f"\nDone. {ok} updated, {skipped} skipped, {failed} failed. "
          f"{len(players)} players in {OUT_PATH}")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        print("\nStopped.")
        sys.exit(130)
