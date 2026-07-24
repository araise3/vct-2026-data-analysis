# VLR.gg VCT 2026 (Tier-1) Scraper

Scrapes everything readily available on VLR.gg for the 2026 VCT international
season: Kickoffs, Stage 1s, Stage 2s, Masters Santiago, Masters London, and
Champions (as it completes).

## Why it won't run in this chat

My sandboxed environment can only reach a small allowlist of domains (GitHub,
PyPI, npm, etc.) — vlr.gg isn't on it. Run this on your own machine, where you
have normal internet access.

## Setup

```bash
python -m venv venv
source venv/bin/activate      # Windows: venv\Scripts\activate
pip install -r requirements.txt
```

## One-click launchers (Windows)

Four `.bat` files are included so you don't need to type commands at all:

| File | What it does |
|---|---|
| `setup.bat` | **Run this once, first.** Creates the virtual environment and installs everything. |
| `run_scraper.bat` | Double-click to run the VCT scraper in `--resume` mode. |
| `run_ewc_scraper.bat` | Same, for the EWC scraper. |
| `export_csv.bat` | Exports whichever `.db` files exist in this folder to CSV (each into its own subfolder under `csv_export/`, so exporting both VCT and EWC doesn't overwrite each other's same-named tables). |

Each `.bat` file automatically navigates to its own folder first (so it
works no matter where you double-click it from) and activates the virtual
environment before running anything — no manual `cd`/`activate` needed.
If you ever move the whole folder somewhere else, these still work as-is.

## Step-by-step walkthrough (Windows)

This is the exact sequence for running it in Command Prompt, start to finish.

**1. Get to the right folder** (use `/d` if the folder is on a different drive
than the one Command Prompt opens on by default):
```
cd /d "C:\path\to\this\folder"
```

**2. Activate the virtual environment:**
```
venv\Scripts\activate
```
You should see `(venv)` appear at the start of your prompt line. If it
doesn't, the venv may need recreating: `python -m venv venv`, then repeat
this step.

**3. Run it.** For a full scrape (Overview + Performance + Economy tabs,
every tier-1 event):
```
python vlr_vct_scraper.py
```
Since Performance and Economy tab data was added, this makes **3 requests
per completed match** instead of 1 — a full run takes noticeably longer
than a bare Overview-only scrape. To sanity-check quickly first without
committing to that:
```
python vlr_vct_scraper.py --skip-matches
```

**4. Re-running as the season progresses.** Stage 2 (and Champions, once it
starts) will still be adding completed matches over time. Re-run
periodically with `--resume` so it only fetches matches it doesn't already
have, rather than re-scraping everything from scratch:
```
python vlr_vct_scraper.py --resume
```

**5. Export to CSV once it's done:**
```
python export_to_csv.py
```
CSVs land in a new `csv_export/` folder.

**For the EWC scraper** (separate script, same folder, same pattern):
```
python vlr_ewc_scraper.py --resume
python export_to_csv.py vlr_ewc_2026.db
```

## Run

```bash
# Scrape everything: player stats, agent stats, every match, every map's box score
python vlr_vct_scraper.py

# Just the fast aggregate tables (no per-match scraping — seconds instead of ~1-2 hrs)
python vlr_vct_scraper.py --skip-matches

# Only specific events (find IDs in vlr_vct_scraper.py's VCT_2026_EVENTS list)
python vlr_vct_scraper.py --events 2683 2775

# Resume a full run after it was interrupted (skips matches already saved)
python vlr_vct_scraper.py --resume
```

Data lands in `vlr_vct_2026.db` (SQLite). Export everything to CSV with:

```bash
python export_to_csv.py
```

## What gets scraped

