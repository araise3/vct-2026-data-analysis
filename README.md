# VCT 2026 — Season Stats

A statistics portal for VCT 2026 tier-1 Valorant esports, built from scraped
[vlr.gg](https://vlr.gg) data. Statistics remain prebuilt JSON and aggregate
in the browser; one Cloudflare Pages Function powers the natural-language
start-page interpreter without exposing credentials client-side.

**Live at:** deployed via Cloudflare Pages, connected to this repo's `main` branch.

## What's here

A statistics-first portal, with player performance as the landing page. The desktop
navigation groups statistics, analysis, and export tools; mobile uses a horizontal
navigation rail. There are no fixture feeds, brackets, news, or schedule pages.

| View | What it shows |
|---|---|
| **Players (home)** | Searchable player performance, key/all metric views, sortable neutral tables and pagination |
| **Teams** | Match/map records, win rates, pistol win rate, average player rating |
| **Agents** | Pick rates and map win rates, filterable by Region → Stage → Phase → Week/Round (the last one is multi-select) |
| **Economy** | Buy-tier distribution (eco/semi-eco/semi-buy/full-buy) and win rates by tier |
| **Events** | Team-by-event statistical records, with event drill-downs and sample sizes, not tournament schedules |
| **Analysis** | Player comparison, team ratings, compositions, and records |
| **Player / Team profiles** | Click any name anywhere on the site to open a full breakdown |
| **Graphics** | Build shareable HLTV-style stat cards — pick players or teams, pick a stat (rating, ACS, multi-kills/24R, round win%, pistol win%, …), filter the sample, tune minimum rounds/maps and top-N with live preview, then export a 2160px PNG |

Shared scope controls use searchable multi-selects. Date ranges and event-specific
phases/weeks live under **More filters**; statistical aggregation still sums raw
counts before computing rates. Player gear/settings, trophy displays, coaching
profiles, and roster timelines are no longer part of the portal UI. Historical
match statistics retain source links for verification. Legacy event URLs open
event statistics; patch and coach URLs lead to agent and team statistics.

Most pages that touch China have an explicit toggle for known VLR data gaps
(see [Data caveats](#data-caveats) below), and most also have a toggle to
fold in **Esports World Cup (EWC) 2026** results alongside the main VCT season.

## Tech stack

- **Vite + React** (function components, hooks — no class components)
- **React Router** for client-side routing (`/players/:name`, `/teams/:name`, etc.)
- **Cloudflare Pages Functions + Workers AI** for schema-constrained search intent
- **Tailwind CSS**, design tokens in `tailwind.config.js` — colors and
  spacing pulled from a real reference site's stylesheet, with the accent
  color overridden to Valorant's official brand red (`#FF4655`)
- **Plus Jakarta Sans** as the sole font family (headings, body, and data —
  no separate monospace for numbers)
- Team logos and agent icons are real assets (VLR.gg team logos, Riot's
  official agent icons via `valorant-api.com`), not placeholders

## Project structure

```
vct-site/
├── functions/api/       Server-side natural-language intent interpreter
├── public/
│   ├── data/            JSON data files (generated -- see below)
│   ├── logos/           A few team logos re-hosted locally after
│   │                    pixel-level fixes (contrast/visibility), rather
│   │                    than pointing back at the original CDN
│   └── _redirects       Cloudflare Pages SPA routing config
├── src/
│   ├── components/      DataTable, HorizontalBarChart, StackedBar,
│   │                    RoundSquares, TeamLogo, AgentIcon, FilterChips,
│   │                    MultiFilterChips, KpiCard, RankedList, TopNav,
│   │                    SearchBar, MatchHistory, PerformanceStrip
│   ├── pages/            Overview, Players, Teams, Agents, Economy,
│   │                    Records, Graphics, Tournaments, PlayerProfile,
│   │                    TeamProfile, MatchRedirect
│   ├── lib/              useData.js (fetch+cache hook), format.js
│   │                    (number/percent/color-scale helpers),
│   │                    agentIcons.json, teamLogos.json
│   ├── App.jsx           Route definitions
│   └── index.css         Tailwind + base styles
├── data_prep/
│   └── export_from_db.py  Regenerates public/data/*.json directly from
│                          the scraper's SQLite output (see below)
└── tailwind.config.js     Design tokens (colors, fonts, radius)
```

## Natural-language start page

`functions/api/interpret.js` uses a Workers AI binding named `AI` and returns a
validated destination/filter object. In the Cloudflare Pages project, add a
**Workers AI** binding with variable name **AI** to both Production and Preview,
then redeploy. The client never accepts model-generated URLs; it constructs known
internal routes from a strict allowlist and merges explicit scope terms as a
guardrail. Ordinary Vite development has no edge binding, so it automatically
uses the local typo-aware parser instead. To exercise the real binding locally
after `npm run build`, use `npx wrangler pages dev dist --ai=AI` while logged into
the relevant Cloudflare account.

## Regenerating the data

`data_prep/export_from_db.py` reads directly from the scraper's `.db` files
(no CSV export step needed) and writes every file in `public/data/`:

```bash
python3 data_prep/export_from_db.py
```

It expects `vlr_vct_2026.db` and `vlr_ewc_2026.db`. Paths default to the
constants near the top of the script but can be overridden with the
`VLR_DB_PATH`, `VLR_EWC_DB_PATH` and `VLR_OUT` environment variables (which is
how the automated workflow below points it at a restored database). It
refuses to run against a missing or empty VCT database rather than writing a
full set of empty JSON files over the real data. It handles:

- **Team-name canonicalization** — tags (e.g. "PRX") → full names, China's
  sponsor-prefixed long names → their short form, EWC's sub-branded rosters
  (e.g. "AG.AL (All Gamers)") → their parent org, and the ULF Esports →
  Eternal Fire merge (same EMEA slot, held sequentially, never played each
  other)
- **Region/stage/phase/week tagging** for the Agents page's cascading filter
- **VCT + EWC merging** — every match is tagged by competition; the default
  (VCT-only) output is unaffected, with a parallel `withEwc` /
  `statsWithEwc` field added per team/player for the toggle

After running it, `npm run build` picks up the fresh JSON automatically.

## Automated updates

`.github/workflows/update-data.yml` runs the whole loop above on a schedule
(every 3 hours) so new results appear without anyone running the scraper by
hand: scrape only what's new → regenerate `public/data/` → commit → push.
Pushing to `main` is what triggers the Cloudflare Pages rebuild, so there's no
separate deploy step.

### How the database persists

The scraper databases are **not** in this repo — ~8MB of binary that deltas
badly would balloon history at that commit frequency. Each run restores them
from the GitHub Actions cache, scrapes what's new, and saves them back. The
cache alone is fast but not durable (entries are evicted after 7 days unused),
so a `db-snapshot` release is kept as a durable fallback, refreshed
automatically once a day and used whenever the cache comes up empty.

Nothing needs seeding by hand: if **neither** the cache nor the snapshot has a
copy — the very first run ever, or both lost at once — the workflow just
scrapes everything from scratch itself instead of failing. That run is slow
(~1300 requests, roughly an hour, vs. a handful normally), but it's the only
one — the very next run finds what it just saved and goes back to incremental.
If you'd rather skip that one slow run, upload your existing databases as the
seed before the first scheduled run fires:

```bash
gh release create db-snapshot "vlr_vct_2026.db" "vlr_ewc_2026.db" --title "Scraper DB snapshot" --notes "Seed/recovery copy for CI."
```

To force a full rewipe-and-rebuild on purpose (e.g. recovering from suspected
data corruption, not just ordinary cache loss), run the workflow via
*Actions → Update VLR data → Run workflow* with **force_full_rebuild** checked
— it discards whatever was restored and starts clean.

Exit codes carry meaning end to end: a clean run publishes and goes green; an
incomplete run still publishes the valid data it collected but the job is
marked failed so it's visible; and a run that vlr.gg refuses outright (403/429,
the expected result if the runner's datacenter IP gets blocked) aborts without
publishing anything.

## Local development

```bash
npm install
npm run dev        # http://localhost:5173, hot reload
```

## Data caveats

A few known gaps in what VLR.gg publishes, surfaced directly in the UI
rather than silently producing misleading numbers:

- **China-region matches** don't publish multi-kill, clutch, or economy
  data — those columns read 0 for China players unless a player also
  competed internationally (in which case an "Intl-only stats" toggle uses
  their complete data instead).
- **~21 China matches are missing Rating 2.0** specifically. By default
  those maps still count toward a player's other stats (kills, ACS, etc.),
  which can make a player's rating average reflect fewer maps than their
  other averages — a "Rated maps only" toggle makes every stat consistent
  by excluding those maps entirely.
- **Pistol win rate** assumes exactly 2 pistol rounds per map (rounds 1 and
  13 — none in overtime), and reads `—` for China teams since no economy
  data exists for that region.
- The **Agents** page's pick rates and map win rates are computed directly
  from per-map player data, not VLR's own aggregate page — verified to
  match VLR's own published percentages exactly (once accounting for a
  rounding-convention difference) everywhere a fair comparison was possible.
- **Attack/defense splits are missing on 42 of 1091 maps.** All 42 sit in
  China events, but this is emphatically *not* "China has no side data" —
  86% of China player-maps (2510 of 2930) have a perfectly good split, and
  every other region is at 100%. The gap is all-or-nothing per map (never
  per player), and 3 matches have a split on some maps but not others.
  The scraper still writes `t`/`ct` rows for the missing ones, filled with
  the map *total* on both sides; the export drops any pair failing
  `t + ct == both`, since leaving them in double-counted those players'
  kills under the Players page's Attack/Defend toggle. (The local match
  page that used to hide the side toggle for such maps, and warn when a
  series' side totals covered only some of its maps, has been replaced by
  links out to vlr.gg -- nothing surfaces that per-series caveat now.)
