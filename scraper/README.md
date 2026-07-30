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

# Abort rather than create a database if none exists (for automated runs)
python vlr_vct_scraper.py --resume --require-existing-db
```

The DB path can also be set with the `VLR_DB_PATH` environment variable
(`VLR_EWC_DB_PATH` for the EWC scraper) instead of `--db`.

### Exit codes

These matter when the scraper runs unattended — every failure path here is
individually recoverable, which historically meant a run where *every* request
failed still exited 0.

| Code | Meaning |
|------|---------|
| `0`  | Clean run. |
| `1`  | Something failed (a request, an event, or a match) but what landed is valid. Safe to publish; don't report as success. |
| `2`  | Aborted. Either vlr.gg refused the client (403/429 — see `ScrapeFailure`) or `--require-existing-db` found no database. Nothing should be published. |

### Match status values

`matches.status` is `completed` only when a match page actually yielded map and
player rows. If the page fetched but parsed to nothing usable, the row is stored
as **`partial`** instead, which keeps it eligible for a retry on the next
`--resume` run — writing `completed` unconditionally used to make a one-off
transient failure permanent, since `--resume` skips anything already marked
completed. `partial` rows are excluded from the site export, and
`--economy-only` / `--redo-match-details` include them so a backfill can repair
them.

### Closed-event skip and the late-rating grace period (`--resume` only)

A routine `--resume` run doesn't re-fetch every event every time. An event
with no upcoming/live/**partial** matches left, whose last completed match is
more than `RECHECK_GRACE_DAYS` (7) old, is treated as closed and skipped
outright — no event-stats, agents, or match-list requests spent on it at all.
Cuts a routine run from ~45 requests (all 15 events, unconditionally) down to
roughly however many events are actually still active — typically 3-5.

A match sitting at `'partial'` keeps its event open for `RECHECK_GRACE_DAYS`
from whenever it *first* went partial (a separate `first_partial_at` column,
not `match_date`) — found live in production: VLR was showing "Logs (Soon)"
(0 player rows) for 13 matches in a months-old EWC China Qualifier that the
scraper correctly stored as `'partial'`. Checking an older local snapshot of
the same DB showed those 13 matches never had real stats even in the
earliest available scrape — a probably-permanent VLR-side gap, not a
transient one. That mattered because the event has zero upcoming/live
matches, so an earlier version of this check (any `'partial'` keeps the
event open, no time limit) would have polled it forever chasing data that
may never arrive. Bounding by `first_partial_at` instead of `match_date`
keeps the original fix intact (a partial match's real play-date can be
arbitrarily old and shouldn't matter) while still giving up automatically
once the chase window is exhausted — the match stays `'partial'` in the DB
as an honest record, it just stops generating further requests.

The grace period exists because VLR can take a while to publish Rating 2.0
(and sometimes ACS) for a match, China region especially — closing an event
the instant its last match scores would freeze that gap forever. **While an
event is still active by the rule above, every match under it stays eligible
for a re-check**, not just recently-played ones: a fixed per-match cutoff was
tried first and rejected once real data showed why it doesn't work — an
entire China Stage 2 event ran 2+ weeks with Rating 2.0 missing for every
match played so far, and a per-match window would have let the earliest of
those matches quietly stop being re-checked while the event around them was
still being scraped every run. So the only thing bounding a re-check is the
`RECHECK_THROTTLE_HOURS` (24) cooldown — at most once a day per match, so a
3-hourly cron doesn't hammer the same box score 8 times chasing one
correction — and the event closing, which is a hard stop: once that happens,
none of its matches are ever visited again, no periodic "just in case" check.

`--events <id>` bypasses the closed-event skip for a deliberate backfill/
correction on a specific event, and a run without `--resume` always does
everything (matching how `--resume` already gates the match-level skip).

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

## A note on missing `rating` (and occasionally `acs`) values for some VCT China matches

If you see `map_player_stats` rows with `rating = NULL` (and rarely `acs`
NULL too) — this isn't a scraper bug, and isolated to **VCT China**
specifically (0 matches in any other region). But treat "how many" and "is it
permanent" as a moving target, not a fixed fact — re-measured while
investigating the recheck logic above and found meaningfully worse than
originally documented:

- **6 matches** from China Kickoff/Stage 1 (played January-May) still have
  `rating = NULL` with every other stat populated, months later. These are
  genuinely stuck — VLR simply never computed Rating 2.0 for them — and
  there's nothing to extract if VLR itself doesn't have the number.
- **25 matches from China Stage 2** (an event still in progress as of this
  writing) have `rating = NULL` — every completed match in that event so far,
  not a handful. **3 of the most recent also have `acs = NULL`**, i.e. the gap
  isn't strictly "rating only" the way it first looked with a smaller sample.
  Unlike the first group, it's too early to call these permanent — the event
  hasn't closed yet, and the recheck mechanism above exists specifically to
  keep watching matches like these for as long as their event stays open,
  rather than assuming "VLR will never publish it" prematurely. Once China
  Stage 2 closes (7 days after its last match with nothing live left) and
  these are still NULL, that's the point where "permanent, no fix possible"
  actually becomes a safe conclusion — not before.

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

## Fixed: `map_round_economy` was silently truncated to 12 rounds per map

If every map in your DB has exactly 12 `map_round_economy` rows regardless
of the actual score, that's this bug (now fixed, but see below for how to
backfill an existing DB).

VLR splits the round-by-round economy table across **multiple `<tr>` rows**
— one row per chunk of up to 12-13 rounds (first half, second half, then
OT if any) — not a single row with one `<td>` per round like the earlier
scraper assumed. The old code did `table.find("tr")`, which grabs only the
*first* row, so every map's second half (round 13 onward) was silently
dropped. Confirmed against real matches: a 26-round game (13-13, went to
OT) came back as three `<tr>`s of 13+13+3 `<td>`s each — 12+12+2 = 26 actual
round cells once each row's leading label column is excluded, matching that
game's own total exactly.

The fix iterates every `<tr>` in the table instead of just the first. No
round-counting logic was needed across rows — each `<td>` already
self-labels its own round number via a `.round-num` element inside it.

**To backfill an already-scraped DB**, use the new `--economy-only` flag
rather than a full re-scrape:

```
python3 vlr_vct_scraper.py --economy-only
python3 vlr_ewc_scraper.py --economy-only
```

This re-fetches just the Overview tab (to rebuild the map-index mapping)
and the Economy tab for every match already marked `completed` — 2
requests per match instead of a full re-scrape's 3, and it skips event
stats/agents entirely, none of which this bug touched. **`--resume` will
NOT trigger this fix** — it skips any match already marked `completed`,
which by now is all of them, so it'll never re-visit the broken data.
`--economy-only` bypasses that check on purpose. It's safe to run on a DB
that already has (broken) round-economy data: the table's primary key is
`(match_id, map_index, round_num)` with `INSERT OR REPLACE`, so re-running
this just rewrites rounds 1-12 identically and adds the previously-missing
13+, without duplicating or corrupting anything.

## Attack/defense side splits (previously assumed impossible -- they aren't)

`map_player_stats.side` used to be the literal string `'both'` on every
single row -- that was a hardcoded placeholder, not evidence VLR lacks
per-side stats. It very much does, and it costs nothing extra to get.

Every stat cell in the Overview tab's box score (rating, ACS, K/D/A, KAST,
ADR, HS%, first kills/deaths) already contains **three** nested spans:
`<span class="side mod-both">`, `<span class="side mod-t">` (attack),
`<span class="side mod-ct">` (defend) -- all present in the static HTML at
all times. VLR's own All/Attack/Defend toggle on the page just shows/hides
these client-side. Confirmed against a real dumped Overview page and
cross-checked against a live screenshot: every "defend" value extracted
matched what was visibly displayed for all 10 players on that page.

The scraper now inserts one row per side per player per map (`'both'`,
`'t'`, `'ct'`) instead of just `'both'` -- `map_player_stats`'s primary key
was already `(match_id, map_index, player, side)`, designed for exactly
this from the start, so no schema change was needed, just actually reading
the other two spans.

**One thing this required fixing**: `scrape_match_performance`'s UPDATE
(multi-kills, clutches, ECON, plants, defuses) didn't filter by `side` at
all. Once `'t'`/`'ct'` rows exist, that same blind UPDATE would silently
duplicate the all-rounds performance numbers onto the attack-only and
defense-only rows too -- wrong, not just redundant, since that tab has no
confirmed per-side breakdown of its own. It's now scoped to
`WHERE ... AND side='both'` explicitly, so the new rows correctly leave
those fields `NULL` rather than showing a duplicated value.

## New table: `map_round_results` (per-round winner, side, and win condition)

A better and more complete source for round-level side data than
`map_round_economy` turned out to already exist in the very same
Overview-tab fetch: the row of small squares under the map header (the
`.vlr-rounds` element -- what the site itself renders as a compact
round-by-round history). Each round is a `.vlr-rounds-row-col` holding one
`.rnd-sq` per team; the **winning** team's square carries `mod-win` plus a
side class (`mod-t` = won on attack, `mod-ct` = won on defend) and an
icon (`elim.webp` / `defuse.webp` / `boom.webp` / etc.) indicating how the
round ended. The losing team's square carries no side class of its own,
but since a round has exactly one attacker and one defender, their side is
simply the winner's side complement -- not stored separately, trivially
derivable.

Confirmed against a real dumped page: extracted all 19 rounds of a 6-13
map, matching the final score exactly, with the expected side-swap
showing up correctly at round 13 (the start of the second half).

Unlike `map_round_economy`, **this covers the entire map, not just the
first 12 rounds** -- it isn't affected by that bug at all, since it comes
from a completely different element on the page. New table:

```sql
CREATE TABLE map_round_results (
    match_id INTEGER,
    map_index INTEGER,
    round_num INTEGER,
    winner TEXT,          -- raw team name, canonicalized downstream like team1/team2 elsewhere
    winner_side TEXT,     -- 't' (attack) or 'ct' (defend)
    win_condition TEXT,   -- 'elim', 'defuse', 'boom', etc. -- from the round-end icon filename
    PRIMARY KEY (match_id, map_index, round_num)
);
```

This opens up stats that weren't cleanly derivable before: true round
win% by side across the *entire* map (not just the first half), win
condition breakdown (how often a team closes rounds by elimination vs.
defusing vs. the spike going off), and -- once joined with
`map_round_economy` on `(match_id, map_index, round_num)` -- anti-eco or
pistol-conversion win rates split by side, not just aggregated across
both.

`--redo-match-details` picks this table up automatically, since it's
extracted during the same Overview-tab parse as the side-split box scores
above -- no separate flag needed.

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

## Historical seasons: `vlr_vct_2025_scraper.py` / `vlr_ewc_2025_scraper.py`

Same code, same schema, same politeness/failure/recheck logic as the current-season
scrapers above — these are full copies with only the season-specific constants
changed (event list, default DB filename, env var name, User-Agent string).
Diffed line-by-line against the current-season files before being committed to
confirm nothing else drifted.

```bash
python vlr_vct_2025_scraper.py --resume
python vlr_ewc_2025_scraper.py --resume
```

Every event id/slug in `VCT_2025_EVENTS` was confirmed directly against live
vlr.gg pages, not guessed from the current season's naming pattern — that
pattern isn't reliable across seasons (2025's China Kickoff uses a
`champions-tour-` prefix no other 2025 China event does).

**EWC 2025 has a different event structure than the current EWC season, and
this is a real difference in the source data, not a bug**: 2026 gives each
qualifier (Americas/EMEA/Pacific/China) its own event id, but 2025 has no
separate id per qualifier at all. Everything — EMEA Qualifier, Americas
Qualifier, Pacific x ACL Qualifier, Group Stage, Playoffs — lives under one
event id (`2449`) as named stages, and the existing match-list fetch
(`?series_id=all`) already returns all of them in a single page (confirmed
live: 77 matches spanning all 5 stages, in one request). So
`EWC_2025_EVENTS` has one entry instead of five. No standalone China
Qualifier stage was found either — China's berth that year came through a
path not represented as its own vlr.gg bracket.

These are meant for a one-time historical backfill, not a recurring job: once
the initial `--resume` run completes, every event will have all-completed
matches with no upcoming/live ones and a last-match date far outside
`RECHECK_GRACE_DAYS`, so `event_needs_scrape()` marks everything closed and
every run after the first costs 0 requests. Not wired into the GitHub Actions
workflow — that automation exists for keeping a live, in-progress season
current, which doesn't apply to a season that ended in 2025.

## Known fragility

VLR.gg's HTML isn't a stable public API — if they redesign the site, the CSS
selectors in `scrape_match_detail()` (the most complex parser here, since
match pages have a more nested structure than the stats/agents tables) are
the most likely thing to break first. If a run silently returns 0 rows for
`map_player_stats`, that's the first place to check — open a match page in
your browser, inspect the box score table, and adjust the selectors near
`table.wf-table-inset` accordingly.