| Table                 | Source page                          | Contents |
|------------------------|---------------------------------------|----------|
| `events`               | `/vct` listing                        | event id, slug, region, stage |
| `player_event_stats`   | `/event/stats/{id}/{slug}`            | per-player aggregate stats for the whole event: Rating, ACS, K:D, KAST, ADR, KPR, APR, FK:FD, FKPR, FDPR, HS%, CL%, Clutches, KMAX, K/D/A, FK/FD |
| `event_map_summary`    | `/event/agents/{id}/{slug}`           | per-map (+ an "ALL" aggregate row) round count and ATK/DEF win% for the event |
| `event_map_agent_utilization` | `/event/agents/{id}/{slug}`    | per-map, per-agent pick/utilization % for the event |
| `matches`               | `/event/matches/{id}/{slug}`          | every match: teams, final score, stage/round, date |
| `maps`                  | each match page                       | per-map scoreline within each match |
| `map_player_stats`      | each match page                       | full per-player box score for every map: Rating, ACS, K/D/A, KAST, ADR, HS%, FK/FD |

That's effectively everything VLR exposes on the public site short of
round-by-round economy/kill-feed data (which lives behind per-map JS panels
that would need a headless browser like Playwright to render — let me know if
you want that extended).

## Handling events that are still in progress (Stage 2, Champions, etc.)

Both scrapers are safe to run repeatedly against events where not every match
has been played yet — Stage 2 and Champions in particular, since those are
live as of writing.

How it works: the matches listing page tells you each match's status
("Completed", "LIVE", or a bare scheduled time = upcoming) — the scraper
reads that directly rather than assuming everything's finished. Only matches
marked **completed** get their box score fetched; upcoming/live matches get
a lightweight placeholder row (teams + status, no stats) so they're tracked
without wasting a request on a page that has nothing to scrape yet.

The `matches` table has a `status` column (`completed` / `live` / `upcoming`)
for exactly this reason. Re-running the scraper later — with or without
`--resume` — always re-checks any match not already marked `completed` in
the DB, so a match that was "upcoming" last week and has since been played
gets picked up automatically. `--resume` only skips matches that are already
`completed`, so it never permanently skips something that hadn't happened
yet the first time you ran it.

The aggregate `/event/stats/` and `/event/agents/` pages need no special
handling — VLR computes those live from whatever's been played so far, so
just re-run the scraper periodically (e.g. weekly during Stage 2) to keep
`player_event_stats` and `event_agent_stats` current.

If you want to see which matches are still pending for an event:
```sql
SELECT match_id, team1, team2, status FROM matches
WHERE event_id = 2978 AND status != 'completed';
```

## Filtering to "tier-1 teams" specifically

All events in `VCT_2026_EVENTS` (in `vlr_vct_scraper.py`) already ARE the
tier-1 international events — every team competing in a VCT Kickoff/Stage/
Masters/Champions is by definition a tier-1 franchised or partner team, so no
extra team-name filtering is needed. If you only want a subset of teams,
filter the SQLite tables afterward, e.g.:

```sql
SELECT * FROM player_event_stats WHERE team IN ('Paper Rex', 'T1', 'DRX');
```

## Politeness / etiquette

- ~1.5s randomized delay between every request
- Retries with exponential backoff on failure
- Identifies itself with a descriptive User-Agent
- Only targets vlr.gg

Check vlr.gg's `robots.txt` and Terms before doing anything at scale or
commercial. This script is sized for personal/research use, not high-frequency
polling.

## Esports World Cup 2026 (separate scraper)

`vlr_ewc_scraper.py` is a standalone sibling script — same schema, same
politeness settings — that covers EWC 2026 instead of VCT:

- Esports World Cup 2026 (main event, Paris)
- EWC 2026: Americas Qualifier
- EWC 2026: EMEA Qualifier
- EWC 2026: Pacific Qualifier
- EWC 2026: China Qualifier

```bash
python vlr_ewc_scraper.py                # everything
python vlr_ewc_scraper.py --skip-matches # fast aggregate-only pass
python vlr_ewc_scraper.py --events 2952  # just the main event
python vlr_ewc_scraper.py --resume       # resume an interrupted run
```

It writes to its own file, `vlr_ewc_2026.db`, so it never mixes with your VCT
data. Export it the same way:

```bash
python export_to_csv.py vlr_ewc_2026.db
```

(that writes into the same `csv_export/` folder — rename it first, or pass a
different output folder in the script, if you're exporting both DBs and want
to keep the CSVs separate)

## If match scores or player box scores come back empty

