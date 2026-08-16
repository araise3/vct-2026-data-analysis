#!/usr/bin/env python3
"""
vlr_ewc_scraper.py
===================
Scrapes VLR.gg for the Esports World Cup 2026 Valorant event AND all four
regional qualifiers that fed into it:
  - Esports World Cup 2026 (main event, Paris)
  - EWC 2026: Americas Qualifier
  - EWC 2026: EMEA Qualifier
  - EWC 2026: Pacific Qualifier
  - EWC 2026: China Qualifier

Same data model / tables as vlr_vct_scraper.py, in its own SQLite DB
(vlr_ewc_2026.db) so it doesn't mix with your VCT dataset. Uses the exact
same polite fetching logic (delay + retries + real User-Agent) and the same
table schema, so you can query both DBs the same way, or ATTACH one to the
other in SQLite if you ever want to join across them.

USAGE
-----
    python3 vlr_ewc_scraper.py                  # scrape main event + all qualifiers
    python3 vlr_ewc_scraper.py --events 2952     # just the main EWC event
    python3 vlr_ewc_scraper.py --skip-matches    # stats/agents only (fast)
    python3 vlr_ewc_scraper.py --resume          # skip matches already in DB
    python3 vlr_ewc_scraper.py --resume --require-existing-db
                                                 # as above, but abort instead of
                                                 # creating a DB if none exists
                                                 # (for unattended/automated runs)
    python3 vlr_ewc_scraper.py --economy-only    # re-fetch ONLY the economy tab
                                                   # for matches already in the DB

Run this on your own machine — vlr.gg isn't reachable from the sandboxed
chat environment this was written in.

RECHECK / CLOSED-EVENT BEHAVIOR (--resume only)
------------------------------------------------
An event with no live/upcoming/partial matches left and whose last completed
match is more than RECHECK_GRACE_DAYS (7) old is treated as closed and
skipped entirely -- no event-stats/agents/match-list requests spent on it.
ANY match sitting at 'partial' keeps the event open regardless of its date --
found live in production (VLR briefly pulled a months-old EWC China Qualifier
match's box score back to "Logs (Soon)"; without this, the event would have
closed on the next run and that known-incomplete match would never have been
retried). While an event is still active (by either rule), EVERY match under it -- including
ones from early in a long-running event -- stays eligible for a throttled
box-score re-check (at most once per RECHECK_THROTTLE_HOURS = 24), because
VLR can take much longer than a few days to fill in Rating 2.0/ACS for some
matches (confirmed live: an entire in-progress China Stage 2 has run 2+ weeks
with Rating 2.0 still missing for every match so far). There is deliberately
NO separate cutoff based on a match's own age -- only the event closing ends
the rechecking, since a fixed per-match window would let early matches in a
still-running event silently stop being checked while the event kept getting
scraped anyway. Pass --events to force-scrape a specific event regardless of
its closed status.

EXIT CODES
----------
    0  clean run
    1  something failed but what landed is valid (publish, but don't call it a success)
    2  aborted -- vlr.gg refused us (403/429), or --require-existing-db found no DB
"""

import argparse
import os
import random
import re
import sqlite3
import sys
import time
from datetime import datetime, timedelta
from typing import Optional

import requests
from bs4 import BeautifulSoup

BASE = "https://www.vlr.gg"
# Environment-overridable so an automated run can point at a restored database
# elsewhere in the workspace without editing this file or passing --db.
DB_PATH = os.environ.get("VLR_EWC_DB_PATH", "vlr_ewc_2026.db")

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/124.0 Safari/537.36 "
        "vlr-ewc-2026-research-scraper/1.0"
    )
}

REQUEST_DELAY = (1.2, 2.2)
MAX_RETRIES = 4

# Status codes that mean "vlr.gg is refusing this client", as opposed to a
# transient server hiccup. Retrying these is pointless (the next request gets
# the same answer) and counterproductive (it looks like hammering).
BLOCK_STATUSES = (401, 403, 429)


class ScrapeFailure(Exception):
    """Raised when the run should abort outright instead of limping on.

    Distinct from the per-request/per-event failures below, which are counted
    and tolerated: this one means every remaining request would fail the same
    way, so continuing just burns requests and produces a half-empty DB.
    """


# Run-level failure tallies. Each individual failure path here is already
# recoverable by design -- a failed fetch returns None, a failed event is
# caught and skipped -- which is the right behaviour for an interactive run
# where a human reads the warnings. What was missing is anything that *adds
# them up*, so a run where every single request failed still exited 0.
FAILURES = {"fetch": 0, "event": 0, "match": 0}


def failure_exit_code() -> int:
    """0 only if the run was genuinely clean; 1 if anything failed.

    Exit 1 means "the data that did land is valid, but this run is incomplete"
    -- a caller can still publish what was scraped, but must not report the run
    as a success. A hard abort uses exit 2 instead; see ScrapeFailure.
    """
    total = FAILURES["fetch"] + FAILURES["event"] + FAILURES["match"]
    if not total:
        return 0
    print(f"\n[FAILED] {FAILURES['event']} event(s), {FAILURES['match']} match(es) and "
          f"{FAILURES['fetch']} request(s) failed this run.")
    print("Exiting non-zero so an automated run does not report this as a success.")
    return 1


# ---------------------------------------------------------------------------
# EWC 2026 main event + its four regional qualifiers.
# Verified against https://www.vlr.gg/series/95/esports-world-cup as of 2026-07-16.
# ---------------------------------------------------------------------------
EWC_2026_EVENTS = [
    # (event_id, slug, region, stage)
    (2953, "esports-world-cup-2026-americas-qualifier", "Americas", "Qualifier"),
    (2954, "esports-world-cup-2026-emea-qualifier", "EMEA", "Qualifier"),
    (2955, "esports-world-cup-2026-pacific-qualifier", "Pacific", "Qualifier"),
    (2956, "esports-world-cup-2026-china-qualifier", "China", "Qualifier"),
    (2952, "esports-world-cup-2026", "International", "Main Event"),
]


# ---------------------------------------------------------------------------
# HTTP helper (identical politeness behavior to the VCT scraper)
# ---------------------------------------------------------------------------
def fetch(url: str, session: requests.Session) -> Optional[BeautifulSoup]:
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            resp = session.get(url, headers=HEADERS, timeout=20)
            if resp.status_code == 200:
                time.sleep(random.uniform(*REQUEST_DELAY))
                return BeautifulSoup(resp.text, "html.parser")
            elif resp.status_code == 404:
                print(f"  [404] {url}")
                return None
            elif resp.status_code in BLOCK_STATUSES:
                # Being refused at the edge is not something backoff fixes.
                # This is the expected failure mode when running from a
                # datacenter IP (a CI runner) against a Cloudflare-fronted
                # site, and the one that most needs to be loud: the old code
                # quietly returned None for every page, so the run still
                # finished "successfully" having scraped nothing at all.
                raise ScrapeFailure(
                    f"HTTP {resp.status_code} from {url} -- vlr.gg is refusing this client. "
                    f"A datacenter/CI IP being blocked is the usual cause. Aborting the run "
                    f"rather than continuing with incomplete data."
                )
            else:
                print(f"  [{resp.status_code}] {url} (attempt {attempt})")
        except requests.RequestException as e:
            print(f"  [error] {url}: {e} (attempt {attempt})")
        time.sleep(2 ** attempt)
    print(f"  [FAILED after {MAX_RETRIES} attempts] {url}")
    FAILURES["fetch"] += 1
    return None


# ---------------------------------------------------------------------------
# Grace-period / recheck helpers (see the fix-#5 comment at the top of the
# diff that introduced these for the full rationale).
# ---------------------------------------------------------------------------
RECHECK_GRACE_DAYS = 7
RECHECK_THROTTLE_HOURS = 24


def _parse_dt(s):
    if not s:
        return None
    try:
        return datetime.strptime(s, "%Y-%m-%d %H:%M:%S")
    except (ValueError, TypeError):
        return None


