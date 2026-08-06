#!/usr/bin/env python3
"""
vlr_vct_2023_scraper.py
===================
Scrapes VLR.gg for ALL available statistics on VCT (tier-1) 2023 events:
  - Event metadata
  - Aggregate player stats per event (the /event/stats/ table: rating, ACS, K:D,
    KAST, ADR, KPR, APR, FK:FD, FKPR, FDPR, HS%, CL%, CL, KMAX, K, D, A, FK, FD)
  - Agent composition / pick stats per event (/event/agents/)
  - Full match list per event (/event/matches/)
  - Per-match, per-map box scores for every player (from each match page)
  - Per-match map picks/bans and overall scoreline where available

Data is stored in a local SQLite database (vlr_vct_2023.db) and can be
exported to CSV afterwards (see export_to_csv.py).

USAGE
-----
    python3 vlr_vct_2023_scraper.py                  # scrape everything
    python3 vlr_vct_2023_scraper.py --events 1189     # scrape just one event id
    python3 vlr_vct_2023_scraper.py --skip-matches    # stats/agents only (fast)
    python3 vlr_vct_2023_scraper.py --resume          # skip matches already in DB
    python3 vlr_vct_2023_scraper.py --resume --require-existing-db
                                                 # as above, but abort instead of
                                                 # creating a DB if none exists
                                                 # (for unattended/automated runs)
    python3 vlr_vct_2023_scraper.py --economy-only    # re-fetch ONLY the economy tab
                                                   # for matches already in the DB
                                                   # (2 fetches/match instead of a
                                                   # full match_detail's 3; add
                                                   # --events to scope it)

NOTES
-----
- This is intentionally polite: ~1.5s delay between requests, retries with
  backoff, a real User-Agent, and it only hits vlr.gg.
- Run this on YOUR machine / environment with normal internet access —
  it will NOT run inside this sandboxed chat, which can't reach vlr.gg.
- Check vlr.gg's robots.txt / terms before doing heavy or commercial scraping.

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
from dataclasses import dataclass, field
from typing import Optional

import requests
from bs4 import BeautifulSoup

BASE = "https://www.vlr.gg"
# Environment-overridable so an automated run can point at a restored database
# elsewhere in the workspace without editing this file or passing --db.
DB_PATH = os.environ.get("VLR_VCT_2023_DB_PATH", "vlr_vct_2023.db")

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/124.0 Safari/537.36 "
        "vlr-vct-2023-research-scraper/1.0"
    )
}

REQUEST_DELAY = (1.2, 2.2)  # random delay range (seconds) between requests
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
# Tier-1 VCT 2023 events (id, slug, region, stage). Every id/slug below was
# confirmed directly against vlr.gg's own /vct-2023 season index page (not
# pattern-guessed), then cross-checked against a real team's (NRG, vlr.gg
# team id 1034) full match history to confirm every slug NRG's own matches
# reference actually resolves to one of these ten event ids.
#
# 2023's own event STRUCTURE is genuinely different from 2024/2025/2026's
# now-familiar Kickoff -> Stage 1 -> Stage 2 -> Champions shape -- this was
# VCT's first franchised season, and each region ran one long round-robin
# "League" (no mid-season stage split) followed by a "Last Chance
# Qualifier" for whoever didn't make playoffs/Masters via league standing.
# China's own qualifying path into Champions was a separate one-off
# "Champions China Qualifier" event rather than an LCQ. LOCK//IN São Paulo
# (an international season-opener, not a per-region event) predates the
# Kickoff concept entirely. Stage values reflect this real structure
# rather than being forced into the later seasons' vocabulary.
# ---------------------------------------------------------------------------
VCT_2023_EVENTS = [
    # (event_id, slug, region, stage)
    (1188, "champions-tour-2023-lock-in-s-o-paulo", "International", "LOCK//IN"),
    (1189, "champions-tour-2023-americas-league", "Americas", "League"),
    (1190, "champions-tour-2023-emea-league", "EMEA", "League"),
    (1191, "champions-tour-2023-pacific-league", "Pacific", "League"),
    (1658, "champions-tour-2023-americas-last-chance-qualifier", "Americas", "LCQ"),
    (1659, "champions-tour-2023-emea-last-chance-qualifier", "EMEA", "LCQ"),
    (1660, "champions-tour-2023-pacific-last-chance-qualifier", "Pacific", "LCQ"),
    (1664, "champions-tour-2023-champions-china-qualifier", "China", "China Qualifier"),
    (1494, "champions-tour-2023-masters-tokyo", "International", "Masters"),
    (1657, "valorant-champions-2023", "International", "Champions"),
]


# ---------------------------------------------------------------------------
# HTTP helper with retries / backoff / politeness
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
        time.sleep(2 ** attempt)  # exponential backoff
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


# Database setup
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

    cur.executescript(
        """
        CREATE TABLE IF NOT EXISTS events (
            event_id INTEGER PRIMARY KEY,
            slug TEXT,
            name TEXT,
            region TEXT,
            stage TEXT,
            dates TEXT,
            prize TEXT,
            location TEXT
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
        """
    )
    # Migrations for DBs created before these columns existed
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
    # The old event_agent_stats table (pre-rewrite) scraped the wrong tables
    # entirely (a standings widget + map-picks widget, not agent data) and
    # had no dedup logic, so any pre-existing copy is corrupted beyond
    # trusting — drop it. The correct replacement tables
    # (event_map_summary, event_map_agent_utilization) are created above.
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


# ---------------------------------------------------------------------------
# Scrapers
# ---------------------------------------------------------------------------
def scrape_event_stats(session, conn, event_id: int, slug: str):
    """Scrapes the aggregate player-performance table: /event/stats/{id}/{slug}"""
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
    """Scrapes the Map x Agent utilization matrix: /event/agents/{id}/{slug}

    Confirmed against a real dumped page: this page is NOT a per-agent
    performance table (no Rating/ACS/K:D here) — it's a single table
    (`table.wf-table.mod-pr-global`) with one row per map (plus an "ALL"
    aggregate row with a blank map-name cell), columns are: Map, # (rounds),
    ATK WIN%, DEF WIN%, then one utilization% column per agent (each
    identified by its icon image in the header row, not by alt/title text).
    A previous version of this function scraped the wrong tables entirely
    (a standings widget and a map-picks widget elsewhere on the page) and
    had no dedup logic — this rewrite fixes both.
    """
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

    # Agent order, from each header cell's icon filename (e.g.
    # ".../agents/killjoy.png" -> "killjoy"). The first 4 header columns
    # (Map, #, ATK WIN, DEF WIN) have no agent icon and are skipped.
    agent_order = []
    for th in header_cells:
        img = th.find("img")
        if img and img.get("src"):
            slug_name = img["src"].rstrip("/").split("/")[-1].replace(".png", "")
            agent_order.append(slug_name)
        else:
            agent_order.append(None)  # non-agent column (Map, #, ATK WIN, DEF WIN)

    cur = conn.cursor()
    map_count = 0
    util_count = 0
    for row in rows[1:]:
        cells = row.find_all("td")
        if len(cells) < 4:
            continue

        # Map name: a pseudo-icon <span> (e.g. "S") followed by the map name
        # text as a sibling text node (e.g. "Split") -- concatenated they'd
        # read "S Split", which is exactly the bug in the old version of
        # this function. The blank-map-name row is the "ALL maps" aggregate.
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

        # Utilization cells start at index 4, aligned positionally with
        # agent_order (skipping the first 4 non-agent header slots).
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
    """Returns list of dicts {match_id, match_url, status, team1, team2} for
    every match in an event — completed, live, or still upcoming.

    Status is detected from the row's own text (VLR literally prints
    "Completed", "LIVE", or leaves it as a bare time for "Upcoming") rather
    than a specific CSS class, so it keeps working even if VLR tweaks class
    names. Unplayed matches show '\u2013' (en dash) instead of a score.
    """
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
    """Scrapes the '?tab=performance' view of a match page for multi-kill
    (2K/3K/4K/5K) and clutch (1v1-1v5) counts, plus ECON/plants/defuses,
    per player per map — then UPDATEs the matching side='both' row already
    inserted by scrape_match_detail() (same match_id/map_index/player/side
    primary key; scoped to 'both' specifically since this tab's own markup
    has no confirmed per-side breakdown for these stats, unlike the
    Overview tab's rating/ACS/etc. -- duplicating an all-rounds number onto
    the attack/defense-only rows would be wrong, not just redundant).

    Confirmed structure (verified against a real dumped page): each map's
    ".vm-stats-game" container holds a genuine <table
    class="wf-table-inset mod-adv-stats"> — 14 columns in a fixed order:
    player, agent, 2K, 3K, 4K, 5K, 1v1, 1v2, 1v3, 1v4, 1v5, ECON, PL, DE.
    A zero value renders as an empty cell tagged class="mod-egg"; a real
    value sits as the cell's own direct text (a hover-tooltip listing the
    specific rounds is nested inside the same div, and must be excluded —
    hence the recursive=False text extraction below).
    """
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
            continue  # the "all" aggregate section, or a map we skipped as unplayed
        map_index = game_id_to_map_index[game_id]

        table = game.select_one("table.wf-table-inset.mod-adv-stats")
        if table is None:
            continue

        for row in table.find_all("tr")[1:]:  # first <tr> is the header
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
    conn.commit()
    return rows_updated


def scrape_match_economy(session, conn, match_id: int, match_url: str,
                          game_id_to_map_index: dict, team1: str, team2: str) -> int:
    """Scrapes the '?tab=economy' view of a match page: a per-map team-level
    buy-type summary (pistol rounds won, eco/semi-eco/semi-buy/full-buy round
    counts and wins) and a per-round breakdown (each team's bank, loadout
    value, buy type, and who won). Confirmed against a real dumped page.

    Both tables share the same class ("table.wf-table-inset.mod-econ") but
    are structurally distinct: the summary table has a <th> header row, the
    round-by-round table doesn't -- it's split across multiple <tr> rows
    (one per chunk of up to 12-13 rounds: first half, second half, then OT
    if any), each with one <td> per round in that chunk. Confirmed against
    a real dumped page.
    """
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
                # --- Team-level buy-type summary ---
                for row in table.find_all("tr")[1:]:
                    tds = row.find_all("td")
                    if len(tds) < 6:
                        continue
                    team = clean(tds[0].get_text())

                    def parse_n_won(text):
                        # Cells look like "3 (1)" = 3 rounds of this type, 1 won.
                        # The Pistol Won cell is a bare number instead.
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
                # --- Round-by-round breakdown ---
                # VLR splits this into MULTIPLE <tr> rows, not one --
                # confirmed against real matches: a 26-round game (13-13
                # after OT) came back as three <tr>s of 13+13+3 <td>s each,
                # which is 12+12+2 actual round cells once the leading
                # label column in each row is excluded -- exactly matching
                # that game's own round total. Previously only the first
                # <tr> was read (table.find("tr") grabs just one), which
                # silently dropped every map's second half and beyond;
                # every row in the DB having exactly 12 rounds was that bug,
                # not a real VLR limitation. Each td is self-labelled with
                # its own round number via .round-num, so simply visiting
                # every row's cells is sufficient -- no manual round
                # counter needed across rows.
                for tr in table.find_all("tr"):
                    tds = tr.find_all("td")
                    for td in tds[1:]:  # first td is the "(BANK) team1 team2 (BANK)" label column
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

    Deliberately duplicates (rather than shares) the same "is this a real,
    played map" filter scrape_match_detail uses when it originally builds
    this mapping and writes to `maps`: sharing/refactoring that logic
    risked introducing a subtle behavior change into the main scrape path,
    which is already proven correct against real data and shouldn't be
    touched for a targeted bug-only backfill. If VLR's markup for map
    name / score selectors ever changes, both copies need updating
    together -- there's a matching copy of this filter in
    scrape_match_detail below.
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
    """
    Backfills just the round-by-round economy data for a match that's
    already correctly scraped in every other respect -- used by
    --economy-only to fix the "only the first <tr>" bug without re-fetching
    the Performance tab or re-parsing/re-inserting already-correct box
    scores. Two fetches (Overview + Economy) instead of scrape_match_detail's
    three (Overview + Performance + Economy).
    """
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
    the DB (optionally scoped to specific event_ids) -- the targeted fix
    for the round-by-round bug, without re-doing event stats/agents or
    match box scores/performance data, none of which the bug touched."""
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


