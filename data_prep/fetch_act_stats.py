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
  - ADR/HS%/DDΔ are computed ENEMY-only, not from the match-summary
    `players[].stats.damage` total -- that total includes friendly fire
    (AOE utility clipping a teammate), which inflates it. Verified against
    a real profile where raw damage/rounds read 180.8 but tracker.gg's own
    "Damage/Round" pill read 180.3; the gap closed once friendly-fire hits
    were excluded via `rounds[].stats[].damage_events[]`, which (unlike the
    summary total) records each hit's own receiver. See
    `_round_enemy_combat()` below.

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
        # Rounds actually WON by the player's team -- needed for the real
        # per-round "Round Win %" tracker.gg shows in its Tracker Score row,
        # a genuinely different number from match-level Win% (see derive()'s
        # own comment on both).
        "roundsWon": 0,
        "kills": 0, "deaths": 0, "assists": 0, "score": 0,
        "headshots": 0, "bodyshots": 0, "legshots": 0, "damage": 0,
        # Damage RECEIVED, not just dealt -- `damage` above is ADR's own
        # numerator; this is the second half needed for tracker.gg's real
        # "Damage Delta/Round" (see derive()'s own comment on why this
        # matters -- it's a genuinely different stat from ADR, not ADR
        # under another name).
        "damageReceived": 0,
        # ENEMY-only counterparts of the four above -- see
        # _round_enemy_combat()'s own docstring for why plain `damage` et al
        # (Riot's match-summary totals) over-count ADR/HS%: they include
        # friendly-fire hits (AOE utility clipping a teammate), which a real
        # per-round damage/HS% stat should never credit. None of the four
        # `enemy*` counters exist until a --full re-run backfills them for a
        # cached player (same rollout pattern as kastEligibleRounds below).
        "enemyDamage": 0, "enemyDamageReceived": 0,
        "enemyHeadshots": 0, "enemyBodyshots": 0, "enemyLegshots": 0,
        "enemyCombatRounds": 0,
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
#
# Tried narrowing this to 4800ms after `diagnose_trade_windows()` found all
# 3 spot-checked accounts (azury/keiko/kozzy) reading ~0.1pp HIGH on KAST
# against their real tracker.gg values at 5000ms -- reverted at direct
# request: the window isn't accepted as the actual cause, so the gap is
# still open. Prime suspect, not yet confirmed: `_round_kast_participants`'s
# `total_round_ids` and `_round_enemy_combat`'s `eligible_rounds` landed on
# the IDENTICAL inflated total for kozzy (5419, vs a real 5408 -- see the
# enemyCombatRounds clamp fix above) despite being built by two independently
# written loops, which argues for a shared root cause (e.g. a genuinely
# duplicate round entry in match['rounds'] carrying its own distinct round
# id, which would inflate `eligible_rounds`'s plain per-round counter AND
# escape total_round_ids' set-based dedup since a real duplicate wouldn't
# reuse the same id) rather than the trade window itself. Not yet verified
# against a real raw match payload.
TRADE_WINDOW_MS = 5000


def _round_kast_participants(match, puuid, trade_window_ms=TRADE_WINDOW_MS):
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
                    and t2 >= died_at and t2 - died_at <= trade_window_ms):
                qualifying.add(round_id)
                break

    return qualifying, total_round_ids