def event_needs_scrape(conn, event_id: int) -> bool:
    """Whether this event is still worth spending requests on at all.

    True if it has never been scraped, has a match still upcoming/live, has
    a 'partial' match still within its own chase window (see below), or its
    last completed match was within RECHECK_GRACE_DAYS -- VLR can still be
    filling in data for it (Rating 2.0 has shown up to a few days late,
    China region especially). Past all of that, the event's aggregate pages
    and match list cannot change again, so skipping them entirely loses
    nothing.

    A 'partial' match is checked against first_partial_at (when it FIRST went
    partial), not match_date (when it was played) -- an earlier version of
    this function had no bound on 'partial' at all, on the assumption that
    'partial' always means "transient, will resolve given time." Real data
    proved that assumption wrong: 13 EWC 2026 China Qualifier matches have
    every stat NULL (rating, acs, kills, everything) in the OLDEST available
    snapshot too, not just the latest one -- meaning VLR most likely never
    published a real box score for them, not that it regressed from good to
    bad. That event has zero upcoming/live matches, so with no bound at all
    it would have polled forever for data that will never arrive -- exactly
    the unbounded cost this mechanism exists to prevent. Bounding by
    first_partial_at (not match_date) still fixes the original problem this
    condition was added for (a match whose event has long since aged out by
    date can still be chased for RECHECK_GRACE_DAYS from when the problem was
    actually noticed), while giving up automatically once that's exhausted --
    the match stays 'partial' in the DB as an honest record, it just stops
    generating further requests.
    """
    cur = conn.cursor()
    cur.execute("SELECT status, match_date, first_partial_at FROM matches WHERE event_id = ?", (event_id,))
    rows = cur.fetchall()
    if not rows:
        return True
    if any(status in ("upcoming", "live") for status, _, _ in rows):
        return True
    now = datetime.utcnow()
    for status, match_date, first_partial_at in rows:
        if status == "partial":
            fp = _parse_dt(first_partial_at)
            # No first_partial_at on record (e.g. a DB from before this
            # column existed) -- treat conservatively as freshly partial
            # rather than silently never re-checking it.
            if fp is None or (now - fp) <= timedelta(days=RECHECK_GRACE_DAYS):
                return True
            continue
        dt = _parse_dt(match_date)
        if dt and (now - dt) <= timedelta(days=RECHECK_GRACE_DAYS):
            return True
    return False


def match_due_for_recheck(last_checked_at) -> bool:
    """Whether an already-'completed' match should be re-scraped anyway.

    Deliberately has NO cutoff based on the match's own date. An earlier
    version bounded this to RECHECK_GRACE_DAYS after the match itself, which
    looked reasonable but broke on real data: a still-running event (e.g.
    China Stage 2, which stays open for weeks) has early matches that age
    past a fixed per-match window long before the event around them closes,
    so those matches would silently stop being re-checked while the event
    kept getting scraped every run -- exactly the gap this whole mechanism
    exists to close (VLR filling in Rating 2.0 / ACS late is not guaranteed
    to happen within a fixed number of days of the match, only within the
    event's own active lifetime).

    The termination condition lives at the EVENT level instead: this function
    is only ever reached for matches whose event passed event_needs_scrape()
    this run, so once an event closes for good, its matches simply stop being
    visited at all -- no separate expiry needed here. All this function does
    is throttle: not checked again within RECHECK_THROTTLE_HOURS, so a
    3-hourly cron doesn't re-fetch the same box score up to 8 times a day
    chasing a correction that lands once.
    """
    last = _parse_dt(last_checked_at)
    if last and (datetime.utcnow() - last) < timedelta(hours=RECHECK_THROTTLE_HOURS):
        return False
    return True


# Database (same schema as the VCT scraper, separate file)
# ---------------------------------------------------------------------------
def init_db(path: str = DB_PATH) -> sqlite3.Connection:
    conn = sqlite3.connect(path)
    cur = conn.cursor()
    try:
        cur.execute("ALTER TABLE matches ADD COLUMN last_checked_at TEXT")
    except sqlite3.OperationalError:
        pass  # column already exists -- DB was created after this migration
    try:
        cur.execute("ALTER TABLE matches ADD COLUMN first_partial_at TEXT")
    except sqlite3.OperationalError:
        pass  # column already exists -- DB was created after this migration
    try:
        # See vlr_vct_scraper.py's own copy of this migration for why:
        # VLR's opaque per-map id, kept now so a map can link straight to
        # its own scoreboard view instead of just the match overall.
        cur.execute("ALTER TABLE maps ADD COLUMN vlr_game_id TEXT")
    except sqlite3.OperationalError:
        pass  # column already exists -- DB was created after this migration

    cur.executescript(
        """
        CREATE TABLE IF NOT EXISTS events (
            event_id INTEGER PRIMARY KEY,
            slug TEXT,
            name TEXT,
            region TEXT,
            stage TEXT
        );

        CREATE TABLE IF NOT EXISTS player_event_stats (
            event_id INTEGER,
            player TEXT,
            player_url TEXT,
            team TEXT,
            agents TEXT,
            maps_played INTEGER,
            rounds_played INTEGER,
            rating REAL,
            acs REAL,
            kd REAL,
            kast TEXT,
            adr REAL,
            kpr REAL,
            apr REAL,
            fkfd REAL,
            fkpr REAL,
            fdpr REAL,
            hs_pct TEXT,
            cl_pct TEXT,
            cl TEXT,
            kmax INTEGER,
            kills INTEGER,
            deaths INTEGER,
            assists INTEGER,
            first_kills INTEGER,
            first_deaths INTEGER,
            PRIMARY KEY (event_id, player)
        );

        CREATE TABLE IF NOT EXISTS player_nationality (
            player TEXT PRIMARY KEY,
            country_code TEXT,
            country_name TEXT
        );

        CREATE TABLE IF NOT EXISTS event_map_summary (
            event_id INTEGER,
            map_name TEXT,
            rounds_played INTEGER,
            atk_win_pct TEXT,
            def_win_pct TEXT,
            PRIMARY KEY (event_id, map_name)
        );

        CREATE TABLE IF NOT EXISTS event_map_agent_utilization (
            event_id INTEGER,
            map_name TEXT,
            agent TEXT,
            utilization_pct TEXT,
            PRIMARY KEY (event_id, map_name, agent)
        );

        CREATE TABLE IF NOT EXISTS matches (
            match_id INTEGER PRIMARY KEY,
            event_id INTEGER,
            team1 TEXT,
            team2 TEXT,
            score1 INTEGER,
            score2 INTEGER,
            stage TEXT,
            match_date TEXT,
            match_url TEXT,
            status TEXT DEFAULT 'unknown',
            last_checked_at TEXT,
            first_partial_at TEXT
        );

        CREATE TABLE IF NOT EXISTS maps (
            match_id INTEGER,
            map_index INTEGER,
            map_name TEXT,
            team1_score INTEGER,
            team2_score INTEGER,
            team1_atk_score INTEGER,
            team1_def_score INTEGER,
            team2_atk_score INTEGER,
            team2_def_score INTEGER,
            duration TEXT,
            vlr_game_id TEXT,
            PRIMARY KEY (match_id, map_index)
        );

        CREATE TABLE IF NOT EXISTS map_round_results (
            match_id INTEGER,
            map_index INTEGER,
            round_num INTEGER,
            winner TEXT,
            winner_side TEXT,
            win_condition TEXT,
            PRIMARY KEY (match_id, map_index, round_num)
        );

        CREATE TABLE IF NOT EXISTS map_team_economy (
            match_id INTEGER,
            map_index INTEGER,
            team TEXT,
            pistol_won INTEGER,
            eco_rounds INTEGER,
            eco_won INTEGER,
            semi_eco_rounds INTEGER,
            semi_eco_won INTEGER,
            semi_buy_rounds INTEGER,
            semi_buy_won INTEGER,
            full_buy_rounds INTEGER,
            full_buy_won INTEGER,
            PRIMARY KEY (match_id, map_index, team)
        );

        CREATE TABLE IF NOT EXISTS map_round_economy (
            match_id INTEGER,
            map_index INTEGER,
            round_num INTEGER,
            team1_bank TEXT,
            team1_loadout INTEGER,
            team1_buy_type TEXT,
            team1_round_win INTEGER,
            team2_bank TEXT,
            team2_loadout INTEGER,
            team2_buy_type TEXT,
            team2_round_win INTEGER,
            PRIMARY KEY (match_id, map_index, round_num)
        );

        CREATE TABLE IF NOT EXISTS map_player_stats (
            match_id INTEGER,
            map_index INTEGER,
            player TEXT,
            team TEXT,
            agent TEXT,
            rating REAL,
            acs REAL,
            kills INTEGER,
            deaths INTEGER,
            assists INTEGER,
            kd_diff INTEGER,
            kast TEXT,
            adr REAL,
            hs_pct TEXT,
            first_kills INTEGER,
            first_deaths INTEGER,
            fk_fd_diff INTEGER,
            side TEXT,
            multi_2k INTEGER,
            multi_3k INTEGER,
            multi_4k INTEGER,
            multi_5k INTEGER,
            clutch_1v1 INTEGER,
            clutch_1v2 INTEGER,
            clutch_1v3 INTEGER,
            clutch_1v4 INTEGER,
            clutch_1v5 INTEGER,
            econ INTEGER,
            plants INTEGER,
            defuses INTEGER,
            PRIMARY KEY (match_id, map_index, player, side)
        );

        -- See vlr_vct_scraper.py's own copy of these two tables for the full
        -- rationale -- ported here unchanged so EWC matches get the same map
        -- veto / player-duel data as VCT ones.
        CREATE TABLE IF NOT EXISTS match_vetoes (
            match_id INTEGER,
            order_num INTEGER,
            team TEXT,
            action TEXT,
            map_name TEXT,
            PRIMARY KEY (match_id, order_num)
        );

        CREATE TABLE IF NOT EXISTS map_player_duels (
            match_id INTEGER,
            map_index INTEGER,
            player1 TEXT,
            player2 TEXT,
            player1_kills INTEGER,
            player2_kills INTEGER,
            PRIMARY KEY (match_id, map_index, player1, player2)
        );
        """
    )
    try:
        cur.execute("ALTER TABLE matches ADD COLUMN status TEXT DEFAULT 'unknown'")
    except sqlite3.OperationalError:
        pass  # column already exists
    for col in ("multi_2k", "multi_3k", "multi_4k", "multi_5k",
                "clutch_1v1", "clutch_1v2", "clutch_1v3", "clutch_1v4", "clutch_1v5",
                "econ", "plants", "defuses"):
        try:
            cur.execute(f"ALTER TABLE map_player_stats ADD COLUMN {col} INTEGER")
        except sqlite3.OperationalError:
            pass  # column already exists
    cur.execute("DROP TABLE IF EXISTS event_agent_stats")
    conn.commit()
    return conn


