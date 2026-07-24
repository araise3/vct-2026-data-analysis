#!/usr/bin/env python3
"""
vlr_vct_scraper.py
===================
Scrapes VLR.gg for ALL available statistics on VCT (tier-1) 2026 events:
  - Event metadata
  - Aggregate player stats per event (the /event/stats/ table: rating, ACS, K:D,
    KAST, ADR, KPR, APR, FK:FD, FKPR, FDPR, HS%, CL%, CL, KMAX, K, D, A, FK, FD)
  - Agent composition / pick stats per event (/event/agents/)
  - Full match list per event (/event/matches/)
  - Per-match, per-map box scores for every player (from each match page)
  - Per-match map picks/bans and overall scoreline where available

Data is stored in a local SQLite database (vlr_vct_2026.db) and can be
exported to CSV afterwards (see export_to_csv.py).

USAGE
-----
    python3 vlr_vct_scraper.py                  # scrape everything
    python3 vlr_vct_scraper.py --events 2683     # scrape just one event id
    python3 vlr_vct_scraper.py --skip-matches    # stats/agents only (fast)
    python3 vlr_vct_scraper.py --resume          # skip matches already in DB

NOTES
-----
- This is intentionally polite: ~1.5s delay between requests, retries with
  backoff, a real User-Agent, and it only hits vlr.gg.
- Run this on YOUR machine / environment with normal internet access —
  it will NOT run inside this sandboxed chat, which can't reach vlr.gg.
- Check vlr.gg's robots.txt / terms before doing heavy or commercial scraping.
"""

import argparse
import random
import re
import sqlite3
import sys
import time
from dataclasses import dataclass, field
from typing import Optional

import requests
from bs4 import BeautifulSoup

BASE = "https://www.vlr.gg"
DB_PATH = "vlr_vct_2026.db"

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/124.0 Safari/537.36 "
        "vlr-vct-2026-research-scraper/1.0"
    )
}

REQUEST_DELAY = (1.2, 2.2)  # random delay range (seconds) between requests
MAX_RETRIES = 4