def _round_enemy_combat(match, puuid):
    """Sums ENEMY-only damage dealt (with its headshot/bodyshot/legshot
    breakdown) and enemy-only damage received for one player across a
    match's `rounds[]`, or (None, None, 0) if this match has no round data.

    The match-summary `players[].stats.damage.{dealt,received}` totals this
    script used before this existed count ALL damage, including friendly
    fire (AOE utility -- Raze satchels/ult, Viper/Brimstone/KAY-O mollies,
    etc. -- clipping a teammate). Verified concretely against a real
    profile: raw damage/rounds landed at 180.8, but the player's actual
    tracker.gg "Damage/Round" pill read 180.3, and the gap disappeared once
    friendly-fire hits were excluded. `rounds[].stats[].damage_events[]` is
    what makes the filtering possible -- each hit records its own receiver
    (and therefore team), unlike the match-summary total.
    """
    rounds = match.get("rounds") or []
    if not rounds:
        return None, None, 0

    my_team = None
    for r in rounds:
        for s in (r.get("stats") or []):
            p = s.get("player") or {}
            if p.get("puuid") == puuid:
                my_team = p.get("team")
                break
        if my_team:
            break
    if my_team is None:
        return None, None, 0

    dealt = {"damage": 0, "headshots": 0, "bodyshots": 0, "legshots": 0}
    received = 0
    eligible_rounds = 0
    for r in rounds:
        stats = r.get("stats") or []
        mine = next((s for s in stats if (s.get("player") or {}).get("puuid") == puuid), None)
        if mine is None:
            continue
        eligible_rounds += 1
        for e in (mine.get("damage_events") or []):
            if (e.get("player") or {}).get("team") != my_team:
                dealt["damage"] += e.get("damage") or 0
                dealt["headshots"] += e.get("headshots") or 0
                dealt["bodyshots"] += e.get("bodyshots") or 0
                dealt["legshots"] += e.get("legshots") or 0
        for s in stats:
            attacker = s.get("player") or {}
            if attacker.get("puuid") == puuid or attacker.get("team") == my_team:
                continue
            for e in (s.get("damage_events") or []):
                if (e.get("player") or {}).get("puuid") == puuid:
                    received += e.get("damage") or 0

    return dealt, received, eligible_rounds


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
    rounds_won = 0
    if my_team:
        r = my_team.get("rounds") or {}
        rounds_won = r.get("won") or 0
        rounds = rounds_won + (r.get("lost") or 0)

    counters["matches"] += 1
    counters["rounds"] += rounds
    counters["roundsWon"] += rounds_won
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
        # Clamped to this match's own official round count, same reasoning
        # and same fix shape as the enemyCombatRounds clamp below --
        # confirmed via --dump-round-anomalies against real match data (not
        # guessed): a small number of matches (2 of 258 for one spot-checked
        # account) have MORE entries in match['rounds'] than the team's real
        # round total, with no duplicate round ids involved (17 real,
        # distinct ids vs a team total of 14; 13 vs 5 on the other) -- most
        # likely a remake/restart leaving extra round records behind. Total
        # eligible-round inflation from just those 2 matches (+3, +8 = +11)
        # exactly matched that account's whole-Act denominator excess found
        # earlier, confirming this -- not the trade window -- as the real
        # source of the small KAST gap against tracker.gg's real numbers.
        # `kast_rounds` (qualifying) is clamped the same way it's bounded by
        # construction (a subset of kast_eligible) rather than separately
        # attributing which specific extra rounds were phantom.
        eligible_n = min(len(kast_eligible), rounds) if rounds else len(kast_eligible)
        counters["kastEligibleRounds"] += eligible_n
        counters["kastRounds"] += min(len(kast_rounds), eligible_n)

    enemy_dealt, enemy_received, enemy_rounds = _round_enemy_combat(match, puuid)
    if enemy_dealt is not None:
        counters["enemyDamage"] += enemy_dealt["damage"]
        counters["enemyHeadshots"] += enemy_dealt["headshots"]
        counters["enemyBodyshots"] += enemy_dealt["bodyshots"]
        counters["enemyLegshots"] += enemy_dealt["legshots"]
        counters["enemyDamageReceived"] += enemy_received
        # Clamped to this match's own official round count (`rounds`, from
        # the team totals above -- the same denominator ACS already uses and
        # which matches tracker.gg's real ACS exactly). `_round_enemy_combat`
        # counts eligible rounds from `match['rounds']` independently, via
        # its own per-round team lookup, and on rare matches that array
        # carries more entries than the team's real round total (confirmed
        # live: a real player's cumulative enemyCombatRounds landed 11 rounds
        # ABOVE their cumulative `rounds`, 5419 vs 5408) -- a duplicate/
        # phantom round entry inflates the denominator here with no matching
        # damage to go with it, since a phantom round has no real
        # damage_events. Uncapped, this silently underreports ADR/HS%/DDΔ
        # (confirmed: a real profile's ADR read 189.3 against tracker.gg's
        # real 189.6 -- capping this recovers 189.65, matching almost
        # exactly). `rounds` can be 0 on a match where the top-level team
        # lookup itself failed; uncapped in that case rather than zeroing out
        # real enemy-combat data over an unrelated lookup miss.
        counters["enemyCombatRounds"] += min(enemy_rounds, rounds) if rounds else enemy_rounds

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
    # Match-level Win% denominator is every DECIDED-OR-DRAWN match, not just
    # decided ones -- a draw isn't a loss, but excluding it entirely
    # overstates the rate (confirmed against a real profile: 88W-61L-1D
    # showed 58.7% on tracker.gg, i.e. 88/150, not 88/149).
    total_matches = counters["wins"] + counters["losses"] + counters["draws"]
    enemy_rounds = counters["enemyCombatRounds"]
    enemy_shots = counters["enemyHeadshots"] + counters["enemyBodyshots"] + counters["enemyLegshots"]
    return {
        "winPct": (counters["wins"] / total_matches) if total_matches else None,
        # tracker.gg's real "Round Win %" (its Tracker Score row) -- a
        # genuinely different number from match Win% above (a team can win
        # a match 13-11, going 13/24 = 54% on rounds despite "winning").
        "roundWinPct": (counters["roundsWon"] / rounds) if rounds else None,
        "kd": (counters["kills"] / counters["deaths"]) if counters["deaths"] else None,
        "acs": (counters["score"] / rounds) if rounds else None,
        # ENEMY-only damage per round -- see _round_enemy_combat()'s own
        # docstring for why the match-summary `damage` total (friendly fire
        # included) overstates this. None (not a value derived from the raw
        # total) for a player whose matches were all fetched/cached before
        # this existed, until a --full re-run backfills enemyCombatRounds --
        # same rollout pattern as `kast` below, deliberately not silently
        # falling back to the inflated raw-total figure.
        "adr": (counters["enemyDamage"] / enemy_rounds) if enemy_rounds else None,
        # tracker.gg's real "DDΔ/Round" -- confirmed against their own live
        # tooltip: "Damage Dealt - Damage Received, averaged over Rounds
        # played". A self-contained per-player stat, NOT a comparison
        # against the opposing team's own average (the earlier, wrong
        # assumption this pipeline was built on -- see this module's own
        # "WHY ADR STANDS IN" note, since corrected). Genuinely different
        # from ADR: two players with identical ADR can have very different
        # DDΔ if one takes far more damage than the other on the way to it.
        # Uses the same enemy-only halves as `adr` above, for the same
        # friendly-fire reason.
        "ddDelta": ((counters["enemyDamage"] - counters["enemyDamageReceived"]) / enemy_rounds) if enemy_rounds else None,
        "hsPct": (counters["enemyHeadshots"] / enemy_shots) if enemy_shots else None,
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


def diagnose_trade_windows(client, handle, riot_id, puuid, windows):
    """One-off, non-persisting diagnostic: pages through a player's whole
    current-Act match history ONCE, then recomputes KAST at every requested
    trade window (ms) in that single pass -- so comparing several candidate
    windows against a known-real tracker.gg KAST% costs one fetch, not one
    per window. Never called from the normal fetch path; only reachable via
    --inspect --trade-windows, and never writes to player_act_stats.json.
    """
    region = fetch_region(client, puuid)
    if not region:
        print(f"  [skip] {handle}: no region")
        return

    per_window = {w: {"qual": 0, "elig": 0} for w in windows}
    act_id = None
    act_short = None
    seen_match_ids = set()
    matches_seen = 0

    for page in range(MAX_PAGES_PER_PLAYER):
        resp = client.get(
            f"/v4/by-puuid/matches/{region}/{PLATFORM}/{puuid}",
            {"mode": QUEUE_MODE, "size": PAGE_SIZE, "start": page * PAGE_SIZE},
        )
        matches = (resp or {}).get("data") or []
        if not matches:
            break
        stop = False
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
                act_id, act_short = sid, season.get("short")
            if sid and act_id and sid != act_id:
                stop = True
                break
            matches_seen += 1
            for w in windows:
                qual, elig = _round_kast_participants(match, puuid, trade_window_ms=w)
                if qual is not None:
                    per_window[w]["qual"] += len(qual)
                    per_window[w]["elig"] += len(elig)
        if stop:
            break

    print(f"  {handle} ({riot_id}, {region}, act={act_short}, {matches_seen} matches):")
    for w in windows:
        elig = per_window[w]["elig"]
        pct = (100 * per_window[w]["qual"] / elig) if elig else None
        print(f"    {w}ms -> KAST {pct:.2f}%" if pct is not None else f"    {w}ms -> no data")


def diagnose_round_anomalies(client, handle, riot_id, puuid):
    """One-off, non-persisting diagnostic: for every match in the player's
    current Act, compares the team's official round total (rounds_won +
    rounds_lost -- the same denominator ACS/`rounds` use, proven correct
    earlier by matching tracker.gg's real ACS exactly) against the raw
    round-array length AND its distinct-id count, to find WHERE a mismatch
    actually originates (duplicate round ids, extra ids, or something else)
    instead of guessing from the aggregate totals alone. Prints only the
    matches that disagree. Never writes to player_act_stats.json.
    """
    region = fetch_region(client, puuid)
    if not region:
        print(f"  [skip] {handle}: no region")
        return

    act_id = None
    seen_match_ids = set()
    matches_seen = 0
    flagged = 0

    for page in range(MAX_PAGES_PER_PLAYER):
        resp = client.get(
            f"/v4/by-puuid/matches/{region}/{PLATFORM}/{puuid}",
            {"mode": QUEUE_MODE, "size": PAGE_SIZE, "start": page * PAGE_SIZE},
        )
        matches = (resp or {}).get("data") or []
        if not matches:
            break
        stop = False
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
            if sid and act_id and sid != act_id:
                stop = True
                break
            matches_seen += 1

            players = match.get("players") or []
            me = next((p for p in players if p.get("puuid") == puuid), None)
            teams = match.get("teams") or []
            my_team = next((t for t in teams if me and t.get("team_id") == me.get("team_id")), None)
            if not my_team:
                continue
            r = my_team.get("rounds") or {}
            team_rounds = (r.get("won") or 0) + (r.get("lost") or 0)

            raw_rounds = match.get("rounds") or []
            raw_ids = [rr.get("id") for rr in raw_rounds]
            distinct_ids = set(raw_ids)

            _, kast_eligible = _round_kast_participants(match, puuid)
            _, _, enemy_rounds = _round_enemy_combat(match, puuid)

            kast_n = len(kast_eligible) if kast_eligible is not None else None
            mismatch = (
                len(raw_rounds) != team_rounds
                or len(distinct_ids) != len(raw_rounds)
                or (kast_n is not None and kast_n != team_rounds)
                or (enemy_rounds and enemy_rounds != team_rounds)
            )
            if mismatch:
                flagged += 1
                dupes = [i for i in distinct_ids if raw_ids.count(i) > 1]
                print(f"    match {match_id}: team_rounds={team_rounds} "
                      f"raw_round_entries={len(raw_rounds)} distinct_ids={len(distinct_ids)} "
                      f"kast_eligible={kast_n} enemy_combat_rounds={enemy_rounds} "
                      f"duplicate_ids={dupes[:5]}")
        if stop:
            break

    print(f"  {handle} ({riot_id}, {region}): {matches_seen} matches, {flagged} with a round-count mismatch")


def diagnose_kast_detail(client, handle, riot_id, puuid):
    """One-off, non-persisting diagnostic: dumps a per-match KAST breakdown
    (qualifying rounds / eligible rounds / team's real round total) for
    EVERY match, not just ones already flagged by --dump-round-anomalies --
    for tracking down a player-specific bias that isn't explained by that
    round-count-inflation bug (e.g. it shows up even on a player with zero
    inflated matches). Flags matches worth a second look: unusually few
    real rounds (<10, a forfeit/early-surrender shape where most rounds
    would default to "survived" and inflate the qualifying rate) or a
    per-match qualifying rate over 95% (implausibly high for a normal
    game). Never writes to player_act_stats.json.
    """
    region = fetch_region(client, puuid)
    if not region:
        print(f"  [skip] {handle}: no region")
        return

    act_id = None
    seen_match_ids = set()
    matches_seen = 0
    total_qual = total_elig = 0
    flagged = 0

    for page in range(MAX_PAGES_PER_PLAYER):
        resp = client.get(
            f"/v4/by-puuid/matches/{region}/{PLATFORM}/{puuid}",
            {"mode": QUEUE_MODE, "size": PAGE_SIZE, "start": page * PAGE_SIZE},
        )
        matches = (resp or {}).get("data") or []
        if not matches:
            break
        stop = False
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
            if sid and act_id and sid != act_id:
                stop = True
                break
            matches_seen += 1

            players = match.get("players") or []
            me = next((p for p in players if p.get("puuid") == puuid), None)
            teams = match.get("teams") or []
            my_team = next((t for t in teams if me and t.get("team_id") == me.get("team_id")), None)
            team_rounds = 0
            if my_team:
                r = my_team.get("rounds") or {}
                team_rounds = (r.get("won") or 0) + (r.get("lost") or 0)

            kast_rounds, kast_eligible = _round_kast_participants(match, puuid)
            if kast_rounds is None:
                continue
            qual, elig = len(kast_rounds), len(kast_eligible)
            total_qual += qual
            total_elig += elig
            rate = (qual / elig) if elig else None
            worth_a_look = elig and (elig < 10 or (rate is not None and rate > 0.95))
            if worth_a_look:
                flagged += 1
                print(f"    match {match_id}: team_rounds={team_rounds} eligible={elig} "
                      f"qualifying={qual} rate={rate*100:.1f}%")
        if stop:
            break

    overall = (100 * total_qual / total_elig) if total_elig else None
    print(f"  {handle} ({riot_id}, {region}): {matches_seen} matches, "
          f"overall KAST {overall:.2f}% ({total_qual}/{total_elig} rounds), "
          f"{flagged} match(es) flagged as worth a look")


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
    ap.add_argument("--handles", nargs="+", metavar="HANDLE",
                    help="Only process these specific handles (and DO write the result, unlike "
                         "--inspect) -- for retrying a targeted subset that failed on a prior run "
                         "(e.g. a transient regional API outage) without re-running the whole "
                         "linked population.")
    ap.add_argument("--full", action="store_true",
                    help="Ignore the incremental cache and re-sum each player's whole current Act.")
    ap.add_argument("--trade-windows", metavar="MS,MS,...",
                    help="Diagnostic only, requires --inspect: recompute KAST at each of these "
                         "trade-window values (ms) in one pass per handle, no write. For "
                         "calibrating TRADE_WINDOW_MS against known-real tracker.gg KAST%% values.")
    ap.add_argument("--dump-round-anomalies", action="store_true",
                    help="Diagnostic only, requires --inspect: for each match, compares the team's "
                         "official round total against the raw round-array length/distinct-id count "
                         "and prints any mismatch, to find WHERE a round-count inflation actually "
                         "comes from (duplicate ids, extra ids, etc) instead of guessing from "
                         "aggregate totals. No write.")
    ap.add_argument("--dump-kast-detail", action="store_true",
                    help="Diagnostic only, requires --inspect: per-match qualifying/eligible KAST "
                         "rounds for every match, flagging low-round (<10, forfeit-shaped) or "
                         "implausibly-high (>95%%) matches -- for a player-specific KAST bias NOT "
                         "explained by --dump-round-anomalies' round-count inflation. No write.")
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
    if args.handles:
        wanted = {h.lower() for h in args.handles}
        targets = [t for t in targets if t[0].lower() in wanted]
    if args.limit:
        targets = targets[:args.limit]

    if args.trade_windows:
        if not args.inspect:
            print("[FATAL] --trade-windows requires --inspect.", file=sys.stderr)
            return 1
        windows = [int(w.strip()) for w in args.trade_windows.split(",") if w.strip()]
        for handle, riot_id, puuid in targets:
            diagnose_trade_windows(client, handle, riot_id, puuid, windows)
        return 0

    if args.dump_round_anomalies:
        if not args.inspect:
            print("[FATAL] --dump-round-anomalies requires --inspect.", file=sys.stderr)
            return 1
        for handle, riot_id, puuid in targets:
            diagnose_round_anomalies(client, handle, riot_id, puuid)
        return 0

    if args.dump_kast_detail:
        if not args.inspect:
            print("[FATAL] --dump-kast-detail requires --inspect.", file=sys.stderr)
            return 1
        for handle, riot_id, puuid in targets:
            diagnose_kast_detail(client, handle, riot_id, puuid)
        return 0

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