# ---------------------------------------------------------------------------
# Parsing helpers
# ---------------------------------------------------------------------------
def clean(text: Optional[str]) -> str:
    return re.sub(r"\s+", " ", text or "").strip()


def to_float(text: str) -> Optional[float]:
    text = clean(text).replace("%", "")
    try:
        return float(text)
    except ValueError:
        return None


def to_int(text: str) -> Optional[int]:
    text = clean(text)
    try:
        return int(text)
    except ValueError:
        return None


# See vlr_vct_scraper.py's own copy for the full rationale -- ported
# unchanged, same VLR page format for EWC matches as VCT ones.
VETO_CLAUSE_RE = re.compile(r"^(?P<tag>\S+)\s+(?P<action>ban|pick)\s+(?P<map>.+)$", re.IGNORECASE)
VETO_REMAINS_RE = re.compile(r"^(?P<map>.+?)\s+remains$", re.IGNORECASE)


def parse_veto_note(note_text: str):
    clauses = [c.strip() for c in (note_text or "").split(";") if c.strip()]
    out = []
    for clause in clauses:
        m = VETO_REMAINS_RE.match(clause)
        if m:
            out.append((None, "decider", m.group("map").strip()))
            continue
        m = VETO_CLAUSE_RE.match(clause)
        if m:
            out.append((m.group("tag"), m.group("action").lower(), m.group("map").strip()))
    return out