# ---------------------------------------------------------------------------
# Tier-1 VCT 2026 international events (id, slug, region, stage).
# Pulled from https://www.vlr.gg/vct as of 2026-07-16.
# Add/remove rows here as new stages (Champions, etc.) complete or are added.
# ---------------------------------------------------------------------------
VCT_2026_EVENTS = [
    # (event_id, slug, region, stage)
    (2682, "vct-2026-americas-kickoff", "Americas", "Kickoff"),
    (2684, "vct-2026-emea-kickoff", "EMEA", "Kickoff"),
    (2683, "vct-2026-pacific-kickoff", "Pacific", "Kickoff"),
    (2685, "vct-2026-china-kickoff", "China", "Kickoff"),
    (2760, "valorant-masters-santiago-2026", "International", "Masters"),
    (2860, "vct-2026-americas-stage-1", "Americas", "Stage 1"),
    (2863, "vct-2026-emea-stage-1", "EMEA", "Stage 1"),
    (2775, "vct-2026-pacific-stage-1", "Pacific", "Stage 1"),
    (2864, "vct-2026-china-stage-1", "China", "Stage 1"),
    (2765, "valorant-masters-london-2026", "International", "Masters"),
    (2977, "vct-2026-americas-stage-2", "Americas", "Stage 2"),
    (2976, "vct-2026-emea-stage-2", "EMEA", "Stage 2"),
    (2776, "vct-2026-pacific-stage-2", "Pacific", "Stage 2"),
    (2978, "vct-2026-china-stage-2", "China", "Stage 2"),
    (2766, "valorant-champions-2026", "International", "Champions"),
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
            else:
                print(f"  [{resp.status_code}] {url} (attempt {attempt})")
        except requests.RequestException as e:
            print(f"  [error] {url}: {e} (attempt {attempt})")
        time.sleep(2 ** attempt)  # exponential backoff
    print(f"  [FAILED after {MAX_RETRIES} attempts] {url}")
    return None


# ---------------------------------------------------------------------------
# Database setup
# ---------------------------------------------------------------------------
def init_db(path: str = DB_PATH) -> sqlite3.Connection:
    conn = sqlite3.connect(path)
    cur = conn.cursor()
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
            status TEXT DEFAULT 'unknown'
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
    per player per map — then UPDATEs the matching rows already inserted
    by scrape_match_detail() (same match_id/map_index/player primary key).

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
                   WHERE match_id=? AND map_index=? AND player=?""",
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
    round-by-round table doesn't (it's one <tr> with one <td> per round).
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
                # --- Round-by-round breakdown (single <tr>, one <td> per round) ---
                tr = table.find("tr")
                if tr is None:
                    continue
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
        return

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

        # Player box score: VLR no longer uses <table> elements for this —
        # it's a div-grid: ".ovw-table" (one per team) > ".ovw-row" (one per
        # player, header row has class "mod-head") > ".ovw-cell"/nested
        # spans carrying a "data-col" attribute identifying the exact stat
        # (e.g. data-col="rating2", "acs", "kast", "adr", "hsp", "fb"
        # [=first kills], "fd", "fk-diff"). Kills/deaths/assists sit nested
        # inside one combined ".mod-kda" cell, each with their own
        # data-col="kills"/"deaths"/"assists". Looking cells up by data-col
        # rather than column position is far more robust to markup changes.
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

                rating = to_float(cell_val("rating2"))
                acs = to_float(cell_val("acs"))
                kills = to_int(cell_val("kills"))
                deaths = to_int(cell_val("deaths"))
                assists = to_int(cell_val("assists"))
                kd_diff_raw = cell_val("kd-diff")
                kd_diff = to_int(kd_diff_raw.replace("+", "")) if kd_diff_raw else None
                kast = cell_val("kast")
                adr = to_float(cell_val("adr"))
                hs_pct = cell_val("hsp")
                fk = to_int(cell_val("fb"))   # VLR labels this column "FK" but its data-col is "fb"
                fd = to_int(cell_val("fd"))
                fkfd_diff_raw = cell_val("fk-diff")
                fkfd_diff = to_int(fkfd_diff_raw.replace("+", "")) if fkfd_diff_raw else None

                cur.execute(
                    """INSERT OR REPLACE INTO map_player_stats
                    (match_id, map_index, player, team, agent, rating, acs, kills, deaths,
                     assists, kd_diff, kast, adr, hs_pct, first_kills, first_deaths,
                     fk_fd_diff, side)
                    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                    (
                        match_id, map_index, player, team_name, agent, rating, acs, kills,
                        deaths, assists, kd_diff, kast, adr, hs_pct, fk, fd, fkfd_diff, "both",
                    ),
                )
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

    cur.execute(
        """INSERT OR REPLACE INTO matches
        (match_id, event_id, team1, team2, score1, score2, stage, match_date, match_url, status)
        VALUES (?,?,?,?,?,?,?,?,?,'completed')""",
        (match_id, event_id, team1, team2, score1, score2, stage, match_date, match_url),
    )
    conn.commit()

    # Second fetch: multi-kill (2K-5K) and clutch (1v1-1v5) counts, plus
    # ECON/plants/defuses, from the separate "?tab=performance" view.
    if map_index > 0 and total_player_rows > 0:
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
            cur.execute("SELECT status FROM matches WHERE match_id = ?", (match_id,))
            row = cur.fetchone()
            if row and row[0] == "completed":
                print(f"  [{i}/{len(matches)}] skip (already scraped) match {match_id}")
                continue

        print(f"  [{i}/{len(matches)}] match {match_id} — completed, scraping box score")
        scrape_match_detail(session, conn, event_id, match_id, match_url,
                             dump_html=(match_id in dump_html_ids))


def main():
    parser = argparse.ArgumentParser(description="Scrape VLR.gg VCT 2026 tier-1 statistics")
    parser.add_argument("--events", type=int, nargs="*", help="Specific event IDs to scrape (default: all)")
    parser.add_argument("--skip-matches", action="store_true", help="Only scrape aggregate stats + agents (fast)")
    parser.add_argument("--resume", action="store_true", help="Skip matches already saved in the DB")
    parser.add_argument("--db", default=DB_PATH, help="SQLite DB path")
    parser.add_argument("--dump-html", type=int, nargs="*", default=[],
                         help="Match ID(s) to save raw HTML for, e.g. --dump-html 594740 594741 "
                              "(useful for debugging if player stats keep coming back empty)")
    args = parser.parse_args()
    dump_html_ids = set(args.dump_html)

    conn = init_db(args.db)
    session = requests.Session()

    events = VCT_2026_EVENTS
    if args.events:
        events = [e for e in events if e[0] in args.events]

    for event_id, slug, region, stage in events:
        try:
            scrape_event(session, conn, event_id, slug, region, stage,
                         skip_matches=args.skip_matches, resume=args.resume,
                         dump_html_ids=dump_html_ids)
        except KeyboardInterrupt:
            print("\nInterrupted — progress saved to DB.")
            sys.exit(1)
        except Exception as e:
            print(f"  !! failed on event {event_id}: {e}")
            continue

    conn.close()
    print(f"\nDone. Data saved to {args.db}")


if __name__ == "__main__":
    main()