**Update: this was root-caused and fixed using a real dumped match page.**
VLR redesigned their match pages at some point and no longer uses `<table>`
elements at all for the box score — it's now a div grid
(`.ovw-table` > `.ovw-row` > `.ovw-cell`/`[data-col="..."]`), which is why
table-based selectors were silently finding nothing. The parser has been
rewritten against this real structure and verified end-to-end against an
actual completed match (Rex Regum Qeon vs. Paper Rex, VCT 2026 Pacific
Kickoff) — 40/40 player rows and the correct 1–3 map score came through
correctly. As a bonus, attack/defense side-scores and map duration
(`maps.team1_atk_score` etc., previously always `NULL`) are now populated
too, since that data was sitting right there in the same header block.

**Match score** is derived by counting how many maps each team won, rather
than trusting one header selector — this only depends on the map score
parsing, which was already verified working.

If something *still* comes back empty after a fresh scrape (VLR could
always change markup again in the future), use the debug flag:

```bash
python vlr_vct_scraper.py --events 2683 --dump-html 595659
```

This saves the raw HTML for that match to `debug_match_595659.html` in your
working folder. Open it, find the actual table/row markup for the box
score, and either send it back for a selector fix or adjust the `ovw_tables =`
and `cell_val()` lookups in `scrape_match_detail()` yourself — that function
is the one place all the per-map/per-player parsing happens.

## A note on missing `rating` values for some VCT China matches

If you see a small number of `map_player_stats` rows with `rating = NULL`
but every other stat (ACS, kills, deaths, KAST, etc.) populated normally —
this isn't a scraper bug. It's isolated to a handful of **VCT China**
matches specifically (confirmed: 9 matches across China Kickoff/Stage 1/
Stage 2, 0 matches in any other region), which points to VLR's China
coverage simply not having Rating 2.0 computed/published for those games on
their end (China runs through a separate broadcast/stats pipeline than the
other regions). There's nothing to extract if VLR itself doesn't have the
number. No fix needed — `NULL` here is the honest, correct value.

## The same China gap shows up in map duration too