# ---------------------------------------------------------------------------
# Scrapers (mirror vlr_vct_scraper.py's logic exactly — same page layouts)
# ---------------------------------------------------------------------------
def scrape_event_stats(session, conn, event_id: int, slug: str):
    url = f"{BASE}/event/stats/{event_id}/{slug}"
    print(f"[stats] {url}")
    soup = fetch(url, session)
    if soup is None:
        return

    table = soup.find("table")
    if table is None:
        print("  no stats table found (event may have no completed matches yet)")
        return

    rows = table.find("tbody").find_all("tr") if table.find("tbody") else table.find_all("tr")[1:]
    cur = conn.cursor()
    count = 0
    for row in rows:
        cells = row.find_all("td")
        if len(cells) < 20:
            continue

        player_cell = cells[0]
        player_link = player_cell.find("a")
        player_name = clean(player_link.get_text()) if player_link else clean(player_cell.get_text())
        player_url = BASE + player_link["href"] if player_link and player_link.has_attr("href") else None
        team_div = player_cell.find_all("div")
        team = clean(team_div[-1].get_text()) if team_div else None

        agents_cell = cells[1]
        agent_imgs = agents_cell.find_all("img")
        agents = ",".join(sorted({img["src"].split("/")[-1].replace(".png", "") for img in agent_imgs}))

        def val(i):
            return clean(cells[i].get_text())

        cur.execute(
            """INSERT OR REPLACE INTO player_event_stats
            (event_id, player, player_url, team, agents, maps_played, rounds_played,
             rating, acs, kd, kast, adr, kpr, apr, fkfd, fkpr, fdpr, hs_pct, cl_pct, cl,
             kmax, kills, deaths, assists, first_kills, first_deaths)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (
                event_id, player_name, player_url, team, agents,
                to_int(val(2)), to_int(val(3)), to_float(val(4)), to_float(val(5)),
                to_float(val(6)), val(7), to_float(val(8)), to_float(val(9)),
                to_float(val(10)), to_float(val(11)), to_float(val(12)), to_float(val(13)),
                val(14), val(15), val(16), to_int(val(17)), to_int(val(18)), to_int(val(19)),
                to_int(val(20)) if len(cells) > 20 else None,
                to_int(val(21)) if len(cells) > 21 else None,
                to_int(val(22)) if len(cells) > 22 else None,
            ),
        )
        count += 1
    conn.commit()
    print(f"  saved {count} player rows")


def scrape_event_agents(session, conn, event_id: int, slug: str):
    """See vlr_vct_scraper.py's version of this function for full rationale
    and the confirmed real-page structure it's built against."""
    url = f"{BASE}/event/agents/{event_id}/{slug}"
    print(f"[agents] {url}")
    soup = fetch(url, session)
    if soup is None:
        return

    table = soup.select_one("table.wf-table.mod-pr-global")
    if table is None:
        print("  no map/agent utilization table found")
        return

    rows = table.find_all("tr")
    if not rows:
        return
    header_cells = rows[0].find_all("th")

    agent_order = []
    for th in header_cells:
        img = th.find("img")
        if img and img.get("src"):
            slug_name = img["src"].rstrip("/").split("/")[-1].replace(".png", "")
            agent_order.append(slug_name)
        else:
            agent_order.append(None)

    cur = conn.cursor()
    map_count = 0
    util_count = 0
    for row in rows[1:]:
        cells = row.find_all("td")
        if len(cells) < 4:
            continue

        map_cell_text = clean(cells[0].get_text())
        span = cells[0].find("span")
        if span is not None:
            icon_letter = clean(span.get_text())
            if map_cell_text.startswith(icon_letter):
                map_cell_text = clean(map_cell_text[len(icon_letter):])
        map_name = map_cell_text if map_cell_text else "ALL"

        rounds_played = to_int(clean(cells[1].get_text())) if len(cells) > 1 else None
        atk_win_pct = clean(cells[2].get_text()) if len(cells) > 2 else None
        def_win_pct = clean(cells[3].get_text()) if len(cells) > 3 else None

        cur.execute(
            """INSERT OR REPLACE INTO event_map_summary
            (event_id, map_name, rounds_played, atk_win_pct, def_win_pct)
            VALUES (?,?,?,?,?)""",
            (event_id, map_name, rounds_played, atk_win_pct, def_win_pct),
        )
        map_count += 1

        agent_cols = agent_order[4:]
        util_cells = cells[4:]
        for agent, cell in zip(agent_cols, util_cells):
            if not agent:
                continue
            utilization_pct = clean(cell.get_text())
            cur.execute(
                """INSERT OR REPLACE INTO event_map_agent_utilization
                (event_id, map_name, agent, utilization_pct)
                VALUES (?,?,?,?)""",
                (event_id, map_name, agent, utilization_pct),
            )
            util_count += 1

    conn.commit()
    print(f"  saved {map_count} map rows, {util_count} agent-utilization cells")


def scrape_match_list(session, event_id: int, slug: str) -> list:
    """Returns list of dicts {match_id, match_url, status, team1, team2}.
    Status ('completed' / 'live' / 'upcoming') is read from the row's own
    text rather than a specific CSS class, so it survives minor markup
    changes on VLR's end."""
    url = f"{BASE}/event/matches/{event_id}/{slug}/?series_id=all"
    print(f"[matches list] {url}")
    soup = fetch(url, session)
    if soup is None:
        return []

    match_links = soup.select("a.match-item")
    matches = []
    for a in match_links:
        href = a.get("href", "")
        m = re.match(r"/(\d+)/", href)
        if not m:
            continue
        match_id = int(m.group(1))
        text = clean(a.get_text())

        if "Completed" in text:
            status = "completed"
        elif "LIVE" in text:
            status = "live"
        else:
            status = "upcoming"

        team_name_els = a.select(".match-item-vs-team-name")
        team1 = clean(team_name_els[0].get_text()) if len(team_name_els) > 0 else None
        team2 = clean(team_name_els[1].get_text()) if len(team_name_els) > 1 else None

        matches.append({
            "match_id": match_id,
            "match_url": BASE + href,
            "status": status,
            "team1": team1,
            "team2": team2,
        })

    completed = sum(1 for m in matches if m["status"] == "completed")
    live = sum(1 for m in matches if m["status"] == "live")
    upcoming = sum(1 for m in matches if m["status"] == "upcoming")
    print(f"  found {len(matches)} matches ({completed} completed, {live} live, {upcoming} upcoming)")
    return matches


def scrape_match_performance(session, conn, match_id: int, match_url: str,
                              game_id_to_map_index: dict) -> int:
    """See vlr_vct_scraper.py's version of this function for full rationale
    and the confirmed real-page structure it's built against. Scrapes the
    '?tab=performance' view for multi-kill (2K-5K) and clutch (1v1-1v5)
    counts plus ECON/plants/defuses, per player per map."""
    perf_url = match_url.rstrip("/") + "/?tab=performance"
    soup = fetch(perf_url, session)
    if soup is None:
        return 0

    def stat_cell_value(td):
        cell = td.find("div", class_="stats-sq")
        if cell is None:
            return None
        if "mod-egg" in (cell.get("class") or []):
            return 0
        direct_text = clean("".join(cell.find_all(string=True, recursive=False)))
        return to_int(direct_text) if direct_text else None

    cur = conn.cursor()
    rows_updated = 0
    game_divs = soup.select(".vm-stats-game")
    for game in game_divs:
        game_id = game.get("data-game-id", "")
        if game_id not in game_id_to_map_index:
            continue
        map_index = game_id_to_map_index[game_id]

        table = game.select_one("table.wf-table-inset.mod-adv-stats")
        if table is None:
            continue

        for row in table.find_all("tr")[1:]:
            tds = row.find_all("td")
            if len(tds) < 14:
                continue

            name_container = tds[0].select_one(".team > div")
            player = clean("".join(name_container.find_all(string=True, recursive=False))) \
                if name_container else None
            if not player:
                continue

            vals = [stat_cell_value(td) for td in tds[2:14]]
            (multi_2k, multi_3k, multi_4k, multi_5k,
             clutch_1v1, clutch_1v2, clutch_1v3, clutch_1v4, clutch_1v5,
             econ, plants, defuses) = vals

            cur.execute(
                """UPDATE map_player_stats SET
                   multi_2k=?, multi_3k=?, multi_4k=?, multi_5k=?,
                   clutch_1v1=?, clutch_1v2=?, clutch_1v3=?, clutch_1v4=?, clutch_1v5=?,
                   econ=?, plants=?, defuses=?
                   WHERE match_id=? AND map_index=? AND player=? AND side='both'""",
                (multi_2k, multi_3k, multi_4k, multi_5k,
                 clutch_1v1, clutch_1v2, clutch_1v3, clutch_1v4, clutch_1v5,
                 econ, plants, defuses,
                 match_id, map_index, player),
            )
            rows_updated += cur.rowcount if cur.rowcount > 0 else 0

        # Player duel matrix -- see vlr_vct_scraper.py's own copy of this
        # block for the full rationale, ported unchanged.
        duel_table = game.select_one("table.wf-table-inset.mod-matrix.mod-normal")
        if duel_table is not None:
            duel_rows = duel_table.find_all("tr")

            def matrix_player(td):
                name_div = td.select_one(".team > div")
                return clean("".join(name_div.find_all(string=True, recursive=False))) \
                    if name_div else None

            if duel_rows:
                col_players = [matrix_player(td) for td in duel_rows[0].find_all("td")[1:]]
                for row in duel_rows[1:]:
                    tds = row.find_all("td")
                    if not tds:
                        continue
                    row_player = matrix_player(tds[0])
                    if not row_player:
                        continue
                    for col_idx, td in enumerate(tds[1:]):
                        if col_idx >= len(col_players) or not col_players[col_idx]:
                            continue
                        sqs = td.select(".stats-sq")
                        if len(sqs) < 2:
                            continue
                        cur.execute(
                            """INSERT OR REPLACE INTO map_player_duels
                            (match_id, map_index, player1, player2, player1_kills, player2_kills)
                            VALUES (?,?,?,?,?,?)""",
                            (match_id, map_index, row_player, col_players[col_idx],
                             to_int(clean(sqs[0].get_text())), to_int(clean(sqs[1].get_text()))),
                        )
    conn.commit()
    return rows_updated


def scrape_match_economy(session, conn, match_id: int, match_url: str,
                          game_id_to_map_index: dict, team1: str, team2: str) -> int:
    """See vlr_vct_scraper.py's version of this function for full rationale
    and the confirmed real-page structure it's built against. Scrapes the
    '?tab=economy' view: per-map team buy-type summary plus round-by-round
    bank/loadout/buy-type/win data."""
    econ_url = match_url.rstrip("/") + "/?tab=economy"
    soup = fetch(econ_url, session)
    if soup is None:
        return 0

    cur = conn.cursor()
    rows_saved = 0
    game_divs = soup.select(".vm-stats-game")
    for game in game_divs:
        game_id = game.get("data-game-id", "")
        if game_id not in game_id_to_map_index:
            continue
        map_index = game_id_to_map_index[game_id]

        econ_tables = game.select("table.wf-table-inset.mod-econ")
        for table in econ_tables:
            if table.find("th"):
                for row in table.find_all("tr")[1:]:
                    tds = row.find_all("td")
                    if len(tds) < 6:
                        continue
                    team = clean(tds[0].get_text())

                    def parse_n_won(text):
                        m = re.match(r"(\d+)\s*\((\d+)\)", clean(text))
                        if m:
                            return to_int(m.group(1)), to_int(m.group(2))
                        return None, None

                    pistol_won = to_int(clean(tds[1].get_text()))
                    eco_rounds, eco_won = parse_n_won(tds[2].get_text())
                    semi_eco_rounds, semi_eco_won = parse_n_won(tds[3].get_text())
                    semi_buy_rounds, semi_buy_won = parse_n_won(tds[4].get_text())
                    full_buy_rounds, full_buy_won = parse_n_won(tds[5].get_text())

                    cur.execute(
                        """INSERT OR REPLACE INTO map_team_economy
                        (match_id, map_index, team, pistol_won, eco_rounds, eco_won,
                         semi_eco_rounds, semi_eco_won, semi_buy_rounds, semi_buy_won,
                         full_buy_rounds, full_buy_won)
                        VALUES (?,?,?,?,?,?,?,?,?,?,?,?)""",
                        (match_id, map_index, team, pistol_won, eco_rounds, eco_won,
                         semi_eco_rounds, semi_eco_won, semi_buy_rounds, semi_buy_won,
                         full_buy_rounds, full_buy_won),
                    )
                    rows_saved += 1
            else:
                # VLR splits this into MULTIPLE <tr> rows (one per chunk of
                # up to 12-13 rounds: first half, second half, OT), each
                # td self-labelled with its own round number via
                # .round-num -- so visiting every row's cells is enough,
                # no manual round counter needed. table.find("tr") here
                # previously grabbed only the first row, silently dropping
                # every map's second half and beyond (see the matching fix
                # in vlr_vct_scraper.py for the full writeup).
                for tr in table.find_all("tr"):
                    tds = tr.find_all("td")
                    for td in tds[1:]:
                        round_num_el = td.select_one(".round-num")
                        round_num = to_int(clean(round_num_el.get_text())) if round_num_el else None
                        if round_num is None:
                            continue

                        banks = td.select(".bank")
                        rnd_sqs = td.select(".rnd-sq")
                        t1_bank = clean(banks[0].get_text()) if len(banks) > 0 else None
                        t2_bank = clean(banks[1].get_text()) if len(banks) > 1 else None

                        t1_loadout = to_int(rnd_sqs[0].get("title")) if len(rnd_sqs) > 0 else None
                        t1_buy = clean(rnd_sqs[0].get_text()) if len(rnd_sqs) > 0 else None
                        t1_win = 1 if len(rnd_sqs) > 0 and "mod-win" in (rnd_sqs[0].get("class") or []) else 0

                        t2_loadout = to_int(rnd_sqs[1].get("title")) if len(rnd_sqs) > 1 else None
                        t2_buy = clean(rnd_sqs[1].get_text()) if len(rnd_sqs) > 1 else None
                        t2_win = 1 if len(rnd_sqs) > 1 and "mod-win" in (rnd_sqs[1].get("class") or []) else 0

                        cur.execute(
                            """INSERT OR REPLACE INTO map_round_economy
                            (match_id, map_index, round_num, team1_bank, team1_loadout,
                             team1_buy_type, team1_round_win, team2_bank, team2_loadout,
                             team2_buy_type, team2_round_win)
                            VALUES (?,?,?,?,?,?,?,?,?,?,?)""",
                            (match_id, map_index, round_num, t1_bank, t1_loadout,
                             t1_buy, t1_win, t2_bank, t2_loadout, t2_buy, t2_win),
                        )
                        rows_saved += 1
    conn.commit()
    return rows_saved


def build_game_id_to_map_index(soup):
    """
    Reconstructs the data-game-id -> map_index mapping from a match's
    Overview-tab page, read-only (no DB writes) -- for re-fetching a
    match's Economy tab without re-scraping/re-parsing its box scores.
    Deliberately duplicates (rather than shares) the same filter
    scrape_match_detail uses, so this targeted backfill path can't risk
    regressing the main, already-verified-correct scrape.
    """
    mapping = {}
    map_index = 0
    for game in soup.select(".vm-stats-game"):
        game_id = game.get("data-game-id", "")
        if game_id == "all":
            continue
        map_name_el = game.select_one(".map div > span")
        raw_map_name = clean(map_name_el.get_text()).split("\n")[0] if map_name_el else None
        team_scores = game.select(".score")
        t1_score = to_int(clean(team_scores[0].get_text())) if len(team_scores) > 0 else None
        t2_score = to_int(clean(team_scores[1].get_text())) if len(team_scores) > 1 else None
        is_real_map = (
            raw_map_name and raw_map_name.upper() != "TBD"
            and t1_score is not None and t2_score is not None
            and (t1_score > 0 or t2_score > 0)
        )
        if not is_real_map:
            continue
        map_index += 1
        mapping[game_id] = map_index
    return mapping


def rescrape_match_economy_only(session, conn, match_id: int, match_url: str) -> int:
    """Backfills just the round-by-round economy data for an already-correctly
    scraped match -- 2 fetches (Overview + Economy) instead of
    scrape_match_detail's 3, and no re-parsing of already-correct box scores."""
    soup = fetch(match_url, session)
    if soup is None:
        print(f"  [warn] match {match_id}: could not re-fetch overview page, skipping")
        return 0
    teams = soup.select(".match-header-link-name .wf-title-med")
    team1 = clean(teams[0].get_text()) if len(teams) > 0 else None
    team2 = clean(teams[1].get_text()) if len(teams) > 1 else None
    game_id_to_map_index = build_game_id_to_map_index(soup)
    if not game_id_to_map_index:
        print(f"  [warn] match {match_id}: no maps found on re-fetch, skipping")
        return 0
    return scrape_match_economy(session, conn, match_id, match_url, game_id_to_map_index, team1, team2)


def rescrape_all_economy(session, conn, event_ids=None):
    """Re-scrapes ONLY the economy tab for every completed match already in
    the DB (optionally scoped to specific event_ids)."""
    cur = conn.cursor()
    if event_ids:
        placeholders = ",".join("?" * len(event_ids))
        cur.execute(
            f"SELECT match_id, match_url FROM matches "
            f"WHERE status IN ('completed','partial') AND event_id IN ({placeholders}) ORDER BY match_id",
            event_ids,
        )
    else:
        cur.execute("SELECT match_id, match_url FROM matches WHERE status IN ('completed','partial') ORDER BY match_id")
    rows = cur.fetchall()
    print(f"Re-scraping economy data for {len(rows)} completed/partial matches...")
    for i, (match_id, match_url) in enumerate(rows, 1):
        try:
            n = rescrape_match_economy_only(session, conn, match_id, match_url)
            print(f"  [{i}/{len(rows)}] match {match_id}: {n} round-economy rows")
        except KeyboardInterrupt:
            print("\nInterrupted — progress saved to DB.")
            raise
        except ScrapeFailure:
            raise  # fatal and run-wide -- must not be swallowed as a per-match error
        except Exception as e:
            FAILURES["match"] += 1
            print(f"  !! failed on match {match_id}: {e}")
            continue


def backfill_map_game_ids(session, conn, event_ids=None):
    """Backfills just `maps.vlr_game_id` for every completed match already in
    the DB -- one fetch/match (Overview tab only, via the existing
    build_game_id_to_map_index() read-only helper -- see
    rescrape_match_economy_only()'s own use of it above for the same
    one-fetch pattern), not scrape_match_detail's three. Every other column
    on `maps` is already correct; this only ever needs a targeted UPDATE,
    never the INSERT OR REPLACE the full rescrape functions use (which would
    require re-deriving every other column just to avoid wiping them)."""
    cur = conn.cursor()
    if event_ids:
        placeholders = ",".join("?" * len(event_ids))
        cur.execute(
            f"SELECT match_id, match_url FROM matches "
            f"WHERE status IN ('completed','partial') AND event_id IN ({placeholders}) ORDER BY match_id",
            event_ids,
        )
    else:
        cur.execute(
            "SELECT match_id, match_url FROM matches WHERE status IN ('completed','partial') ORDER BY match_id"
        )
    rows = cur.fetchall()
    print(f"Backfilling map game ids for {len(rows)} completed/partial matches...")
    for i, (match_id, match_url) in enumerate(rows, 1):
        try:
            soup = fetch(match_url, session)
            if soup is None:
                print(f"  [{i}/{len(rows)}] match {match_id}: could not fetch, skipping")
                continue
            mapping = build_game_id_to_map_index(soup)
            if not mapping:
                print(f"  [{i}/{len(rows)}] match {match_id}: no maps found, skipping")
                continue
            for game_id, map_index in mapping.items():
                cur.execute(
                    "UPDATE maps SET vlr_game_id = ? WHERE match_id = ? AND map_index = ?",
                    (game_id, match_id, map_index),
                )
            conn.commit()
            print(f"  [{i}/{len(rows)}] match {match_id}: {len(mapping)} map id(s)")
        except KeyboardInterrupt:
            print("\nInterrupted — progress saved to DB.")
            raise
        except ScrapeFailure:
            raise  # fatal and run-wide -- must not be swallowed as a per-match error
        except Exception as e:
            FAILURES["match"] += 1
            print(f"  !! failed on match {match_id}: {e}")
            continue


def rescrape_all_match_details(session, conn, event_ids=None):
    """Re-scrapes FULL match detail (Overview + Performance + Economy) for
    every completed match already in the DB, skipping event-level stats/
    agents/match-list discovery. Reuses scrape_match_detail() as one atomic
    unit rather than a narrower partial re-parse, since INSERT OR REPLACE
    replaces the whole row -- a box-score-only re-insert would silently
    wipe multi_2k/clutch_*/econ/plants/defuses back to NULL on the
    existing 'both' row. See vlr_vct_scraper.py for the full writeup."""
    cur = conn.cursor()
    if event_ids:
        placeholders = ",".join("?" * len(event_ids))
        cur.execute(
            f"SELECT match_id, event_id, match_url FROM matches "
            f"WHERE status IN ('completed','partial') AND event_id IN ({placeholders}) ORDER BY match_id",
            event_ids,
        )
    else:
        cur.execute(
            "SELECT match_id, event_id, match_url FROM matches WHERE status IN ('completed','partial') ORDER BY match_id"
        )
    rows = cur.fetchall()
    print(f"Re-scraping full match detail for {len(rows)} completed/partial matches...")
    for i, (match_id, event_id, match_url) in enumerate(rows, 1):
        try:
            if scrape_match_detail(session, conn, event_id, match_id, match_url):
                print(f"  [{i}/{len(rows)}] match {match_id} done")
            else:
                FAILURES["match"] += 1
                print(f"  [{i}/{len(rows)}] match {match_id} incomplete -- left as 'partial'")
        except KeyboardInterrupt:
            print("\nInterrupted — progress saved to DB.")
            raise
        except ScrapeFailure:
            raise  # fatal and run-wide -- must not be swallowed as a per-match error
        except Exception as e:
            FAILURES["match"] += 1
            print(f"  !! failed on match {match_id}: {e}")
            continue


def scrape_match_detail(session, conn, event_id: int, match_id: int, match_url: str, dump_html: bool = False):
    """See vlr_vct_scraper.py's version of this function for full rationale.
    Score is derived from counting map wins (robust) rather than trusting a
    single header selector; player-table detection is widened; a
    --dump-html debug path is available if selectors need re-verifying."""
    soup = fetch(match_url, session)
    if soup is None:
        # Nothing written — the match keeps whatever status it already had, so
        # a fetch failure here leaves it eligible for retry rather than
        # recording an empty 'completed' row.
        return False

    if dump_html:
        dump_path = f"debug_match_{match_id}.html"
        with open(dump_path, "w", encoding="utf-8") as f:
            f.write(soup.prettify())
        print(f"  [debug] dumped raw HTML to {dump_path}")

    teams = soup.select(".match-header-link-name .wf-title-med")
    team1 = clean(teams[0].get_text()) if len(teams) > 0 else None
    team2 = clean(teams[1].get_text()) if len(teams) > 1 else None

    header_score1 = header_score2 = None
    score_els = soup.select(".match-header-vs-score .js-spoiler") or soup.select(".match-header-vs-score")
    if score_els:
        score_text = clean(score_els[0].get_text())
        nums = re.findall(r"\d+", score_text)
        if len(nums) >= 2:
            header_score1, header_score2 = to_int(nums[0]), to_int(nums[1])

    stage_el = soup.select_one(".match-header-event-series")
    stage = clean(stage_el.get_text()) if stage_el else None

    date_el = soup.select_one(".moment-tz-convert")
    match_date = date_el["data-utc-ts"] if date_el and date_el.has_attr("data-utc-ts") else None

    cur = conn.cursor()

    game_divs = soup.select(".vm-stats-game")
    map_index = 0
    maps_team1_wins = 0
    maps_team2_wins = 0
    total_player_rows = 0
    game_id_to_map_index = {}
    team_tag_map = {}  # short VLR org tag -> full team name, for the veto
                        # note below -- see vlr_vct_scraper.py's own copy

    for game in game_divs:
        game_id = game.get("data-game-id", "")
        if game_id == "all":
            continue

        map_name_el = game.select_one(".map div > span")
        raw_map_name = clean(map_name_el.get_text()).split("\n")[0] if map_name_el else None
        map_name = re.sub(r"\s*(PICK|BAN|DECIDER)\s*$", "", raw_map_name, flags=re.IGNORECASE).strip() \
            if raw_map_name else None

        team_scores = game.select(".score")
        t1_score = to_int(clean(team_scores[0].get_text())) if len(team_scores) > 0 else None
        t2_score = to_int(clean(team_scores[1].get_text())) if len(team_scores) > 1 else None

        header_teams = game.select(".vm-stats-game-header .team")
        t1_atk = t1_def = t2_atk = t2_def = None
        if len(header_teams) > 0:
            atk_el = header_teams[0].select_one("span.mod-t")
            def_el = header_teams[0].select_one("span.mod-ct")
            t1_atk = to_int(clean(atk_el.get_text())) if atk_el else None
            t1_def = to_int(clean(def_el.get_text())) if def_el else None
        if len(header_teams) > 1:
            atk_el = header_teams[1].select_one("span.mod-t")
            def_el = header_teams[1].select_one("span.mod-ct")
            t2_atk = to_int(clean(atk_el.get_text())) if atk_el else None
            t2_def = to_int(clean(def_el.get_text())) if def_el else None

        duration_el = game.select_one(".map-duration")
        duration = clean(duration_el.get_text()) if duration_el else None

        is_real_map = (
            raw_map_name and raw_map_name.upper() != "TBD"
            and t1_score is not None and t2_score is not None
            and (t1_score > 0 or t2_score > 0)
        )
        if not is_real_map:
            continue

        map_index += 1
        game_id_to_map_index[game_id] = map_index
        if t1_score > t2_score:
            maps_team1_wins += 1
        elif t2_score > t1_score:
            maps_team2_wins += 1

        cur.execute(
            """INSERT OR REPLACE INTO maps
            (match_id, map_index, map_name, team1_score, team2_score,
             team1_atk_score, team1_def_score, team2_atk_score, team2_def_score, duration, vlr_game_id)
            VALUES (?,?,?,?,?,?,?,?,?,?,?)""",
            (match_id, map_index, map_name, t1_score, t2_score, t1_atk, t1_def, t2_atk, t2_def, duration, game_id),
        )

        # Per-round winner + side + win condition, from the ".vlr-rounds"
        # bar in this same Overview-tab fetch. See vlr_vct_scraper.py for
        # the full writeup -- confirmed against a real dumped page (19 of
        # 19 rounds on a 6-13 map, matching the final score exactly).
        rounds_block = game.select_one(".vlr-rounds")
        if rounds_block:
            # Long maps (OT) wrap into MULTIPLE ".vlr-rounds-row" divs, each
            # with its own leading team-name header column -- see
            # vlr_vct_scraper.py for the full writeup. Filtering by "has a
            # real round number" instead of slicing off "the first column"
            # handles this correctly regardless of row count.
            round_cols = [
                c for c in rounds_block.select(".vlr-rounds-row-col")
                if c.select_one(".rnd-num") is not None
            ]
            for col in round_cols:
                num_el = col.select_one(".rnd-num")
                round_num = to_int(clean(num_el.get_text())) if num_el else None
                if round_num is None:
                    continue
                sqs = col.select(".rnd-sq")
                win_sq = col.select_one(".rnd-sq.mod-win")
                if win_sq is None or len(sqs) < 2:
                    continue
                team_idx = sqs.index(win_sq)
                winner = team1 if team_idx == 0 else team2
                win_classes = win_sq.get("class", [])
                winner_side = "t" if "mod-t" in win_classes else ("ct" if "mod-ct" in win_classes else None)
                icon_img = win_sq.select_one("img")
                win_condition = None
                if icon_img and icon_img.get("src"):
                    win_condition = icon_img["src"].rsplit("/", 1)[-1].split(".")[0]
                cur.execute(
                    """INSERT OR REPLACE INTO map_round_results
                    (match_id, map_index, round_num, winner, winner_side, win_condition)
                    VALUES (?,?,?,?,?,?)""",
                    (match_id, map_index, round_num, winner, winner_side, win_condition),
                )

        # Player box score lives in a div-grid (VLR redesigned away from
        # <table>): ".ovw-table" (per team) > ".ovw-row" (per player) >
        # cells identified by "data-col" (e.g. "rating2", "acs", "kast",
        # "adr", "hsp", "fb"=first kills, "fd", "fk-diff"). K/D/A are nested
        # inside one ".mod-kda" cell with their own data-col each.
        ovw_tables = game.select(".ovw-table")
        for team_idx, table in enumerate(ovw_tables[:2]):
            team_name = team1 if team_idx == 0 else team2
            rows = table.select(".ovw-row:not(.mod-head)")
            for row in rows:
                name_el = row.select_one(".ovw-player-name") or row.select_one("a[href*='/player/']")
                player = clean(name_el.get_text()) if name_el else None
                if not player:
                    continue

                agent_img = row.select_one(".ovw-agents img") or row.find("img")
                agent = None
                if agent_img:
                    agent = agent_img.get("title") or agent_img.get("alt")

                # Short org tag, for the veto note below -- see
                # vlr_vct_scraper.py's own copy for the rationale.
                tag_el = row.select_one(".ovw-player-tag")
                if tag_el:
                    tag = clean(tag_el.get_text())
                    if tag:
                        team_tag_map[tag] = team_name

                flag_el = row.select_one(".flag")
                if flag_el:
                    country_name = flag_el.get("title")
                    country_code = None
                    for cls in flag_el.get("class", []):
                        if cls.startswith("mod-") and cls != "mod-":
                            country_code = cls.replace("mod-", "", 1)
                            break
                    if country_name or country_code:
                        cur.execute(
                            """INSERT OR REPLACE INTO player_nationality
                            (player, country_code, country_name) VALUES (?,?,?)""",
                            (player, country_code, country_name),
                        )

                def cell_val(data_col, side_class="mod-both"):
                    cell = row.select_one(f'[data-col="{data_col}"]')
                    if not cell:
                        return None
                    span = cell.select_one(f"span.side.{side_class}")
                    return clean(span.get_text()) if span else clean(cell.get_text())

                # Every stat cell carries all three side variants as nested
                # spans (side.mod-both / side.mod-t / side.mod-ct), already
                # present in the static HTML -- see the matching writeup in
                # vlr_vct_scraper.py. side='both' is the pre-existing row;
                # 't' (attack) and 'ct' (defend) are new.
                for side_class, side_label in (("mod-both", "both"), ("mod-t", "t"), ("mod-ct", "ct")):
                    rating = to_float(cell_val("rating2", side_class))
                    acs = to_float(cell_val("acs", side_class))
                    kills = to_int(cell_val("kills", side_class))
                    deaths = to_int(cell_val("deaths", side_class))
                    assists = to_int(cell_val("assists", side_class))
                    kd_diff_raw = cell_val("kd-diff", side_class)
                    kd_diff = to_int(kd_diff_raw.replace("+", "")) if kd_diff_raw else None
                    kast = cell_val("kast", side_class)
                    adr = to_float(cell_val("adr", side_class))
                    hs_pct = cell_val("hsp", side_class)
                    fk = to_int(cell_val("fb", side_class))
                    fd = to_int(cell_val("fd", side_class))
                    fkfd_diff_raw = cell_val("fk-diff", side_class)
                    fkfd_diff = to_int(fkfd_diff_raw.replace("+", "")) if fkfd_diff_raw else None

                    if all(v is None for v in (rating, acs, kills, deaths, assists, adr)):
                        continue

                    cur.execute(
                        """INSERT OR REPLACE INTO map_player_stats
                        (match_id, map_index, player, team, agent, rating, acs, kills, deaths,
                         assists, kd_diff, kast, adr, hs_pct, first_kills, first_deaths,
                         fk_fd_diff, side)
                        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                        (
                            match_id, map_index, player, team_name, agent, rating, acs, kills,
                            deaths, assists, kd_diff, kast, adr, hs_pct, fk, fd, fkfd_diff, side_label,
                        ),
                    )
                    if side_label == "both":
                        total_player_rows += 1

    # Map veto sequence -- see vlr_vct_scraper.py's own copy for the full
    # rationale, ported unchanged.
    note_el = soup.select_one(".match-header-note")
    veto_clauses = parse_veto_note(clean(note_el.get_text())) if note_el else []
    for order_num, (tag, action, veto_map_name) in enumerate(veto_clauses, start=1):
        veto_team = (team_tag_map.get(tag, tag) if tag else None)
        cur.execute(
            """INSERT OR REPLACE INTO match_vetoes
            (match_id, order_num, team, action, map_name) VALUES (?,?,?,?,?)""",
            (match_id, order_num, veto_team, action, veto_map_name),
        )

    if map_index > 0:
        score1, score2 = maps_team1_wins, maps_team2_wins
    else:
        score1, score2 = header_score1, header_score2
        print(f"  [warn] match {match_id}: no map data parsed, falling back to header score "
              f"({header_score1}-{header_score2})")

    if map_index > 0 and total_player_rows == 0:
        print(f"  [warn] match {match_id}: {map_index} map(s) parsed but 0 player rows — "
              f"table selectors likely need updating. Re-run with --dump-html {match_id} to inspect.")

    # Only claim 'completed' when the page actually yielded usable data.
    # Writing 'completed' unconditionally is what turned a *transient* failure
    # into a permanent one: --resume skips any match already marked
    # 'completed', so an empty/garbage row would never be retried and the gap
    # would silently persist forever. 'partial' still records the row (the
    # match stays tracked, with whatever score could be derived) but leaves it
    # eligible for re-scrape next run. Under human supervision the [warn]
    # lines above were enough to catch this; an unattended cron has nobody
    # reading them.
    scrape_ok = map_index > 0 and total_player_rows > 0
    status = "completed" if scrape_ok else "partial"
    if not scrape_ok:
        print(f"  [partial] match {match_id}: stored as 'partial' — will be retried on the next run")

    # first_partial_at marks WHEN this match first went partial, separate from
    # match_date (when it was played) and last_checked_at (last recheck
    # attempt) -- it's what bounds how long event_needs_scrape() keeps chasing
    # it. Preserve the original value across repeat 'partial' results (so the
    # chase window doesn't quietly reset every recheck); clear it once
    # resolved, since a 'completed' match has nothing left to bound.
    cur.execute("SELECT status, first_partial_at FROM matches WHERE match_id = ?", (match_id,))
    existing = cur.fetchone()
    if status == "partial":
        if existing and existing[0] == "partial" and existing[1]:
            first_partial_at = existing[1]
        else:
            first_partial_at = datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S")
    else:
        first_partial_at = None

    cur.execute(
        """INSERT OR REPLACE INTO matches
        (match_id, event_id, team1, team2, score1, score2, stage, match_date, match_url, status,
         last_checked_at, first_partial_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?)""",
        (match_id, event_id, team1, team2, score1, score2, stage, match_date, match_url, status,
         datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S"), first_partial_at),
    )
    conn.commit()

    if scrape_ok:
        perf_rows = scrape_match_performance(session, conn, match_id, match_url, game_id_to_map_index)
        if perf_rows == 0:
            print(f"  [warn] match {match_id}: performance-tab data (multi-kills/clutches) "
                  f"came back empty — VLR markup for that tab may need re-checking.")

        econ_rows = scrape_match_economy(session, conn, match_id, match_url, game_id_to_map_index, team1, team2)
        if econ_rows == 0:
            print(f"  [warn] match {match_id}: economy-tab data came back empty — "
                  f"VLR markup for that tab may need re-checking.")

    return scrape_ok


# ---------------------------------------------------------------------------
# Orchestration
# ---------------------------------------------------------------------------
def scrape_event(session, conn, event_id, slug, region, stage, skip_matches=False, resume=False, dump_html_ids=None):
    dump_html_ids = dump_html_ids or set()
    print(f"\n=== EWC Event {event_id} — {slug} ({region} {stage}) ===")
    cur = conn.cursor()
    cur.execute(
        "INSERT OR REPLACE INTO events (event_id, slug, name, region, stage) VALUES (?,?,?,?,?)",
        (event_id, slug, slug.replace("-", " ").title(), region, stage),
    )
    conn.commit()

    scrape_event_stats(session, conn, event_id, slug)
    scrape_event_agents(session, conn, event_id, slug)

    if skip_matches:
        return

    matches = scrape_match_list(session, event_id, slug)
    for i, m in enumerate(matches, 1):
        match_id, match_url, status = m["match_id"], m["match_url"], m["status"]

        if status != "completed":
            cur.execute(
                """INSERT OR REPLACE INTO matches
                (match_id, event_id, team1, team2, score1, score2, stage, match_date, match_url, status)
                VALUES (?,?,?,?,?,?,?,?,?,?)""",
                (match_id, event_id, m["team1"], m["team2"], None, None, None, None, match_url, status),
            )
            conn.commit()
            print(f"  [{i}/{len(matches)}] match {match_id} — {status}, skipping (not played yet)")
            continue

        if resume:
            cur.execute("SELECT status, last_checked_at FROM matches WHERE match_id = ?", (match_id,))
            row = cur.fetchone()
            if row and row[0] == "completed":
                if not match_due_for_recheck(row[1]):
                    print(f"  [{i}/{len(matches)}] skip (already scraped) match {match_id}")
                    continue
                print(f"  [{i}/{len(matches)}] match {match_id} — re-checking (event still "
                      f"active; possible late data, e.g. rating/ACS)")

        print(f"  [{i}/{len(matches)}] match {match_id} — completed, scraping box score")
        if not scrape_match_detail(session, conn, event_id, match_id, match_url,
                                    dump_html=(match_id in dump_html_ids)):
            FAILURES["match"] += 1


def main():
    parser = argparse.ArgumentParser(
        description="Scrape VLR.gg Esports World Cup 2026 + qualifier statistics"
    )
    parser.add_argument("--events", type=int, nargs="*", help="Specific event IDs to scrape (default: all)")
    parser.add_argument("--skip-matches", action="store_true", help="Only scrape aggregate stats + agents (fast)")
    parser.add_argument("--resume", action="store_true", help="Skip matches already saved in the DB")
    parser.add_argument("--economy-only", action="store_true",
                         help="Re-scrape ONLY the round-by-round economy tab for matches already "
                              "in the DB (fixes the 'only 12 rounds captured' bug) without "
                              "re-doing event stats/agents or match box scores/performance data. "
                              "Combine with --events to scope to specific events.")
    parser.add_argument("--redo-match-details", action="store_true",
                         help="Re-scrape FULL match detail (Overview+Performance+Economy) for "
                              "every completed match already in the DB. Backfills the "
                              "round-economy fix, the attack/defense side-split, and the new "
                              "per-round winner/side/win-condition table, all at once. Combine "
                              "with --events to scope it.")
    parser.add_argument("--backfill-game-ids", action="store_true",
                         help="Backfill ONLY maps.vlr_game_id (VLR's own per-map id, powers "
                              "per-map deep links) for every completed match already in the DB. "
                              "One Overview-tab fetch/match, not the three --redo-match-details "
                              "costs -- every other column is already correct. Combine with "
                              "--events to scope it.")
    parser.add_argument("--db", default=DB_PATH, help="SQLite DB path")
    parser.add_argument("--require-existing-db", action="store_true",
                         help="Abort if the database does not already exist instead of "
                              "creating an empty one. For automated runs: init_db() will "
                              "happily create a fresh database, which turns a restore "
                              "failure into a silent full re-scrape of every match.")
    parser.add_argument("--dump-html", type=int, nargs="*", default=[],
                         help="Match ID(s) to save raw HTML for, e.g. --dump-html 594740 "
                              "(useful for debugging if player stats keep coming back empty)")
    args = parser.parse_args()
    dump_html_ids = set(args.dump_html)

    if args.require_existing_db and not os.path.exists(args.db):
        # init_db() creates the database if it is absent, which is correct for a
        # first run and disastrous for an automated one: a cache/restore miss
        # would silently kick off a full re-scrape of every match in the season
        # (hours of requests) instead of the handful of new ones expected.
        print(f"[FATAL] --require-existing-db was given but {args.db} does not exist.")
        print("        Refusing to create one from scratch. Restore the database first.")
        sys.exit(2)

    conn = init_db(args.db)
    session = requests.Session()

    if args.economy_only:
        try:
            rescrape_all_economy(session, conn, event_ids=args.events)
        except ScrapeFailure as e:
            print(f"\n[FATAL] {e}")
            conn.close()
            sys.exit(2)
        conn.close()
        print(f"\nDone. Data saved to {args.db}")
        sys.exit(failure_exit_code())

    if args.redo_match_details:
        try:
            rescrape_all_match_details(session, conn, event_ids=args.events)
        except ScrapeFailure as e:
            print(f"\n[FATAL] {e}")
            conn.close()
            sys.exit(2)
        conn.close()
        print(f"\nDone. Data saved to {args.db}")
        sys.exit(failure_exit_code())

    if args.backfill_game_ids:
        try:
            backfill_map_game_ids(session, conn, event_ids=args.events)
        except ScrapeFailure as e:
            print(f"\n[FATAL] {e}")
            conn.close()
            sys.exit(2)
        conn.close()
        print(f"\nDone. Data saved to {args.db}")
        sys.exit(failure_exit_code())

    events = EWC_2026_EVENTS
    if args.events:
        events = [e for e in events if e[0] in args.events]

    for event_id, slug, region, stage in events:
        # Closed events (nothing live, last match older than RECHECK_GRACE_DAYS)
        # are skipped outright -- 0 requests instead of the stats+agents+
        # match-list fetch every event used to get every run. --events on the
        # command line is an explicit ask and bypasses this; a run without
        # --resume is a deliberate full pass and also bypasses it, matching
        # how the match-level skip below is already gated on --resume.
        if args.resume and not args.events and not event_needs_scrape(conn, event_id):
            print(f"\n=== Event {event_id} — {slug} ({region} {stage}): no activity within "
                  f"the last {RECHECK_GRACE_DAYS} days, skipping ===")
            continue
        try:
            scrape_event(session, conn, event_id, slug, region, stage,
                         skip_matches=args.skip_matches, resume=args.resume,
                         dump_html_ids=dump_html_ids)
        except KeyboardInterrupt:
            print("\nInterrupted — progress saved to DB.")
            sys.exit(1)
        except ScrapeFailure as e:
            # Run-wide and fatal: stop now rather than working through every
            # remaining event just to fail each one the same way.
            print(f"\n[FATAL] {e}")
            conn.close()
            sys.exit(2)
        except Exception as e:
            FAILURES["event"] += 1
            print(f"  !! failed on event {event_id}: {e}")
            continue

    conn.close()
    print(f"\nDone. Data saved to {args.db}")
    sys.exit(failure_exit_code())


if __name__ == "__main__":
    main()
