# VCT 2026 — Season Stats

A static stats dashboard for VCT 2026 tier-1 Valorant esports, built from
scraped [vlr.gg](https://vlr.gg) data. No backend — everything is a JSON
file baked in at build time, served as a static site.

**Live at:** deployed via Cloudflare Pages, connected to this repo's `main` branch.

## What's here

Six views, plus per-player and per-team profile pages:

| View | What it shows |
|---|---|
| **Overview** | Season KPIs (events, matches, maps, rounds, players, teams) and top-10 leaderboards |
| **Players** | Every player's Rating, ACS, K/D, KAST, ADR, HS%, kills/deaths/multi-kills/clutches, sortable and searchable |
| **Teams** | Match/map records, win rates, pistol win rate, average player rating |
| **Agents** | Pick rates and map win rates, filterable by Region → Stage → Phase → Week/Round (the last one is multi-select) |
| **Economy** | Buy-tier distribution (eco/semi-eco/semi-buy/full-buy) and win rates by tier |
| **Player / Team profiles** | Click any name anywhere on the site to open a full breakdown |
| **Graphics** | Build shareable HLTV-style stat cards — pick players or teams, pick a stat (rating, ACS, multi-kills/24R, round win%, pistol win%, …), filter the sample, tune minimum rounds/maps and top-N with live preview, then export a 2160px PNG |

Most pages that touch China have an explicit toggle for known VLR data gaps
(see [Data caveats](#data-caveats) below), and most also have a toggle to
fold in **Esports World Cup (EWC) 2026** results alongside the main VCT season.

## Tech stack

- **Vite + React** (function components, hooks — no class components)
- **React Router** for client-side routing (`/players/:name`, `/teams/:name`, etc.)
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
├── public/
│   ├── data/            JSON data files (generated -- see below)
│   ├── logos/           A few team logos re-hosted locally after
│   │                    pixel-level fixes (contrast/visibility), rather
│   │                    than pointing back at the original CDN
│   └── _redirects       Cloudflare Pages SPA routing config
├── src/
│   ├── components/      DataTable, HorizontalBarChart, StackedBar,
│   │                    RoundSquares, TeamLogo, AgentIcon, FilterChips,
│   │                    MultiFilterChips, KpiCard, RankedList, Sidebar
│   ├── pages/            Overview, Players, Teams, Agents, Economy,
│   │                    PlayerProfile, TeamProfile
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

## Regenerating the data

`data_prep/export_from_db.py` reads directly from the scraper's `.db` files
(no CSV export step needed) and writes every file in `public/data/`:

```bash
python3 data_prep/export_from_db.py
```

It expects `vlr_vct_2026.db` and `vlr_ewc_2026.db` (paths are constants near
the top of the script — update them to point at your fresh scrape). It
handles:

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