`maps.duration` comes back as the literal string `"-"` (not NULL, an actual
dash character) for 94 of the 1281 maps across both VCT and EWC -- and
every single one of those 94 is China-region (VCT China Kickoff/Stage 1/
Stage 2, EWC China Qualifier). Same root cause as the rating gap above:
VLR's own China broadcast pipeline doesn't publish a duration for these
maps, so the scraper is faithfully capturing what's actually on the page.
Downstream parsing (`data_prep/export_from_db.py`'s `parse_duration`)
already treats anything without a `:` in it as unparseable and returns
`None`, so these are correctly excluded from any duration-based average or
leaderboard rather than being counted as 0 seconds. No fix needed here
either.

## Multi-kill and clutch data (2K-5K, 1v1-1v5, ECON/plants/defuses)

`map_player_stats` now includes 12 additional columns per player per map:
`multi_2k`, `multi_3k`, `multi_4k`, `multi_5k` (double/triple/quad/ace kill
counts), `clutch_1v1` through `clutch_1v5` (clutch situations won at each
disadvantage level), and `econ`/`plants`/`defuses`.

This comes from a second request per completed match, to the same match
page with `?tab=performance` appended (VLR's "Performance" tab) — confirmed
against a real dumped page to use a genuine `<table class="wf-table-inset
mod-adv-stats">` per map, so it's scraped the same reliable way as
everything else (no headless browser needed). This roughly doubles the
number of requests made per completed match, but the existing rate-limiting
still applies.

If `map_player_stats.multi_2k` etc. come back `NULL` for matches that
otherwise scraped fine, the fetch of the performance tab is the first place
to check — you'll see a `[warn] ... performance-tab data ... came back
empty` message in the console for that match if so.

## Economy data (buy types, round-by-round loadouts)

Two new tables, from a third request per completed match (`?tab=economy`):

- **`map_team_economy`** — one row per team per map: `pistol_won`, and for
  each buy tier (`eco`, `semi_eco`, `semi_buy`, `full_buy`) both the round
  count and how many of those rounds were won (VLR's own tiers: Eco $0-5k,
  Semi-eco $5-10k, Semi-buy $10-20k, Full buy $20k+).
- **`map_round_economy`** — one row per round per map: each team's bank
  going into the round, exact loadout value (`team1_loadout`/`team2_loadout`,
  raw dollar figure), buy-type label, and who won that round
  (`team1_round_win`/`team2_round_win`).

Combined with `maps` (map-level scores/sides) and `map_player_stats`
(per-player performance), this now covers every tab VLR exposes on a match
page (Overview, Performance, Economy — Logs is still marked "Soon" on
their end as of writing, nothing to scrape there).

## Full column reference (as of the economy-tab addition)

| Table | Granularity | Key columns |
|---|---|---|
| `events` | 1 row/event | region, stage, dates |
| `player_event_stats` | 1 row/player/event | Rating, ACS, K:D, KAST, ADR, clutches, KMAX — VLR's own tournament-long aggregates |
| `event_map_summary` | 1 row/map/event (+ "ALL") | round count, ATK/DEF win% |
| `event_map_agent_utilization` | 1 row/map/agent/event | pick/utilization % |
| `matches` | 1 row/match | teams, score, stage, status (completed/live/upcoming) |
| `maps` | 1 row/map | map name, score, atk/def split, duration |
| `map_player_stats` | 1 row/player/map | Rating 2.0, ACS, K/D/A, KAST, ADR, HS%, FK/FD, multi-kills (2K-5K), clutches (1v1-1v5), ECON/plants/defuses |
| `map_team_economy` | 1 row/team/map | pistol wins, eco/semi-eco/semi-buy/full-buy round counts & wins |
| `map_round_economy` | 1 row/round/map | bank, loadout value, buy type, round winner — for both teams |

## Fixed: `event_agent_stats` was scraping the wrong tables entirely

An earlier version of this script had a broken `event_agent_stats` table:
`soup.find_all("table")` grabbed *every* table on the `/event/agents/` page,
not just the agent-utilization one — sweeping in an unrelated standings
widget and a map-picks widget, so the "agent" column ended up full of team
names and map names ("Paper Rex", "vs. KIWOOM DRX", "S Split") instead of
real agents. It also had no dedup logic, so re-scraping the same event
piled up duplicate copies of this garbage on every run.

Root cause found by inspecting a real dumped page: `/event/agents/` was
never a per-agent performance table (no Rating/ACS/K:D there) — it's a
single Map × Agent **utilization matrix** (`table.wf-table.mod-pr-global`):
one row per map plus an "ALL" aggregate, with round counts, ATK/DEF win%,
and a pick-rate % per agent (agents identified by their header icon, not by
alt/title text).

This is now scraped correctly into two tables — `event_map_summary`
(map-level round count and ATK/DEF win%) and `event_map_agent_utilization`
(pick rate per map per agent) — verified against a real dumped page:
7 real maps + "ALL" row, all real agent names, correct percentages.

**If you have an existing `.db` file**: the old corrupted `event_agent_stats`
table is automatically dropped the next time you run the scraper (via a
migration in `init_db()`) — no manual cleanup needed, but note that means
its (garbage) contents are gone for good, replaced by the two new tables
on your next scrape.

## Player nationality (flags)

Each map's box score also carries a country flag right next to the
player's name (`<i class="flag mod-th" title="Thailand">`) — this is now
captured into its own small `player_nationality` table
(`player`, `country_code`, `country_name`), upserted during the same box
score parsing pass that already runs for every match (no extra page
visits). Verified against a real dumped match page: all 5 players on one
roster correctly came back as Thailand, all 5 on the other as South Korea.

## Known fragility

VLR.gg's HTML isn't a stable public API — if they redesign the site, the CSS
selectors in `scrape_match_detail()` (the most complex parser here, since
match pages have a more nested structure than the stats/agents tables) are
the most likely thing to break first. If a run silently returns 0 rows for
`map_player_stats`, that's the first place to check — open a match page in
your browser, inspect the box score table, and adjust the selectors near
`table.wf-table-inset` accordingly.
