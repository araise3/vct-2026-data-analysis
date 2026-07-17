# VCT 2026 — Season Stats Site

A static dashboard for VCT 2026 tier-1 player and team statistics, built from
the vlr.gg scrape data. Dark theme, four views (Overview, Players, Teams,
Economy), fully static — no backend, just JSON baked in at build time.

## Design

- **Colors**: graphite background (`#0B0D10`), brass/gold accent (`#C9A227`),
  and a red-amber-green diverging scale for rating/win-rate cells — the same
  scale used in the Excel workbook, so both deliverables read consistently.
- **Type**: Space Grotesk (headings), Inter (body), JetBrains Mono (every
  stat/number, so columns align).
- **Signature motif**: the small round-by-round win/loss squares strip
  (`src/components/RoundSquares.jsx`) — grounded in how VALORANT actually
  works, round-based, not decorative.
- Rounded corners throughout (`rounded-xl`/`rounded-2xl` — see
  `tailwind.config.js`), no shadows, no gradients, minimal borders.

## Project structure

```
vct-site/
├── public/
│   ├── data/           JSON data files (generated — see below)
│   └── _redirects      Cloudflare Pages SPA routing config
├── src/
│   ├── components/      Sidebar, DataTable, KpiCard, RankedList,
│   │                    HorizontalBarChart, StackedBar, RoundSquares, FilterChips
│   ├── pages/            Overview.jsx, Players.jsx, Teams.jsx, Economy.jsx
│   ├── lib/              useData.js (fetch+cache), format.js (number/color helpers)
│   ├── App.jsx           Routing shell
│   └── index.css         Tailwind + base styles
├── data_prep/
│   └── export.py         Regenerates public/data/*.json from the raw scrape
└── tailwind.config.js    Design tokens (colors, fonts, radius)
```

## Regenerating the data

The JSON in `public/data/` was computed by `data_prep/export.py` from the
same pickled dataframes used to build the Excel workbook — same team-name
canonicalization (tags → full names, the 3 China sponsor-name merges, the
ULF Esports / Eternal Fire merge), same region tagging, same "2 pistols per
map, none in overtime" rule.

If you re-scrape and want to refresh the site's data:

1. Re-run the export logic against your new CSVs (adapt `data_prep/export.py`
   to read directly from your scraper's output CSVs instead of the pickles
   — the pickles were just this session's intermediate cache)
2. Confirm the printed counts look right (teams, players, matches)
3. `npm run build` again

## Local development

```bash
npm install
npm run dev        # http://localhost:5173, hot reload
```

## Build

```bash
npm run build       # outputs to dist/
npm run preview     # serve the production build locally to sanity-check
```

## Deploying to Cloudflare Pages

**Option A — Git integration (recommended):**

1. Push this project to a GitHub/GitLab repo
2. In the Cloudflare dashboard: **Workers & Pages → Create → Pages → Connect to Git**
3. Select the repo. Build settings:
   - **Framework preset**: Vite
   - **Build command**: `npm run build`
   - **Build output directory**: `dist`
4. Deploy. Every push to your main branch redeploys automatically.

**Option B — Direct upload (no Git needed):**

```bash
npm run build
npx wrangler pages deploy dist --project-name=vct-2026-stats
```

(First run will prompt you to log in to Cloudflare via browser.)

The `public/_redirects` file is already set up so client-side routing
(`/players`, `/teams`, `/economy`) works correctly on Cloudflare Pages —
without it, refreshing on any page but `/` would 404.

## Known data-coverage caveats (surfaced in the UI itself, not just here)

- **China region**: VLR doesn't publish Performance-tab (multi-kills,
  clutches) or Economy-tab data for China matches. Rating 2.0 is also
  missing for ~8% of China rows. The Players page has a toggle to use
  International-only stats for the 21 China players who also competed in
  Masters/EWC (where full data does exist).
- **Pistol win rate** assumes exactly 2 pistol rounds per map (rounds 1 and
  13) — there are none in overtime, and VLR's economy data doesn't
  separately tally pistol-round totals, only wins.
- **"ULF Esports / Eternal Fire"** is one merged team in the Teams data —
  they held the same EMEA franchise slot sequentially (Riot Games removed
  ULF Esports on March 20, 2026; Eternal Fire filled the vacancy), never
  played each other.

## Extending

- **Add a 5th view**: create `src/pages/NewView.jsx`, add a route in
  `App.jsx`, add a nav item + icon in `src/components/Sidebar.jsx`.
- **Add a new stat column**: it needs to exist in the relevant JSON file
  first (extend `data_prep/export.py`), then add a column definition to the
  relevant page's `columns` array.
- **Change the accent color**: edit `accent` in `tailwind.config.js` —
  everything else derives from it.