def rescrape_all_match_details(session, conn, event_ids=None):
    """Re-scrapes FULL match detail (Overview + Performance + Economy) for
    every completed match already in the DB, skipping event-level stats/
    agents/match-list discovery entirely (none of which any of this
    touches). This is the safe way to backfill both the round-economy
    truncation fix and the new attack/defense side-split at once.

    Deliberately reuses scrape_match_detail() as one atomic unit rather
    than trying to build a narrower "just re-parse the Overview tab"
    shortcut: INSERT OR REPLACE replaces the WHOLE row, so a box-score-only
    re-insert (which doesn't set multi_2k/clutch_*/econ/plants/defuses)
    would silently wipe those columns back to NULL on the existing 'both'
    row. scrape_match_detail already runs Overview -> Performance ->
    Economy in the correct order end to end, so nothing gets lost --
    costs the same 3 requests/match as the original scrape, just without
    redoing the event-level stuff around it."""
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
    """Scrapes one match page: overall score + per-map box scores for every player.

    Score handling: rather than trusting a single header selector for the
    overall match score (fragile — this broke completely in an earlier run),
    the score is derived by counting how many maps each team won, once maps
    are parsed below. A header-based reading is still attempted and used as
    a sanity cross-check / fallback if map data comes back empty.

    Player table handling: table detection is widened to catch any table
    inside a map's stats container (not one exact class name), and cell
    parsing falls back to permissive text extraction if the expected
    stat-cell classes aren't found, so a partial markup mismatch doesn't
    zero out the whole match.
    """
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

    # Best-effort header score reading (kept as a fallback/cross-check only)
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

    # --- Per-map parsing ---
    game_divs = soup.select(".vm-stats-game")
    map_index = 0
    maps_team1_wins = 0
    maps_team2_wins = 0
    total_player_rows = 0
    game_id_to_map_index = {}  # correlates this Overview-tab fetch with the
                                # separate Performance-tab fetch below (both
                                # pages use the same data-game-id per map)

    for game in game_divs:
        game_id = game.get("data-game-id", "")
        if game_id == "all":
            continue

        map_name_el = game.select_one(".map div > span")
        raw_map_name = clean(map_name_el.get_text()).split("\n")[0] if map_name_el else None
        # Strip the trailing "PICK"/"BAN"/"DECIDER" veto-status label VLR
        # appends to the map name text (e.g. "Haven PICK" -> "Haven").
        map_name = re.sub(r"\s*(PICK|BAN|DECIDER)\s*$", "", raw_map_name, flags=re.IGNORECASE).strip() \
            if raw_map_name else None

        team_scores = game.select(".score")
        t1_score = to_int(clean(team_scores[0].get_text())) if len(team_scores) > 0 else None
        t2_score = to_int(clean(team_scores[1].get_text())) if len(team_scores) > 1 else None

        # Attack/defense side-score breakdown and map duration, from the
        # per-map header (".vm-stats-game-header .team" — one block per team).
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

        # Skip maps that clearly haven't been played (placeholder/TBD, 0-0,
        # or missing scores entirely) rather than recording a fake result.
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
             team1_atk_score, team1_def_score, team2_atk_score, team2_def_score, duration)
            VALUES (?,?,?,?,?,?,?,?,?,?)""",
            (match_id, map_index, map_name, t1_score, t2_score, t1_atk, t1_def, t2_atk, t2_def, duration),
        )

        # Per-round winner + side + win condition, from the ".vlr-rounds"
        # round-by-round bar in this same Overview-tab fetch (the row of
        # small squares under the map header). Each round is a
        # ".vlr-rounds-row-col" holding one ".rnd-sq" per team; the
        # WINNING team's square gets "mod-win" plus a side class ("mod-t"
        # = attack, "mod-ct" = defend) -- the losing team's square carries
        # no side class of its own, but since a round has exactly one
        # attacker and one defender, their side is simply the winner's
        # side complement, not stored separately. The square's icon
        # filename (elim/defuse/boom/time) doubles as the win condition.
        # Confirmed against a real dumped page: covers every round played
        # (19 of 19 on a 6-13 map, verified against the final score), not
        # truncated the way the Economy tab's round table was.
        rounds_block = game.select_one(".vlr-rounds")
        if rounds_block:
            # Long maps (OT) wrap into MULTIPLE ".vlr-rounds-row" divs
            # (confirmed against a real 36-round OT map: two rows, 24+12),
            # each with its OWN leading team-name header column, not just
            # one at the very start of the whole block. .select() already
            # finds columns across every row (it is not scoped to the
            # first), so no explicit per-row iteration is needed -- but
            # slicing off "the first column" would only remove ONE of
            # those header columns, leaving the other row(s)' header
            # column(s) in the list. Skip them by checking for a real
            # round number instead, which is correct regardless of how
            # many rows/header columns exist.
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
                    continue  # unplayed template slot (VLR always renders a fixed-length row)
                team_idx = sqs.index(win_sq)
                winner = team1 if team_idx == 0 else team2
                win_classes = win_sq.get("class", [])
                winner_side = "t" if "mod-t" in win_classes else ("ct" if "mod-ct" in win_classes else None)
                icon_img = win_sq.select_one("img")
                win_condition = None
                if icon_img and icon_img.get("src"):
                    win_condition = icon_img["src"].rsplit("/", 1)[-1].split(".")[0]  # e.g. "elim", "defuse", "boom"
                cur.execute(
                    """INSERT OR REPLACE INTO map_round_results
                    (match_id, map_index, round_num, winner, winner_side, win_condition)
                    VALUES (?,?,?,?,?,?)""",
                    (match_id, map_index, round_num, winner, winner_side, win_condition),
                )

        # Player box score: VLR no longer uses <table> elements for this —
        # it's a div-grid: ".ovw-table" (one per team) > ".ovw-row" (one per
        # player, header row has class "mod-head") > ".ovw-cell"/nested
        # spans carrying a "data-col" attribute identifying the exact stat
        # (e.g. data-col="rating2", "acs", "kast", "adr", "hsp", "fb"
        # [=first kills], "fd", "fk-diff"). Kills/deaths/assists sit nested
        # inside one combined ".mod-kda" cell, each with their own
        # data-col="kills"/"deaths"/"assists". Looking cells up by data-col
        # rather than column position is far more robust to markup changes.
        #
        # Every one of those cells ALSO nests three <span class="side
        # mod-X"> variants -- mod-both (all rounds), mod-t (attack), mod-ct
        # (defend) -- which is what VLR's own All/Attack/Defend toggle on
        # the page switches between client-side. Confirmed against a real
        # dumped page: all three values are already present in the static
        # HTML at all times, so no extra fetch is needed to capture the
        # side split, just reading the right nested span per side.
        ovw_tables = game.select(".ovw-table")
        for team_idx, table in enumerate(ovw_tables[:2]):  # at most 2 teams per map
            team_name = team1 if team_idx == 0 else team2
            rows = table.select(".ovw-row:not(.mod-head)")
            for row in rows:
                name_el = row.select_one(".ovw-player-name") or row.select_one("a[href*='/player/']")
                player = clean(name_el.get_text()) if name_el else None
                if not player:
                    continue  # not a real player row

                agent_img = row.select_one(".ovw-agents img") or row.find("img")
                agent = None
                if agent_img:
                    agent = agent_img.get("title") or agent_img.get("alt")

                # Nationality: a flag icon sits right next to the player's
                # name in the same box score row -- e.g.
                # <i class="flag mod-th" title="Thailand"></i>. The
                # 2-letter code is a CSS modifier class, and the full
                # country name is conveniently already in the title
                # attribute (no code->name lookup table needed). This is
                # a stable per-player attribute, not per-map, so it's
                # upserted into its own small table rather than repeated
                # on every map_player_stats row.
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

                # Every stat cell already carries all three side variants as
                # nested spans (side.mod-both / side.mod-t / side.mod-ct) --
                # confirmed against a real dumped Overview page. VLR's own
                # All/Attack/Defend toggle just shows/hides these client-side;
                # nothing extra needs to be fetched. side='both' is the
                # pre-existing aggregate row (unchanged); 't' (attack) and
                # 'ct' (defend) are new. All three share the same primary key
                # shape (match_id, map_index, player, side) that the table
                # was already defined with.
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
                    fk = to_int(cell_val("fb", side_class))   # VLR labels this column "FK" but its data-col is "fb"
                    fd = to_int(cell_val("fd", side_class))
                    fkfd_diff_raw = cell_val("fk-diff", side_class)
                    fkfd_diff = to_int(fkfd_diff_raw.replace("+", "")) if fkfd_diff_raw else None

                    # A player who never played a round on one side (e.g. a
                    # sub who only took over defense) still gets a cell with
                    # a 0/blank span rather than no span at all, but skip the
                    # row anyway if literally everything came back empty --
                    # cheaper than storing an all-null row.
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

    # Final score: prefer counting actual map wins (robust — depends only on
    # the map score parsing that we know works). Fall back to the header
    # reading only if no maps were found at all (shouldn't happen for a
    # match already confirmed 'completed' by the listing page).
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

    # Second fetch: multi-kill (2K-5K) and clutch (1v1-1v5) counts, plus
    # ECON/plants/defuses, from the separate "?tab=performance" view.
    if scrape_ok:
        perf_rows = scrape_match_performance(session, conn, match_id, match_url, game_id_to_map_index)
        if perf_rows == 0:
            print(f"  [warn] match {match_id}: performance-tab data (multi-kills/clutches) "
                  f"came back empty — VLR markup for that tab may need re-checking.")

        # Third fetch: team buy-type summary + round-by-round economy, from
        # the separate "?tab=economy" view.
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
    print(f"\n=== Event {event_id} — {slug} ({region} {stage}) ===")
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
            # Not played yet (or still live) — nothing to scrape from the box
            # score. Save a lightweight placeholder so it's tracked, and it
            # will be re-checked on every future run (see below) until VLR
            # marks it completed.
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
    parser = argparse.ArgumentParser(description="Scrape VLR.gg VCT 2023 tier-1 statistics")
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
                              "every completed match already in the DB, skipping event-level "
                              "stats/agents/match-list discovery. Backfills the round-economy fix, "
                              "the attack/defense side-split, and the per-round winner/side/"
                              "win-condition table, all at once. Combine with --events to scope it.")
    parser.add_argument("--db", default=DB_PATH, help="SQLite DB path")
    parser.add_argument("--require-existing-db", action="store_true",
                         help="Abort if the database does not already exist instead of "
                              "creating an empty one. For automated runs: init_db() will "
                              "happily create a fresh database, which turns a restore "
                              "failure into a silent full re-scrape of every match.")
    parser.add_argument("--dump-html", type=int, nargs="*", default=[],
                         help="Match ID(s) to save raw HTML for, e.g. --dump-html 594740 594741 "
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

    events = VCT_2023_EVENTS
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
