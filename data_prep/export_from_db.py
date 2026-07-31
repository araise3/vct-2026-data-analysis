#!/usr/bin/env python3
"""
Same logic as the original export.py, adapted to read directly from the
scraper's SQLite database instead of pickled dataframes. This is the
version to use for future re-scrapes: just point DB_PATH at the fresh
.db file and run.
"""
import json
import math
import os
import sqlite3
import numpy as np
import pandas as pd

# Paths are environment-overridable so this runs unattended in CI -- where the
# DBs are restored into the workspace rather than sitting on this machine's
# Desktop -- without editing constants. The defaults are the previous hardcoded
# values, so a local run is unchanged. OUT is now derived from this file's own
# location (which resolves to the same directory the absolute path named) so it
# follows the repo if it ever moves.
_REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

DB_PATH = os.environ.get("VLR_DB_PATH", "C:/Users/leona/Desktop/scrape vlr/vlr_vct_2026.db")
EWC_DB_PATH = os.environ.get("VLR_EWC_DB_PATH", "C:/Users/leona/Desktop/scrape vlr/vlr_ewc_2026.db")
# 2025 historical DBs -- built by scraper/vlr_vct_2025_scraper.py and
# scraper/vlr_ewc_2025_scraper.py, one-time backfills that live inside this
# repo's own scraper/ directory (unlike the 2026 DBs above, which sit
# outside the repo by convention). Both are optional the same way EWC_DB_PATH
# is: load_db() tolerates either being absent.
VCT_2025_DB_PATH = os.environ.get("VLR_VCT_2025_DB_PATH", os.path.join(_REPO_ROOT, "scraper", "vlr_vct_2025.db"))
EWC_2025_DB_PATH = os.environ.get("VLR_EWC_2025_DB_PATH", os.path.join(_REPO_ROOT, "scraper", "vlr_ewc_2025.db"))
OUT = os.environ.get("VLR_OUT", os.path.join(_REPO_ROOT, "public", "data"))

CHINA_TEAMS = ['All Gamers', 'Bilibili Gaming', 'Dragon Ranger Gaming', 'EDward Gaming',
               'FunPlus Phoenix', 'JDG Esports', 'Nova Esports', 'TYLOO',
               'Titan Esports Club', 'Trace Esports', 'Wolves Esports', 'Xi Lai Gaming']

# The China sponsor-prefixed long names and EWC sub-branded rosters that
# are really the same org as their short/parent form (mechanically
# obvious: the parent name is in parens).
CANONICAL_OVERRIDES = {
    "Guangzhou Huadu Bilibili Gaming (Bilibili Gaming)": "Bilibili Gaming",
    "JD Mall JDG Esports (JDG Esports)": "JDG Esports",
    "Wuxi Titan Esports Club (Titan Esports Club)": "Titan Esports Club",
    "AG.AL (All Gamers)": "All Gamers",
    "MIBR.LOS (MIBR)": "MIBR",
}


def clean_num(v):
    if v is None:
        return None
    if isinstance(v, (float, np.floating)) and (math.isnan(v) or math.isinf(v)):
        return None
    if isinstance(v, (np.integer,)):
        return int(v)
    if isinstance(v, (np.floating,)):
        return round(float(v), 4)
    return v


def clean_row(d):
    return {k: clean_num(v) for k, v in d.items()}


def pct_to_float(s):
    return pd.to_numeric(s.astype(str).str.replace('%', '', regex=False), errors='coerce') / 100


TABLE_COLUMNS = {
    "matches": ["match_id", "event_id", "team1", "team2", "score1", "score2",
                "stage", "match_date", "match_url", "status"],
    "maps": ["match_id", "map_index", "map_name", "team1_score", "team2_score",
             "team1_atk_score", "team1_def_score", "team2_atk_score",
             "team2_def_score", "duration"],
    "map_player_stats": ["match_id", "map_index", "player", "team", "agent",
                         "rating", "acs", "kills", "deaths", "assists", "kd_diff",
                         "kast", "adr", "hs_pct", "first_kills", "first_deaths",
                         "fk_fd_diff", "side", "multi_2k", "multi_3k", "multi_4k",
                         "multi_5k", "clutch_1v1", "clutch_1v2", "clutch_1v3",
                         "clutch_1v4", "clutch_1v5", "econ", "plants", "defuses"],
    "map_team_economy": ["match_id", "map_index", "team", "pistol_won",
                         "eco_rounds", "eco_won", "semi_eco_rounds", "semi_eco_won",
                         "semi_buy_rounds", "semi_buy_won", "full_buy_rounds", "full_buy_won"],
    "map_round_economy": ["match_id", "map_index", "round_num", "team1_bank", "team1_loadout",
                          "team1_buy_type", "team1_round_win", "team2_bank", "team2_loadout",
                          "team2_buy_type", "team2_round_win"],
    "map_round_results": ["match_id", "map_index", "round_num", "winner", "winner_side", "win_condition"],
    "events": ["event_id", "slug", "name", "region", "stage", "dates", "prize", "location"],
}


def load_db(path, competition, year):
    # The EWC db (and both 2025 DBs) are separate optional files -- if one
    # isn't present, run without it rather than erroring, using empty (but
    # correctly-shaped) frames so every downstream pd.concat/merge still
    # works unchanged.
    if not os.path.exists(path):
        print(f"[info] {path} not found -- skipping ({competition} {year} data will be empty)")
        return {name: pd.DataFrame(columns=cols + ["competition", "year"])
                for name, cols in TABLE_COLUMNS.items()}
    conn = sqlite3.connect(path)
    tables = {}
    for name in ["matches", "maps", "map_player_stats", "map_team_economy", "events",
                 "map_round_economy", "map_round_results"]:
        df = pd.read_sql_query(f"SELECT * FROM {name}", conn)
        df["competition"] = competition
        # Which season this row belongs to -- tagged at load time from which
        # DB it came from (VLR's own event names already carry the year too,
        # e.g. "Vct 2025 Americas Kickoff" vs "Vct 2026 Americas Kickoff", so
        # there's no name-collision risk between years; this tag is what lets
        # the site offer a dedicated Year filter rather than making users
        # parse it back out of the event name).
        df["year"] = year
        tables[name] = df
    conn.close()
    return tables


def main():
    # The VCT database is the primary dataset -- an export without it is never
    # something anyone wants. load_db() below deliberately tolerates a missing
    # file (the EWC database legitimately may not exist), but applying that
    # same tolerance to the VCT one is actively dangerous unattended: a DB that
    # failed to restore would export a full set of *empty* JSON files, and an
    # automated job would happily commit them over the real site data. Fail
    # loudly here instead.
    if not os.path.exists(DB_PATH):
        raise SystemExit(
            f"[FATAL] VCT database not found: {DB_PATH}\n"
            f"        Set VLR_DB_PATH, or run the scraper first. Refusing to export "
            f"an empty dataset over existing data."
        )

    vct_2026 = load_db(DB_PATH, "VCT", 2026)
    ewc_2026 = load_db(EWC_DB_PATH, "EWC", 2026)

    # Second guard on the same hazard: the file can exist and still be useless
    # (a zero-byte placeholder, a fresh DB the scraper only just created, a
    # restore that produced a valid but empty SQLite file). Nothing downstream
    # distinguishes "no completed matches" from "no data", so check it here
    # where the intent is unambiguous. Deliberately checked against
    # vct_2026 alone (not the year-merged `vct` built below) -- this guard
    # exists specifically to catch a broken *current-season* DB, and a
    # healthy 2025 backfill sitting alongside a corrupt 2026 DB must not
    # mask that.
    _completed = vct_2026["matches"]
    _completed = _completed[_completed["status"] == "completed"] if len(_completed) else _completed
    if len(_completed) == 0:
        raise SystemExit(
            f"[FATAL] {DB_PATH} contains no completed matches -- it is empty or was "
            f"only just created.\n        Refusing to export an empty dataset over "
            f"existing data."
        )

    # 2025 historical backfill -- both optional (load_db tolerates either
    # being absent), same as EWC_DB_PATH above.
    vct_2025 = load_db(VCT_2025_DB_PATH, "VCT", 2025)
    ewc_2025 = load_db(EWC_2025_DB_PATH, "EWC", 2025)

    # From here on, `vct` and `ewc` are each a union across every season for
    # that competition -- every line below this point that reads vct[...]/
    # ewc[...] was written before 2025 data existed and needs no changes at
    # all, since it was already only ever assuming "VCT data" / "EWC data"
    # with no season baked into that assumption.
    def merge_dbs(*dbs):
        return {name: pd.concat([d[name] for d in dbs], ignore_index=True) for name in TABLE_COLUMNS}

    # Showmatches -- exhibition games VLR bundles into a real event's match
    # list (all-star matches, "Team Tarik vs Team Toast" fan events, etc.)
    # even though they're not part of the competitive bracket and their
    # rosters don't reflect any real team. VLR's own match page marks each
    # one with a "Showmatch" tag, and the scraper already captures that as a
    # literal "Showmatch: <name>" prefix on matches.stage -- a real signal
    # already present in the data, not id-guessing, so this generalizes to
    # any future showmatch (any season) with no code change. Found 6 in the
    # 2025 VCT backfill this way (450589, 507067, 530514, 536176, 536985,
    # 538583) -- 3 more than the 3 a user happened to spot by hand, which is
    # exactly why this filters on the underlying signal instead of hardcoding
    # those 3 ids. Applied to every match-id-keyed table, not just matches
    # itself, so a showmatch can't leak into player/team stats, buckets,
    # agents.json, or match_results/match_players via a table that still
    # carries its rows after `matches` alone gets filtered.
    def drop_showmatches(tables):
        m = tables["matches"]
        show_ids = set(m.loc[m["stage"].fillna("").str.startswith("Showmatch"), "match_id"])
        if not show_ids:
            return tables
        print(f"  dropping {len(show_ids)} showmatch(es): {sorted(show_ids)}")
        return {
            name: (df[~df["match_id"].isin(show_ids)].copy() if "match_id" in df.columns else df)
            for name, df in tables.items()
        }

    vct = drop_showmatches(merge_dbs(vct_2026, vct_2025))
    ewc = drop_showmatches(merge_dbs(ewc_2026, ewc_2025))

    # Combined universe: every downstream computation runs on this, then
    # gets filtered back down to competition=='VCT' for the default
    # (today's) output, or left unfiltered for the "+EWC" variant. This
    # keeps the two code paths identical except for which rows are in
    # scope, rather than maintaining two separate pipelines.
    matches = pd.concat([vct["matches"], ewc["matches"]], ignore_index=True)
    maps_df = pd.concat([vct["maps"], ewc["maps"]], ignore_index=True)
    # side='both' only -- see the matching, more detailed comment on the
    # other map_player_stats concat (all_mps) further down. This copy feeds
    # team_stats()/players_out (region/nationality meta only, so mostly
    # harmless) and the Agents pick-rate pipeline (buckets/agentCounts/
    # playerRows) -- confirmed that one actually mattered: pick-rate and
    # win-rate percentages happened to cancel the 3x out mathematically
    # (numerator and denominator both come from the same row count), but
    # playerRows is a raw count with nothing to cancel against, and was
    # showing 3x too many "team-maps in scope" on the Agents page.
    mps = pd.concat([vct["map_player_stats"], ewc["map_player_stats"]], ignore_index=True)
    mps = mps[mps["side"] == "both"]
    mte = pd.concat([vct["map_team_economy"], ewc["map_team_economy"]], ignore_index=True)
    events = pd.concat([vct["events"], ewc["events"]], ignore_index=True)

    # Player nationality: a player-level attribute, not match-level, so it
    # doesn't need the competition tag -- just load from whichever DB(s)
    # have it and combine. Only populated for matches that have actually
    # been (re-)scraped since this feature was added, so coverage will be
    # partial until a fuller re-scrape happens.
    def load_nationality(path):
        conn = sqlite3.connect(path)
        try:
            df = pd.read_sql_query("SELECT * FROM player_nationality", conn)
        except Exception:
            df = pd.DataFrame(columns=['player', 'country_code', 'country_name'])
        conn.close()
        return df

    nationality = pd.concat(
        [load_nationality(DB_PATH), load_nationality(EWC_DB_PATH),
         load_nationality(VCT_2025_DB_PATH), load_nationality(EWC_2025_DB_PATH)],
        ignore_index=True
    ).drop_duplicates(subset='player', keep='first')
    nationality_map = nationality.set_index('player')[['country_code', 'country_name']].to_dict('index')

    # Supplementary, much more complete nationality source: VLR's own
    # /stats/ leaderboard page lists every VCT 2026 player at once (4
    # pages, ~100 each), rather than relying on box scores from
    # individually re-scraped matches. Verified: all 313 players already
    # on the site matched exactly against this source. Takes priority
    # over the sparser per-match table above.
    try:
        with open(os.path.join(os.path.dirname(__file__), "player_countries.json")) as f:
            stats_page_nationality = json.load(f)
        for player, info in stats_page_nationality.items():
            nationality_map[player] = info
    except FileNotFoundError:
        pass

    # Raw scrape has kast/hs_pct as "73%" strings -- convert to fractions
    for col in ['kast', 'hs_pct']:
        mps[col] = pct_to_float(mps[col])

    # --- Build the team-name lookup fresh from this scrape's own data ---
    # (tags like "NAVI" -> full names, via positional correspondence in
    # map_team_economy, verified previously to be 100% consistent)
    mte_sorted = mte.sort_values(['match_id', 'map_index']).copy()
    mte_sorted['row_within_map'] = mte_sorted.groupby(['match_id', 'map_index']).cumcount()
    m = mte_sorted.merge(matches[['match_id', 'team1', 'team2']], on='match_id')
    m['full_name'] = m.apply(lambda r: r['team1'] if r['row_within_map'] == 0 else r['team2'], axis=1)
    tag_to_full = m[['team', 'full_name']].drop_duplicates().set_index('team')['full_name'].to_dict()

    all_full_names = sorted(pd.unique(pd.concat([matches['team1'], matches['team2']]).dropna()))
    name_to_canon = {}
    for name in all_full_names:
        name_to_canon[name] = CANONICAL_OVERRIDES.get(name, name)
    for tag, full in tag_to_full.items():
        canon = CANONICAL_OVERRIDES.get(full, full)
        name_to_canon[tag] = canon

    # ULF Esports / Eternal Fire merge (confirmed: same EMEA slot held
    # sequentially, never played each other) -- canonical name is just
    # "Eternal Fire" (the current, active org), not the combined form.
    for k, v in list(name_to_canon.items()):
        if v in ('ULF Esports', 'Eternal Fire'):
            name_to_canon[k] = 'Eternal Fire'

    matches['c1'] = matches['team1'].map(name_to_canon).fillna(matches['team1'])
    matches['c2'] = matches['team2'].map(name_to_canon).fillna(matches['team2'])
    mps['canonical_team'] = mps['team'].map(name_to_canon).fillna(mps['team'])
    mte['canonical_team'] = mte['team'].map(name_to_canon).fillna(mte['team'])

    matches = matches.merge(events[['event_id', 'region']], on='event_id', how='left')
    mps = mps.merge(matches[['match_id', 'region']], on='match_id', how='left')

    team_region_votes = pd.concat([
        matches[matches.region != 'International'][['c1', 'region']].rename(columns={'c1': 'team'}),
        matches[matches.region != 'International'][['c2', 'region']].rename(columns={'c2': 'team'}),
    ])
    team_primary_region = team_region_votes.groupby('team')['region'].agg(
        lambda s: s.value_counts().idxmax()
    ).to_dict()

    completed = matches[matches['status'] == 'completed'].copy()
    maps_df = maps_df.merge(matches[['match_id', 'c1', 'c2']], on='match_id', how='left')
    maps_df['winner'] = np.where(maps_df.team1_score > maps_df.team2_score, maps_df.c1,
                          np.where(maps_df.team2_score > maps_df.team1_score, maps_df.c2, None))
    maps_df['rounds_total'] = maps_df['team1_score'] + maps_df['team2_score']

    mps = mps.merge(maps_df[['match_id', 'map_index', 'rounds_total']],
                     on=['match_id', 'map_index'], how='left')

    canonical_teams = sorted(set(name_to_canon.values()))
    canonical_teams = [t for t in canonical_teams if t != 'TBD']

    # ------------------------------------------------------------------
    # teams.json
    # ------------------------------------------------------------------
    def team_stats(completed_sub, maps_df_sub, mps_sub, mte_sub, team):
        team_matches = completed_sub[(completed_sub.c1 == team) | (completed_sub.c2 == team)]
        matches_played = len(team_matches)
        matches_won = int((
            ((team_matches.c1 == team) & (team_matches.score1 > team_matches.score2)) |
            ((team_matches.c2 == team) & (team_matches.score2 > team_matches.score1))
        ).sum())

        team_maps = maps_df_sub[(maps_df_sub.c1 == team) | (maps_df_sub.c2 == team)]
        maps_played = len(team_maps)
        maps_won = int((team_maps.winner == team).sum())
        rounds_played = int(team_maps['rounds_total'].sum())

        team_econ = mte_sub[mte_sub.canonical_team == team]
        pistol_won = int(team_econ['pistol_won'].sum()) if len(team_econ) else 0
        pistol_played = maps_played * 2

        team_players = mps_sub[mps_sub.canonical_team == team]
        tp_valid = team_players.dropna(subset=['rating'])
        avg_rating = ((tp_valid['rating'] * tp_valid['rounds_total']).sum() / tp_valid['rounds_total'].sum()
                      if len(tp_valid) and tp_valid['rounds_total'].sum() else None)

        return clean_row({
            "matchesPlayed": matches_played,
            "matchesWon": matches_won,
            "matchWinPct": (matches_won / matches_played) if matches_played else None,
            "mapsPlayed": maps_played,
            "mapsWon": maps_won,
            "mapWinPct": (maps_won / maps_played) if maps_played else None,
            "roundsPlayed": rounds_played,
            "pistolWon": pistol_won,
            "pistolPlayed": pistol_played,
            "pistolWinPct": (pistol_won / pistol_played) if pistol_played else None,
            "avgRating": avg_rating,
        })

    completed_vct = completed[completed.competition == 'VCT']
    events_vct = events[events.competition == 'VCT']
    maps_df_vct = maps_df[maps_df.competition == 'VCT']
    mps_vct = mps[mps.competition == 'VCT']
    mte_vct = mte[mte.competition == 'VCT']

    # Identity/meta only -- every stat is derived from buckets at read
    # time, so there is nothing to precompute per competition here.
    teams_out = [
        {"team": team, "region": team_primary_region.get(team, "International")}
        for team in canonical_teams
    ]

    # teams_out / players_out are kept in memory only -- they feed the
    # bucket meta blocks below. Nothing writes a pre-aggregated season
    # file any more: every view derives its numbers from buckets, so
    # there is exactly one source of truth and no per-variant
    # precomputation to keep in sync.
    print(f"teams: {len(teams_out)} (in-memory, feeds bucket meta)")

    # ------------------------------------------------------------------
    # players.json
    # ------------------------------------------------------------------
    # Roster, team assignment, and China/Intl detection are all based on
    # VCT-only data -- this keeps the default (today's) output stable
    # regardless of EWC being folded in below. A player who only ever
    # played EWC (never VCT) simply won't appear here even with the EWC
    # toggle on; that's a deliberate scope limit, not a bug.
    china_players_set = set(mps_vct[mps_vct['canonical_team'].isin(CHINA_TEAMS)]['player'].unique())
    intl_rows = mps_vct[(mps_vct['player'].isin(china_players_set)) & (mps_vct['region'] == 'International')]
    players_with_intl = set(intl_rows['player'].unique())

    # keep='last' (most recent match), not 'first' -- meta.team is meant
    # to answer "what team is this player on now", and using their
    # very-first-ever match's team meant anyone who transferred mid-
    # season (confirmed: Cloud GIANTX->FNATIC, CyvOph FNATIC->Natus
    # Vincere, both for Stage 2) showed their OLD team everywhere this
    # field is read (Players/Overview/Records tables, PlayerProfile's
    # team link) even long after leaving. Doesn't affect
    # player_buckets.json's own per-bucket "t" field, which already
    # correctly reflects each bucket's own team regardless of this.
    players_first = mps_vct.sort_values(['match_id', 'map_index'])[['player', 'canonical_team']] \
        .drop_duplicates(subset='player', keep='last')

    def player_stats(sub):
        if len(sub) == 0:
            return None
        kills = sub['kills'].sum()
        deaths = sub['deaths'].sum()
        rounds = sub['rounds_total']
        total_rounds = rounds.sum()

        def rounds_weighted(col):
            # VLR's own season aggregates weight Rating/KAST/ADR/HS% by
            # rounds played per map, not a flat per-map average -- verified
            # against real VLR aggregate data for two different players
            # (3 maps and 86 maps): flat-averaging Rating overstated it
            # (1.39 vs VLR's actual 1.30 for a 3-map sample), while
            # rounds-weighting matched exactly in both cases.
            valid = sub[[col]].join(rounds.rename('_rounds')).dropna(subset=[col])
            if len(valid) == 0 or valid['_rounds'].sum() == 0:
                return None
            return (valid[col] * valid['_rounds']).sum() / valid['_rounds'].sum()

        return clean_row({
            "mapsPlayed": len(sub),
            "roundsPlayed": int(total_rounds),
            "avgRating": rounds_weighted('rating'),
            # ACS is the one exception -- verified against real VLR data
            # that it's flat-averaged per map, not rounds-weighted (a
            # rounds-weighted ACS undershot VLR's actual value in both
            # test cases).
            "avgAcs": sub['acs'].mean(),
            "totalKills": int(kills),
            "totalDeaths": int(deaths),
            "kd": (kills / deaths) if deaths else None,
            "totalAssists": int(sub['assists'].sum()),
            "avgKast": rounds_weighted('kast'),
            "avgAdr": rounds_weighted('adr'),
            "avgHsPct": rounds_weighted('hs_pct'),
            "totalFirstKills": int(sub['first_kills'].sum()),
            "totalFirstDeaths": int(sub['first_deaths'].sum()),
            "total2k": int(sub['multi_2k'].sum()) if sub['multi_2k'].notna().any() else 0,
            "total3k": int(sub['multi_3k'].sum()) if sub['multi_3k'].notna().any() else 0,
            "total4k": int(sub['multi_4k'].sum()) if sub['multi_4k'].notna().any() else 0,
            "totalAce": int(sub['multi_5k'].sum()) if sub['multi_5k'].notna().any() else 0,
            "totalClutches": int(sub[['clutch_1v1','clutch_1v2','clutch_1v3','clutch_1v4','clutch_1v5']].sum().sum()),
        })

    players_out = []
    for _, row in players_first.iterrows():
        player = row['player']
        team = row['canonical_team']
        is_china = player in china_players_set
        nat = nationality_map.get(player)
        # Identity/meta only. The old precomputed variants here
        # (season stats, International-only, rated-maps-only, +EWC) are
        # all now expressible as facet selections or a toggle over the
        # bucket data, so none of them are precomputed.
        players_out.append({
            "player": player,
            "team": team,
            "region": team_primary_region.get(team, "International"),
            "isChina": is_china,
            "countryCode": nat['country_code'] if nat and nat['country_code'] != 'un' else None,
            "countryName": nat['country_name'] if nat and nat['country_code'] != 'un' else None,
        })

    print(f"players: {len(players_out)} (in-memory, feeds bucket meta) "
          f"({sum(1 for p in players_out if not p['isChina'])} non-China, "
          f"{sum(1 for p in players_out if p['isChina'])} China)")

    # ------------------------------------------------------------------
    # overview.json
    # ------------------------------------------------------------------
    # ------------------------------------------------------------------
    # player_buckets.json / team_buckets.json
    # ------------------------------------------------------------------
    # Season totals above are pre-aggregated and therefore can't be
    # filtered by event/stage/phase/week. These bucket files carry the
    # same underlying data broken out per (entity, event, week), letting
    # the site aggregate any filter combination client-side -- the same
    # approach already used for agents.json.
    #
    # Only event_id + week are stored as keys: region, event name,
    # event-level stage and phase are all derivable from them via the
    # events lookup, so storing them per row would just bloat the file.
    #
    # Averages are stored as (value x rounds) sums plus their round
    # counts rather than pre-divided averages, so the site can reproduce
    # the rounds-weighted averaging VLR uses at any aggregation level --
    # averaging pre-computed averages would be wrong.
    all_matches = pd.concat([vct["matches"], ewc["matches"]], ignore_index=True)
    all_events = pd.concat([vct["events"], ewc["events"]], ignore_index=True)
    all_maps = pd.concat([vct["maps"], ewc["maps"]], ignore_index=True)
    # map_player_stats now has 3 rows per player per map (side='both'/'t'/
    # 'ct', since the scraper started capturing the attack/defense split --
    # see the scraper README). Every aggregate stat downstream (player
    # buckets, team ratings) must only ever use the 'both' row: since
    # t+ct == both by construction, summing all three would silently
    # double every counted stat (kills, deaths, rating-rounds, ...) and
    # triple every *count* (maps, rows) -- confirmed this exact corruption
    # happened before this filter was added (aspas: kills came out at
    # exactly 2x and maps at exactly 3x the real totals). The 't'/'ct'
    # rows aren't used anywhere in this script yet; filtering here means
    # nothing downstream needs to remember to do it.
    all_mps = pd.concat([vct["map_player_stats"], ewc["map_player_stats"]], ignore_index=True)
    all_mps_unfiltered = all_mps.copy()  # keeps the 't'/'ct' rows, for player_sides.json below
    all_mps = all_mps[all_mps["side"] == "both"]
    all_mte = pd.concat([vct["map_team_economy"], ewc["map_team_economy"]], ignore_index=True)
    all_mre = pd.concat([vct["map_round_economy"], ewc["map_round_economy"]], ignore_index=True)
    all_mrr = pd.concat([vct["map_round_results"], ewc["map_round_results"]], ignore_index=True)
    for col in ['kast', 'hs_pct']:
        all_mps[col] = pct_to_float(all_mps[col])

    all_mps['canonical_team'] = all_mps['team'].map(name_to_canon).fillna(all_mps['team'])
    all_mte['canonical_team'] = all_mte['team'].map(name_to_canon).fillna(all_mte['team'])
    all_matches['c1'] = all_matches['team1'].map(name_to_canon).fillna(all_matches['team1'])
    all_matches['c2'] = all_matches['team2'].map(name_to_canon).fillna(all_matches['team2'])

    events_lookup = {}
    for r in all_events.to_dict(orient='records'):
        events_lookup[int(r['event_id'])] = {
            "name": r['name'], "region": r['region'], "stage": r['stage'],
            "competition": r['competition'], "year": int(r['year']),
        }

    am = all_maps.merge(
        all_matches[['match_id', 'event_id', 'stage', 'c1', 'c2', 'status']],
        on='match_id', how='left', suffixes=('', '_m')
    )
    am['rounds_total'] = am['team1_score'] + am['team2_score']
    am['winner'] = np.where(am.team1_score > am.team2_score, am.c1,
                     np.where(am.team2_score > am.team1_score, am.c2, None))

    def parse_duration(s):
        # Scraper stores this as VLR's own .map-duration text -- "44:31"
        # (mm:ss) normally, but "1:01:51" (h:mm:ss) once a map runs past
        # an hour, confirmed against a real export (values like '1:01:51'
        # and '1:02:51' alongside plain '44:31' / '58:37'). Coverage is
        # partial -- only matches scraped/re-scraped since this field was
        # added carry it -- same situation as player nationality above.
        #
        # Confirmed root cause of the only real gap found so far: VLR
        # itself shows a literal "-" instead of a duration for 94 maps,
        # 100% of them China-region (VCT China Kickoff/Stage 1/Stage 2,
        # EWC China Qualifier) -- the same known gap as the missing
        # Rating 2.0 values noted elsewhere in this pipeline. Nothing to
        # extract if VLR's own China broadcast pipeline never published
        # it. Return None rather than 0 for anything missing/malformed
        # so it's excluded from averages instead of dragging them down.
        if not isinstance(s, str) or ':' not in s:
            return None
        parts = s.split(':')
        try:
            parts = [int(p) for p in parts]
        except ValueError:
            return None
        seconds = 0
        for p in parts:
            seconds = seconds * 60 + p
        return seconds

    am['duration_seconds'] = am['duration'].apply(parse_duration)

    mps_ctx = all_mps.merge(
        all_matches[['match_id', 'event_id', 'stage', 'match_date']], on='match_id', how='left'
    ).merge(
        am[['match_id', 'map_index', 'rounds_total', 'winner']], on=['match_id', 'map_index'], how='left'
    )
    # Did this player's team win this map? `winner` is already canonical
    # (built from c1/c2 on `am`), so it's compared against canonical_team,
    # not the raw scraped `team` -- the same raw-vs-canonical trap that
    # silently dropped rounds in the map_round_results pipeline below.
    # A drawn/unfinished map has winner=NaN and correctly counts as a
    # non-win rather than erroring.
    mps_ctx['won'] = (mps_ctx['canonical_team'] == mps_ctx['winner']).astype(int)

    def day_col(series):
        """match_date timestamps -> 'YYYY-MM-DD' strings (NaT -> None)."""
        return pd.to_datetime(series, errors='coerce').dt.strftime('%Y-%m-%d')

    def first_day(g):
        """The single calendar day a group falls on, or None."""
        d = pd.to_datetime(g['match_date'], errors='coerce').dropna()
        return d.min().strftime('%Y-%m-%d') if len(d) else None

    mps_ctx['date'] = day_col(mps_ctx['match_date'])

    def wsum(g, col):
        """(value x rounds) sum and the rounds behind it, ignoring nulls."""
        valid = g[[col, 'rounds_total']].dropna()
        if len(valid) == 0:
            return 0.0, 0
        return float((valid[col] * valid['rounds_total']).sum()), int(valid['rounds_total'].sum())

    player_buckets = []
    for (player, event_id, week, day), g in mps_ctx.groupby(
            ['player', 'event_id', 'stage', 'date'], dropna=True):
        r_sum, r_rnd = wsum(g, 'rating')
        k_sum, k_rnd = wsum(g, 'kast')
        a_sum, a_rnd = wsum(g, 'adr')
        h_sum, h_rnd = wsum(g, 'hs_pct')
        acs_valid = g['acs'].dropna()
        row = {
            "p": player, "e": int(event_id), "w": week, "d": day,
            # Real per-bucket team, not just the player's single global
            # meta.team -- a player who switches teams mid-season (e.g.
            # Cloud: GIANTX -> FNATIC for Stage 2, CyvOph: FNATIC ->
            # Natus Vincere) has buckets under BOTH teams, and each one
            # needs to know which team it actually belongs to. Takes the
            # first row's team per group rather than groupby-ing on team
            # too, since a player is on exactly one team for any single
            # (event, week, day) in practice and this avoids silently
            # splitting a bucket into two half-populated ones on the
            # rare chance a group's rows disagree.
            "t": g['canonical_team'].iloc[0],
            "maps": int(len(g)), "rnd": int(g['rounds_total'].fillna(0).sum()),
            # Maps won by this player's team. Enables a per-player W-L
            # record and win rate (the Players/PlayerProfile pages had no
            # win data at all before this) without a second join on the
            # client -- a player is on exactly one team per map, so this
            # is unambiguous at this grain.
            #
            # Keyed "wn", NOT "w": "w" is already this bucket's WEEK
            # string four lines up. A dict literal silently keeps only the
            # last duplicate key, so calling this "w" would replace every
            # bucket's week with a win count and break all week/phase
            # filtering sitewide -- same collision class as the date-vs-
            # deaths (`d`) note in entityBuckets.expandBuckets.
            "wn": int(g['won'].sum()),
            "ratS": round(r_sum, 3), "ratR": r_rnd,
            "acsS": round(float(acs_valid.sum()), 2), "acsM": int(len(acs_valid)),
            "kastS": round(k_sum, 4), "kastR": k_rnd,
            "adrS": round(a_sum, 3), "adrR": a_rnd,
            "hsS": round(h_sum, 4), "hsR": h_rnd,
            "k": int(g['kills'].fillna(0).sum()), "d": int(g['deaths'].fillna(0).sum()),
            "a": int(g['assists'].fillna(0).sum()),
            "fk": int(g['first_kills'].fillna(0).sum()), "fd": int(g['first_deaths'].fillna(0).sum()),
            "m2": int(g['multi_2k'].fillna(0).sum()), "m3": int(g['multi_3k'].fillna(0).sum()),
            "m4": int(g['multi_4k'].fillna(0).sum()), "m5": int(g['multi_5k'].fillna(0).sum()),
            "cl": int(g[['clutch_1v1','clutch_1v2','clutch_1v3','clutch_1v4','clutch_1v5']].fillna(0).sum().sum()),
            # Utility/objective play. utN is how many of this bucket's maps
            # actually carry these fields -- they're null for every
            # China-region map (same VLR gap as economy data), so the site
            # divides by utN and shows nothing when it's 0, rather than
            # showing a misleading 0 plants.
            "pl": int(g['plants'].fillna(0).sum()),
            "df": int(g['defuses'].fillna(0).sum()),
            "ecS": round(float(g['econ'].dropna().sum()), 2),
            "utN": int(g['econ'].notna().sum()),
            # Consistency: per-map rating sum and sum of squares (unweighted,
            # unlike ratS which is rounds-weighted). Storing the squares is
            # what makes standard deviation computable over *any* filtered
            # subset by summing buckets -- var = E[x^2] - E[x]^2 -- instead
            # of needing every individual map's rating on the client.
            "rmS": round(float(g['rating'].dropna().sum()), 3),
            "rmSq": round(float((g['rating'].dropna() ** 2).sum()), 4),
            "rmN": int(g['rating'].notna().sum()),
        }
        # Sparse "unrated maps" delta: only ~21 China matches lack Rating
        # 2.0, so rather than duplicating every field for a rated-only
        # variant, store just what those maps contributed. The site
        # subtracts this to get rated-only figures. Omitted entirely
        # (the overwhelmingly common case) when every map has a rating.
        unrated = g[g['rating'].isna()]
        if len(unrated) > 0:
            u_acs = unrated['acs'].dropna()
            row["u"] = {
                "maps": int(len(unrated)), "rnd": int(unrated['rounds_total'].fillna(0).sum()),
                "wn": int(unrated['won'].sum()),
                "acsS": round(float(u_acs.sum()), 2), "acsM": int(len(u_acs)),
                "kastS": round(wsum(unrated, 'kast')[0], 4), "kastR": wsum(unrated, 'kast')[1],
                "adrS": round(wsum(unrated, 'adr')[0], 3), "adrR": wsum(unrated, 'adr')[1],
                "hsS": round(wsum(unrated, 'hs_pct')[0], 4), "hsR": wsum(unrated, 'hs_pct')[1],
                "k": int(unrated['kills'].fillna(0).sum()), "d": int(unrated['deaths'].fillna(0).sum()),
                "a": int(unrated['assists'].fillna(0).sum()),
                "fk": int(unrated['first_kills'].fillna(0).sum()),
                "fd": int(unrated['first_deaths'].fillna(0).sum()),
            }
        player_buckets.append(row)

    player_meta = {}
    for p in players_out:
        player_meta[p['player']] = {
            "team": p['team'], "region": p['region'], "isChina": p['isChina'],
            "countryCode": p['countryCode'], "countryName": p['countryName'],
        }

    with open(f"{OUT}/player_buckets.json", "w") as f:
        json.dump({"events": events_lookup, "meta": player_meta, "buckets": player_buckets},
                  f, separators=(',', ':'))
    print(f"player_buckets.json: {len(player_buckets)} buckets")

    # --- attack/defense side splits (player_sides.json) ---
    # A much lighter parallel export of just the headline per-player stats
    # (Rating/ACS/K/D/A/KAST/ADR/HS%/FK/FD), computed for side='t' (attack)
    # and side='ct' (defend) specifically -- matches VLR's own All/Attack/
    # Defend toggle exactly. Kept as a separate file rather than adding
    # _t/_ct variants of every field to player_buckets.json, since only
    # this handful of stats is meaningful to split by side -- clutches,
    # utility, and consistency don't have a side breakdown in the source
    # data at all.
    mps_sides = all_mps_unfiltered[all_mps_unfiltered['side'].isin(['t', 'ct'])].merge(
        all_matches[['match_id', 'event_id', 'stage', 'match_date']], on='match_id', how='left'
    ).merge(
        am[['match_id', 'map_index', 'rounds_total']], on=['match_id', 'map_index'], how='left'
    )
    mps_sides['date'] = day_col(mps_sides['match_date'])
    for col in ['kast', 'hs_pct']:
        mps_sides[col] = pct_to_float(mps_sides[col])

    # Drop 't'/'ct' pairs that aren't a real split.
    #
    # Some maps have no attack/defense breakdown published, but the scraper
    # still emits both rows for them -- each filled with the map TOTAL for
    # kills/deaths/assists and null for every rate stat. Taken at face value
    # that isn't merely empty, it's wrong in two ways: the pair
    # double-counts (t.k == ct.k == both.k, so any aggregate over sides
    # reports twice the player's real kills on the Players page's Attack/
    # Defend toggle), and a match page renders identical Attack and Defend
    # columns as though that were a finding.
    #
    # Measured scope, so nobody widens this into a region rule: 42 of 1091
    # maps are affected, ALL of them in China events -- but this is NOT
    # "China has no side data". 2510 of China's 2930 player-maps (86%) have
    # a perfectly good split; the gap is 14%, concentrated in a handful of
    # specific weeks. It's also all-or-nothing per map (42 maps fully
    # missing, 0 partially), and 3 matches have it on some maps but not
    # others. Contrast the multi-kill/clutch/econ/objective columns, which
    # ARE a clean region-wide gap: 0 of 3440 China rows across both DBs.
    #
    # The test is the invariant a genuine split must satisfy: the two sides
    # partition the map, so t + ct == both exactly. Checking that rather
    # than region, or "is rating null?", is what keeps the 86% that works.
    _both = (mps_ctx[['match_id', 'map_index', 'player', 'kills', 'deaths']]
             .rename(columns={'kills': '_bk', 'deaths': '_bd'}))
    _sums = (mps_sides.groupby(['match_id', 'map_index', 'player'], dropna=True)[['kills', 'deaths']]
             .sum().reset_index().rename(columns={'kills': '_sk', 'deaths': '_sd'}))
    _check = _sums.merge(_both, on=['match_id', 'map_index', 'player'], how='inner')
    _check['_ok'] = (_check['_sk'] == _check['_bk']) & (_check['_sd'] == _check['_bd'])
    _before = len(mps_sides)
    mps_sides = mps_sides.merge(
        _check[['match_id', 'map_index', 'player', '_ok']],
        on=['match_id', 'map_index', 'player'], how='left'
    )
    mps_sides = mps_sides[mps_sides['_ok'].fillna(False)].drop(columns=['_ok'])
    print(f"side rows: kept {len(mps_sides)}/{_before} "
          f"(dropped {_before - len(mps_sides)} non-partitioning t/ct rows)")

    side_buckets = []
    for (player, event_id, week, day, side), g in mps_sides.groupby(
            ['player', 'event_id', 'stage', 'date', 'side'], dropna=True):
        r_sum, r_rnd = wsum(g, 'rating')
        k_sum, k_rnd = wsum(g, 'kast')
        a_sum, a_rnd = wsum(g, 'adr')
        h_sum, h_rnd = wsum(g, 'hs_pct')
        acs_valid = g['acs'].dropna()
        side_buckets.append({
            "p": player, "e": int(event_id), "w": week, "d": day, "s": side,
            "maps": int(len(g)), "rnd": int(g['rounds_total'].fillna(0).sum()),
            "ratS": round(r_sum, 3), "ratR": r_rnd,
            "acsS": round(float(acs_valid.sum()), 2), "acsM": int(len(acs_valid)),
            "kastS": round(k_sum, 4), "kastR": k_rnd,
            "adrS": round(a_sum, 3), "adrR": a_rnd,
            "hsS": round(h_sum, 4), "hsR": h_rnd,
            "k": int(g['kills'].fillna(0).sum()), "d": int(g['deaths'].fillna(0).sum()),
            "a": int(g['assists'].fillna(0).sum()),
            "fk": int(g['first_kills'].fillna(0).sum()), "fd": int(g['first_deaths'].fillna(0).sum()),
        })

    with open(f"{OUT}/player_sides.json", "w") as f:
        json.dump({"events": events_lookup, "buckets": side_buckets}, f, separators=(',', ':'))
    print(f"player_sides.json: {len(side_buckets)} buckets")

    # --- per-agent player buckets ---
    # Same (player, event, week, day) key as player_buckets but split by
    # agent, so "best Jett players" is filterable exactly like every other
    # view. Carries the same headline stats as player_buckets (KAST/ADR/
    # HS%/assists/first kills/first deaths, on top of rating/ACS/kills/
    # deaths) -- a player plays exactly one agent per map, so every one of
    # map_player_stats' per-map columns is already "per agent" at the
    # source; there's no aggregation ambiguity in exposing them here too.
    # Multi-kills/clutches/economy/plants/defuses are deliberately left out
    # -- nothing on the site currently breaks those out by agent, and they
    # can be added the same way (via wsum/fillna(0).sum()) if that changes.
    agent_buckets = []
    for (player, agent, event_id, week, day), g in mps_ctx.dropna(subset=['agent']).groupby(
            ['player', 'agent', 'event_id', 'stage', 'date'], dropna=True):
        r_sum, r_rnd = wsum(g, 'rating')
        k_sum, k_rnd = wsum(g, 'kast')
        a_sum, a_rnd = wsum(g, 'adr')
        h_sum, h_rnd = wsum(g, 'hs_pct')
        acs_valid = g['acs'].dropna()
        agent_buckets.append({
            "p": player, "ag": agent, "e": int(event_id), "w": week, "d": day,
            "maps": int(len(g)), "rnd": int(g['rounds_total'].fillna(0).sum()),
            # Maps won on this agent -- keyed "wn" for the same reason as
            # in player_buckets above ("w" is the week string here too).
            "wn": int(g['won'].sum()),
            "ratS": round(r_sum, 3), "ratR": r_rnd,
            "acsS": round(float(acs_valid.sum()), 2), "acsM": int(len(acs_valid)),
            "kastS": round(k_sum, 4), "kastR": k_rnd,
            "adrS": round(a_sum, 3), "adrR": a_rnd,
            "hsS": round(h_sum, 4), "hsR": h_rnd,
            "k": int(g['kills'].fillna(0).sum()), "d_": int(g['deaths'].fillna(0).sum()),
            "a": int(g['assists'].fillna(0).sum()),
            "fk": int(g['first_kills'].fillna(0).sum()), "fd": int(g['first_deaths'].fillna(0).sum()),
        })
    with open(f"{OUT}/player_agents.json", "w") as f:
        json.dump({"events": events_lookup, "meta": player_meta, "buckets": agent_buckets},
                  f, separators=(',', ':'))
    print(f"player_agents.json: {len(agent_buckets)} buckets")

    # --- teams ---
    # A 'partial' match has a real final score (matches.score1/score2) even
    # though its per-player box score never got captured -- that score is
    # trustworthy (captured independently of the box score, before it's even
    # attempted), so match win/loss and match history should count it. Round-
    # level stats derived elsewhere (rnd/atk/def/pistol/etc.) are deliberately
    # NOT widened the same way -- see map_long_completed / team_map_long_completed
    # / the mrr filter below -- since there's no reviewed round-by-round data
    # backing those for a match whose box score was never reviewed.
    # score1/score2 non-null is checked explicitly, not just status: 'partial'
    # matches, unlike 'completed' ones, aren't guaranteed to have a score (the
    # rare case where even the match header failed to parse) -- and an
    # unguarded score1 > score2 comparison elsewhere (line ~778, ~1141) would
    # silently score a NaN-vs-NaN comparison as a loss for both teams rather
    # than skipping the row, which this null check prevents at the source.
    scored_matches = all_matches[
        all_matches['status'].isin(['completed', 'partial'])
        & all_matches['score1'].notna() & all_matches['score2'].notna()
    ]
    team_buckets = []
    map_ctx = am.dropna(subset=['winner']).merge(
        all_matches[['match_id', 'match_date']], on='match_id', how='left'
    )
    mte_ctx = all_mte.merge(
        all_matches[['match_id', 'event_id', 'stage', 'match_date']], on='match_id', how='left'
    )
    mte_ctx['date'] = day_col(mte_ctx['match_date'])
    map_ctx = map_ctx.copy()
    map_ctx['date'] = day_col(map_ctx['match_date'])

    # Attack/defense round splits. A team's *_atk_score is rounds WON while
    # attacking; rounds PLAYED on attack is that plus the opponent's
    # defense wins (every attack round is someone's defense round).
    # Verified against real data: atk+def sums exactly to map score on all
    # 913 regulation maps, 0 mismatches. Overtime rounds are NOT included
    # in these scores, so they're regulation-only by construction -- which
    # is why a map is flagged OT separately rather than inferred from a
    # sum mismatch. OT iff the winner reached 14+ (regulation caps at 13).
    map_ctx['c1_atkW'] = map_ctx['team1_atk_score']
    map_ctx['c1_atkP'] = map_ctx['team1_atk_score'] + map_ctx['team2_def_score']
    map_ctx['c1_defW'] = map_ctx['team1_def_score']
    map_ctx['c1_defP'] = map_ctx['team1_def_score'] + map_ctx['team2_atk_score']
    map_ctx['c2_atkW'] = map_ctx['team2_atk_score']
    map_ctx['c2_atkP'] = map_ctx['team2_atk_score'] + map_ctx['team1_def_score']
    map_ctx['c2_defW'] = map_ctx['team2_def_score']
    map_ctx['c2_defP'] = map_ctx['team2_def_score'] + map_ctx['team1_atk_score']
    map_ctx['is_ot'] = (
        map_ctx[['team1_score', 'team2_score']].max(axis=1) >= 14
    ).astype(int)

    team_rows = []
    for team_col, opp_col in (('c1', 'c2'), ('c2', 'c1')):
        sub = scored_matches[['event_id', 'stage', team_col, 'score1', 'score2', 'match_date']].copy()
        sub.columns = ['event_id', 'week', 'team', 's1', 's2', 'match_date']
        sub['won'] = (sub['s1'] > sub['s2']) if team_col == 'c1' else (sub['s2'] > sub['s1'])
        team_rows.append(sub[['event_id', 'week', 'team', 'won', 'match_date']])
    match_long = pd.concat(team_rows, ignore_index=True)
    match_long['date'] = day_col(match_long['match_date'])

    map_rows = []
    for team_col in ('c1', 'c2'):
        sub = map_ctx[['event_id', 'stage', team_col, 'winner', 'rounds_total',
                       'duration_seconds', 'date', 'is_ot', 'status',
                       f'{team_col}_atkW', f'{team_col}_atkP',
                       f'{team_col}_defW', f'{team_col}_defP']].copy()
        sub.columns = ['event_id', 'week', 'team', 'winner', 'rounds_total',
                       'duration_seconds', 'date', 'is_ot', 'status',
                       'atkW', 'atkP', 'defW', 'defP']
        map_rows.append(sub)
    map_long = pd.concat(map_rows, ignore_index=True)

    mps_team = mps_ctx.copy()
    keys = ['team', 'event_id', 'week']
    agg = {}
    for (team, eid, wk, day), g in match_long.groupby(
            ['team', 'event_id', 'week', 'date'], dropna=True):
        agg[(team, int(eid), wk, day)] = {"mP": int(len(g)), "mW": int(g['won'].sum())}
    for (team, eid, wk, day), g in map_long.groupby(['team', 'event_id', 'week', 'date'], dropna=True):
        d = agg.setdefault((team, int(eid), wk, day), {})
        d["mapP"] = int(len(g))
        d["mapW"] = int((g['winner'] == team).sum())
    # Round/duration/side/OT counts are restricted to 'completed' maps only --
    # a 'partial' match's map score is trustworthy (used for mapP/mapW above),
    # but there's no reviewed round-by-round data backing these more granular
    # stats, so they're deliberately not widened the same way scored_matches
    # was above.
    map_long_completed = map_long[map_long['status'] == 'completed']
    for (team, eid, wk, day), g in map_long_completed.groupby(['team', 'event_id', 'week', 'date'], dropna=True):
        d = agg.setdefault((team, int(eid), wk, day), {})
        d["rnd"] = int(g['rounds_total'].fillna(0).sum())
        # durM is how many of this bucket's maps actually have a known
        # duration (partial coverage -- only re-scraped matches carry it),
        # so downstream averaging divides by durM, not mapP.
        d["durS"] = int(g['duration_seconds'].fillna(0).sum())
        d["durM"] = int(g['duration_seconds'].notna().sum())
        # Attack/defense split. atkP/defP are 0 for maps where VLR didn't
        # publish the per-side breakdown (partial in EWC), so the frontend
        # divides by the stored *P and shows nothing when it's 0.
        for k in ('atkW', 'atkP', 'defW', 'defP'):
            d[k] = int(g[k].fillna(0).sum())
        d["otM"] = int(g['is_ot'].fillna(0).sum())
        d["otW"] = int(((g['winner'] == team) & (g['is_ot'] == 1)).sum())
    for (team, eid, wk, day), g in mte_ctx.groupby(['canonical_team', 'event_id', 'stage', 'date'], dropna=True):
        d = agg.setdefault((team, int(eid), wk, day), {})
        d["pisW"] = int(g['pistol_won'].fillna(0).sum())
        # Buy-type counts live here rather than in a separate economy file:
        # they're per-team-per-map like everything else in this bucket, so
        # folding them in means the Economy view inherits the same facets
        # (region/event/stage/phase/week) with no extra plumbing.
        for short, col in (("eco", "eco"), ("sec", "semi_eco"),
                           ("seb", "semi_buy"), ("fub", "full_buy")):
            rounds = int(g[f'{col}_rounds'].fillna(0).sum())
            won = int(g[f'{col}_won'].fillna(0).sum())
            if rounds or won:
                d[f"{short}R"] = rounds
                d[f"{short}W"] = won
    for (team, eid, wk, day), g in mps_team.groupby(['canonical_team', 'event_id', 'stage', 'date'], dropna=True):
        d = agg.setdefault((team, int(eid), wk, day), {})
        r_sum, r_rnd = wsum(g, 'rating')
        d["ratS"] = round(r_sum, 3)
        d["ratR"] = r_rnd

    # --- round-by-round derived stats ---
    # map_round_results (winner/side/win_condition) is the authoritative
    # per-round outcome source: full match coverage confirmed against real
    # data (row count per map matches the actual final score exactly, 0
    # mismatches), and unlike map_round_economy it is NOT missing China
    # matches (284 China maps covered vs 0 in map_round_economy) -- it
    # comes from a different page element (VLR's compact round-history
    # bar), not the economy tab. map_round_economy (buy types) is joined
    # in on (match_id, map_index, round_num) only for the two stats that
    # actually need buy-type info (anti-eco, pistol conversion); those
    # remain absent for China since that join has nothing to match there,
    # same as before.
    # (match_id, map_index) -> {team: 'atk'|'def'}, the side each team
    # STARTED the map on (round 1's side, before any halftime swap) --
    # derived from round 1's winner + winner_side rather than a separate
    # scraped field (there isn't one): whichever team won round 1 was
    # playing whatever side winner_side says, and since a map only has two
    # teams, the loser was necessarily on the other side. Feeds the Map
    # Stats table's "started ATK"/"started DEF" counts on team profiles.
    start_side = {}
    # (team, event_id, week, date, map) -> {pisP, pisW}, the same key shape
    # tm_agg below uses -- lets the per-map pistol tally merge straight into
    # team_map_buckets after tm_agg is built, no separate join needed. map
    # name isn't on `mrr` itself (it's a map_ctx/maps-table column, and mrr
    # is match_round_results merged with match-level fields only), so it's
    # looked up per (match_id, map_index) from map_ctx rather than re-merged
    # onto every round row.
    map_pistol = {}
    map_name_lookup = {
        (int(r.match_id), int(r.map_index)): r.map_name
        for r in map_ctx[['match_id', 'map_index', 'map_name']].itertuples()
    }
    if len(all_mrr):
        mrr = all_mrr.merge(
            all_matches[['match_id', 'event_id', 'stage', 'match_date', 'c1', 'c2', 'status']],
            on='match_id', how='left'
        )
        mrr['date'] = day_col(mrr['match_date'])
        mrr = mrr.dropna(subset=['c1', 'c2', 'event_id'])
        # Round-level detail (win-condition breakdown, anti-eco/bonus/comeback
        # counts, per-round win curve, pistol tally, starting side) is
        # restricted to 'completed' matches only -- same reasoning as
        # map_long_completed/team_map_long_completed above. This one filter
        # cascades to round_agg, map_pistol, and start_side all at once, since
        # all three are built by iterating grouped mrr rows below.
        mrr = mrr[mrr['status'] == 'completed']
        mrr = mrr.sort_values(['match_id', 'map_index', 'round_num'])
        # `winner` is the RAW scraped team name (never canonicalized at
        # scrape time), but `teams` below is built from c1/c2 (canonical).
        # Without this, any match involving a team with a raw/canonical
        # alias (e.g. "ULF Esports" -> "Eternal Fire") would have every
        # round THAT team won silently fail the `winner in teams` check
        # further down and get dropped from both teams' round counts --
        # confirmed and fixed: exactly 4 such rounds existed, all in one
        # Team Vitality vs ULF Esports match.
        mrr['winner'] = mrr['winner'].map(name_to_canon).fillna(mrr['winner'])

        # (match_id, map_index, round_num) -> (team1_buy_type, team2_buy_type),
        # left as None/None when missing rather than coerced to '' -- an
        # empty string is itself a meaningful signal (confirmed: pistol
        # rounds 1 and 13 are the only ones where BOTH teams show '', in
        # exactly 769/769 maps each; OT rounds do NOT reset to this, both
        # teams get a real buy), so it must stay distinguishable from
        # "no economy data for this round at all".
        buy_lookup = {
            (int(r.match_id), int(r.map_index), int(r.round_num)): (r.team1_buy_type, r.team2_buy_type)
            for r in all_mre.itertuples()
        }

        ECO_BUYS = ('', '$')
        REG_ROUNDS = 24  # regulation length; anything beyond is OT
        round_agg = {}

        def bump(key, field, n=1):
            round_agg.setdefault(key, {})
            round_agg[key][field] = round_agg[key].get(field, 0) + n

        for (mid, midx), grp in mrr.groupby(['match_id', 'map_index'], sort=False):
            first = grp.iloc[0]
            base = (int(first['event_id']), first['stage'], first['date'])
            teams = [first['c1'], first['c2']]
            map_name = map_name_lookup.get((int(mid), int(midx)))

            round1 = grp[grp['round_num'] == 1]
            if len(round1) and round1.iloc[0]['winner'] in teams and round1.iloc[0]['winner_side'] in ('t', 'ct'):
                r1 = round1.iloc[0]
                w_side = 'atk' if r1['winner_side'] == 't' else 'def'
                other = teams[1] if r1['winner'] == teams[0] else teams[0]
                start_side[(int(mid), int(midx))] = {
                    r1['winner']: w_side, other: ('def' if w_side == 'atk' else 'atk'),
                }
            score = {teams[0]: 0, teams[1]: 0}
            max_deficit = {teams[0]: 0, teams[1]: 0}
            pistol_winner = None
            # Team that won BOTH the pistol round (1/13) AND the round
            # right after it (2/14) -- i.e. still on the economic upswing
            # for a second round in a row. Set below, mirroring how
            # pistol_winner is set on round 1/13.
            bonus_winner = None

            for row in grp.itertuples():
                rn = int(row.round_num)
                winner = row.winner
                if winner not in teams:
                    continue  # defensive: shouldn't happen, but never misattribute a round

                buy_t1, buy_t2 = buy_lookup.get((int(mid), int(midx), rn), (None, None))
                buys = {teams[0]: buy_t1, teams[1]: buy_t2}

                for team in teams:
                    key = (team, *base)
                    opp = teams[1] if team == teams[0] else teams[0]
                    won = (team == winner)

                    # Round-number win curve: 24 regulation slots + 1 OT
                    # catch-all (index 24). OT length varies map to map,
                    # so per-OT-round alignment isn't meaningful the way
                    # per-regulation-round is -- lumping it into one
                    # bucket is more honest than pretending round 26 of
                    # one map lines up with round 26 of another.
                    slot = round_agg.setdefault(key, {})
                    if 'rnP' not in slot:
                        slot['rnP'] = [0] * (REG_ROUNDS + 1)
                        slot['rnW'] = [0] * (REG_ROUNDS + 1)
                    idx = min(rn, REG_ROUNDS + 1) - 1
                    slot['rnP'][idx] += 1
                    if won:
                        slot['rnW'][idx] += 1

                    # Win-condition breakdown (elim/defuse/boom/time),
                    # counted for the round's winner only.
                    if won and row.win_condition:
                        bump(key, f'wc_{row.win_condition}')

                    # Anti-eco (economy-based): we're on eco/semi-eco,
                    # they're full-buy. `in`/`==` against None is always
                    # False, so a round with no economy data on either
                    # side naturally never triggers this -- no separate
                    # None-check needed. This is a DIFFERENT stat from
                    # the position-based ae2R/ae2W below -- this one is
                    # about actual loadout value, that one is about round
                    # position relative to the pistol. Both are
                    # legitimately called "anti-eco" under different
                    # definitions; kept as separate fields (aeR/aeW vs.
                    # ae2R/ae2W) rather than merged, since they answer
                    # different questions and have different China
                    # availability (this one needs the economy tab, that
                    # one doesn't).
                    if buys[team] in ECO_BUYS and buys[opp] == '$$$':
                        bump(key, 'aeR')
                        if won:
                            bump(key, 'aeW')

                    # Anti-eco (position-based): round 2/14, contingent on
                    # having won the preceding pistol. The pistol winner
                    # is usually still on a stronger buy than an opponent
                    # forced onto an eco/semi-buy after losing the
                    # pistol, so this measures whether that positional
                    # advantage got converted. Renamed from bonusR/bonusW
                    # -- that name now refers to the round after THIS one
                    # (see below), not this one.
                    if rn in (2, 14) and pistol_winner == team:
                        bump(key, 'ae2R')
                        if won:
                            bump(key, 'ae2W')

                    # Bonus round: round 3/15, contingent on having won
                    # BOTH the pistol AND the anti-eco round right after
                    # it -- the round with the biggest economic edge of
                    # the half, two full buys deep against an opponent
                    # still recovering from the pistol loss.
                    if rn in (3, 15) and bonus_winner == team:
                        bump(key, 'bonusR')
                        if won:
                            bump(key, 'bonusW')

                score[winner] += 1
                for team in teams:
                    opp = teams[1] if team == teams[0] else teams[0]
                    deficit = score[opp] - score[team]
                    if deficit > max_deficit[team]:
                        max_deficit[team] = deficit
                if rn in (1, 13):
                    pistol_winner = winner
                    # Per-map pistol win% (Map Stats table): both teams
                    # play every pistol round, so pisP bumps for both,
                    # pisW only for whichever team won it.
                    if map_name is not None:
                        for team in teams:
                            mp = map_pistol.setdefault(
                                (team, *base, map_name), {"pisP": 0, "pisW": 0}
                            )
                            mp["pisP"] += 1
                            if team == winner:
                                mp["pisW"] += 1
                if rn in (2, 14):
                    bonus_winner = winner if winner == pistol_winner else None

            # Comeback: faced a 3+ round deficit at some point across the
            # ENTIRE map (not just a first-half proxy, now that full round
            # data exists) and still won it. Tracked per team independently
            # -- comebackWon/comebackMaps gives a comeback SUCCESS RATE,
            # not just a count of the eventual winner's own history.
            final_winner = teams[0] if score[teams[0]] > score[teams[1]] else teams[1]
            for team in teams:
                if max_deficit[team] >= 3:
                    bump((team, *base), 'cbN')
                    if final_winner == team:
                        bump((team, *base), 'cbW')

        for (team, eid, wk, day), fields in round_agg.items():
            canon = name_to_canon.get(team, team)
            d = agg.setdefault((canon, int(eid), wk, day), {})
            for f, v in fields.items():
                if isinstance(v, list):
                    prev = d.get(f)
                    d[f] = v if prev is None else [a + b for a, b in zip(prev, v)]
                else:
                    d[f] = d.get(f, 0) + v

    for (team, eid, wk, day), d in agg.items():
        if team == 'TBD':
            continue
        team_buckets.append({"t": team, "e": eid, "w": wk, "d": day, **d})

    team_meta = {t['team']: {"region": t['region']} for t in teams_out}
    with open(f"{OUT}/team_buckets.json", "w") as f:
        json.dump({"events": events_lookup, "meta": team_meta, "buckets": team_buckets},
                  f, separators=(',', ':'))
    print(f"team_buckets.json: {len(team_buckets)} buckets")

    # --- per-map team stats (Map Stats table on team profile pages) ---
    # Same bucket shape/grain as team_buckets (one row per team per event
    # per week per calendar day), with map name as an extra dimension --
    # lets a team profile answer "how does this team specifically perform
    # on Ascent/Bind/etc" client-side, the same sum-then-divide way every
    # other bucket file works, rather than fetching every one of a team's
    # individual match files just to re-derive this in the browser.
    DEFAULT_TM = {"mapP": 0, "mapW": 0, "rndW": 0, "rndL": 0,
                  "atkW": 0, "atkP": 0, "defW": 0, "defP": 0,
                  "otM": 0, "otW": 0, "atkStart": 0, "defStart": 0}

    team_map_rows = []
    for team_col in ('c1', 'c2'):
        score_col = 'team1_score' if team_col == 'c1' else 'team2_score'
        opp_score_col = 'team2_score' if team_col == 'c1' else 'team1_score'
        sub = map_ctx[['match_id', 'map_index', 'event_id', 'stage', team_col, 'map_name',
                       'winner', score_col, opp_score_col, 'date', 'is_ot', 'status',
                       f'{team_col}_atkW', f'{team_col}_atkP',
                       f'{team_col}_defW', f'{team_col}_defP']].copy()
        sub.columns = ['match_id', 'map_index', 'event_id', 'week', 'team', 'map',
                       'winner', 'roundsWon', 'roundsLost', 'date', 'is_ot', 'status',
                       'atkW', 'atkP', 'defW', 'defP']
        team_map_rows.append(sub)
    team_map_long = pd.concat(team_map_rows, ignore_index=True).dropna(subset=['map'])

    tm_agg = {}
    for row in team_map_long.itertuples():
        key = (row.team, int(row.event_id), row.week, row.date, row.map)
        d = tm_agg.setdefault(key, dict(DEFAULT_TM))
        d["mapP"] += 1
        if row.winner == row.team:
            d["mapW"] += 1

    # Round W/L, ATK/DEF split, OT, and starting side are restricted to
    # 'completed' maps only -- same reasoning as map_long_completed above:
    # mapP/mapW just needs a trustworthy map score (already true for
    # 'partial'), but these more granular stats need reviewed round-by-round
    # data that a 'partial' match's box score never produced.
    team_map_long_completed = team_map_long[team_map_long['status'] == 'completed']
    for row in team_map_long_completed.itertuples():
        key = (row.team, int(row.event_id), row.week, row.date, row.map)
        d = tm_agg.setdefault(key, dict(DEFAULT_TM))
        won = row.winner == row.team
        d["rndW"] += int(row.roundsWon) if pd.notna(row.roundsWon) else 0
        d["rndL"] += int(row.roundsLost) if pd.notna(row.roundsLost) else 0
        for k in ('atkW', 'atkP', 'defW', 'defP'):
            v = getattr(row, k)
            d[k] += int(v) if pd.notna(v) else 0
        if row.is_ot:
            d["otM"] += 1
            if won:
                d["otW"] += 1
        side = start_side.get((int(row.match_id), int(row.map_index)), {}).get(row.team)
        if side == 'atk':
            d["atkStart"] += 1
        elif side == 'def':
            d["defStart"] += 1

    # Merge in the per-map pistol tally computed alongside start_side above
    # -- same (team, event_id, week, date, map) key tm_agg itself uses, so
    # this is a plain dict merge rather than a separate join. (map_pistol
    # itself is already restricted to 'completed' matches -- see the mrr
    # filter above where it's built.)
    for key, mp in map_pistol.items():
        d = tm_agg.setdefault(key, dict(DEFAULT_TM))
        d["pisP"] = d.get("pisP", 0) + mp["pisP"]
        d["pisW"] = d.get("pisW", 0) + mp["pisW"]

    team_map_buckets = []
    for (team, eid, wk, day, mapname), d in tm_agg.items():
        if team == 'TBD':
            continue
        team_map_buckets.append({"t": team, "e": eid, "w": wk, "d": day, "m": mapname, **d})

    with open(f"{OUT}/team_map_buckets.json", "w") as f:
        json.dump({"events": events_lookup, "buckets": team_map_buckets}, f, separators=(',', ':'))
    print(f"team_map_buckets.json: {len(team_map_buckets)} buckets")

    # --- match + map results ---
    # One row per completed match, with its maps nested. Powers
    # head-to-head records, biggest upsets and biggest blowouts, none of
    # which fit the per-entity bucket model (they're about a specific
    # pairing, not one team's aggregate).
    #
    # `strength` is each team's own overall match win rate across all data
    # present, used purely as an upset proxy -- there's no seeding or
    # ranking in the scrape, so an "upset" here means a team with a much
    # worse season record beat one with a better record. Documented on the
    # page itself so it isn't mistaken for a real ranking upset.
    team_record = {}
    for row in scored_matches.itertuples():
        for t, won in ((row.c1, row.score1 > row.score2), (row.c2, row.score2 > row.score1)):
            rec = team_record.setdefault(t, [0, 0])
            rec[0] += 1
            rec[1] += int(bool(won))
    strength = {t: (w / p) for t, (p, w) in team_record.items() if p >= 3}

    maps_by_match = {}
    for row in map_ctx.itertuples():
        maps_by_match.setdefault(int(row.match_id), []).append({
            "map": row.map_name,
            "s1": int(row.team1_score) if pd.notna(row.team1_score) else None,
            "s2": int(row.team2_score) if pd.notna(row.team2_score) else None,
            "ot": int(row.is_ot),
        })

    # Top individual scorer per series (total kills across every map of
    # that match for one player) -- powers the kill-record cards on the
    # Records page. all_mps is already side=='both'-filtered (see the
    # comment where it's built), so this isn't at risk of the double/
    # triple-count bug that filter exists to prevent. Grouped by
    # canonical_team too (not just player) since a player's raw `team`
    # string should already be consistent within one player across one
    # match, but canonical_team is what TeamLogo/team_buckets expect for
    # display -- keeping it means the frontend doesn't need its own
    # name_to_canon lookup just for this one field.
    player_kills_by_match = (
        all_mps.groupby(['match_id', 'player', 'canonical_team'])['kills']
        .sum()
        .reset_index()
    )
    top_scorer_by_match = {}
    if not player_kills_by_match.empty:
        top_idx = player_kills_by_match.groupby('match_id')['kills'].idxmax()
        for r in player_kills_by_match.loc[top_idx].itertuples():
            top_scorer_by_match[int(r.match_id)] = (r.player, r.canonical_team, int(r.kills))

    match_rows = []
    for row in scored_matches.itertuples():
        if row.c1 == 'TBD' or row.c2 == 'TBD':
            continue
        s1 = int(row.score1) if pd.notna(row.score1) else None
        s2 = int(row.score2) if pd.notna(row.score2) else None
        if s1 is None or s2 is None:
            continue
        top = top_scorer_by_match.get(int(row.match_id))
        match_rows.append({
            "id": int(row.match_id),
            "team1": row.c1, "team2": row.c2,
            "s1": s1, "s2": s2,
            "e": int(row.event_id) if pd.notna(row.event_id) else None,
            "w": row.stage if pd.notna(row.stage) else '',
            "date": (row.match_date[:10] if isinstance(row.match_date, str) else None),
            "str1": round(strength[row.c1], 4) if row.c1 in strength else None,
            "str2": round(strength[row.c2], 4) if row.c2 in strength else None,
            "maps": maps_by_match.get(int(row.match_id), []),
            "topKiller": top[0] if top else None,
            "topKillerTeam": top[1] if top else None,
            "topKills": top[2] if top else None,
        })

    with open(f"{OUT}/match_results.json", "w") as f:
        json.dump({"events": events_lookup, "rows": match_rows}, f, separators=(',', ':'))
    print(f"match_results.json: {len(match_rows)} matches")


    # --- per-match player scoreboards (match_players.json) ---
    # One row per (match, player): the box score VLR shows on a match
    # page, aggregated across every map of that series.
    #
    # Unlike every bucket file, these are FINAL computed values, not
    # (value x rounds) sums. A single match is the smallest unit this data
    # is ever viewed at -- there's no filter combination for the client to
    # re-aggregate over -- so storing sums would cost bytes for an
    # arithmetic step nothing performs. Rounds-weighting for Rating/KAST/
    # ADR/HS% and the flat per-map mean for ACS follow the same
    # VLR-verified convention as player_stats() above.
    #
    # Restricted to the same match set as match_results.json (completed,
    # both teams known, both scores present) so the scoreboard file can
    # never contain a match the match list doesn't.
    scoreboard_match_ids = {r["id"] for r in match_rows}

    # Precision is deliberately capped at what the UI actually renders
    # (Rating 2dp, ACS/K/D/A integer, KAST/HS% 3dp -> 0.1pp, ADR 1dp)
    # rather than pandas' full float. These are terminal display values,
    # not inputs to any further client-side arithmetic, so extra digits are
    # pure file size -- worth ~7% here across 5k rows.
    def scoreboard_stats(g, with_totals=True):
        def w(col, nd):
            s, r = wsum(g, col)
            return round(s / r, nd) if r else None
        acs_valid = g['acs'].dropna()
        out = {
            "r": w('rating', 2),
            "acs": round(float(acs_valid.mean())) if len(acs_valid) else None,
            "k": int(g['kills'].fillna(0).sum()),
            "d": int(g['deaths'].fillna(0).sum()),
            "a": int(g['assists'].fillna(0).sum()),
            "kast": w('kast', 3),
            "adr": w('adr', 1),
            "hs": w('hs_pct', 3),
            "fk": int(g['first_kills'].fillna(0).sum()),
            "fd": int(g['first_deaths'].fillna(0).sum()),
        }
        if with_totals:
            out["mp"] = int(len(g))
            out["rnd"] = int(g['rounds_total'].fillna(0).sum())
        return out

    # Attack/defense split, mirroring VLR's own All/Attack/Defend toggle on
    # a match page. Same caveat as player_sides.json: `rounds_total` is the
    # whole map's round count for both the 't' and 'ct' rows, so a
    # multi-map series weights each map equally across sides rather than by
    # rounds actually played on that side. Within a single match that only
    # affects how maps are weighted against each other, not the numbers
    # themselves, which is why the simpler shared denominator is kept here.
    side_scoreboards = {}
    for (match_id, player, side), g in mps_sides.groupby(
            ['match_id', 'player', 'side'], dropna=True):
        if int(match_id) not in scoreboard_match_ids:
            continue
        side_scoreboards[(int(match_id), player, side)] = scoreboard_stats(g, with_totals=False)

    match_player_rows = []
    for (match_id, player), g in mps_ctx.groupby(['match_id', 'player'], dropna=True):
        match_id = int(match_id)
        if match_id not in scoreboard_match_ids:
            continue
        g = g.sort_values('map_index')
        row = {
            "m": match_id,
            "p": player,
            "t": g['canonical_team'].iloc[0],
            # One agent per map, in map order -- a player plays exactly one
            # agent per map, so this doubles as the per-map agent list the
            # scoreboard renders next to the player's name.
            "ag": [a for a in g['agent'].tolist() if isinstance(a, str)],
            **scoreboard_stats(g),
        }
        for side, key in (('t', 'atk'), ('ct', 'def')):
            s = side_scoreboards.get((match_id, player, side))
            if s is not None:
                row[key] = s
        match_player_rows.append(row)

    # Nationality only -- just enough for the scoreboard to render a flag
    # next to each name. Deliberately NOT the full player_meta block the
    # bucket files carry: team comes from each row's own `t` (correct for
    # mid-season transfers, unlike a single global meta.team), and
    # region/isChina aren't shown on a scoreboard. Keeping this trimmed is
    # what lets the Tournaments page render scoreboards without pulling in
    # player_buckets.json purely for flags.
    scoreboard_meta = {
        p: {"cc": m["countryCode"], "cn": m["countryName"]}
        for p, m in player_meta.items()
        if m.get("countryCode")
    }

    with open(f"{OUT}/match_players.json", "w") as f:
        json.dump({"meta": scoreboard_meta, "rows": match_player_rows},
                  f, separators=(',', ':'))
    print(f"match_players.json: {len(match_player_rows)} player-match rows, "
          f"{len(scoreboard_meta)} with nationality")


    # --- per-match detail files: REMOVED ---
    # This used to write matches/{id}.json, one file per match (525 files,
    # 9.5MB -- 45% of all site data) to back a local /matches/:id page with
    # per-map scoreboards, round-by-round results and buy-type economy.
    #
    # That page is gone: match links now point at vlr.gg, which is where
    # this data was scraped from and which serves it live plus VODs,
    # pick/ban and comments. Regenerating these files would put 9.5MB back
    # into the deploy for a view nothing renders, so the block was deleted
    # rather than left behind a flag.
    #
    # match_players.json (written just above) is unaffected and still the
    # index every match-history list reads -- the series-level rows it
    # carries were always the source these files duplicated.
    #
    # Recovering the per-match view means restoring this block from git
    # history (it built off mps_ctx / mps_sides / all_mrr / all_mte / am,
    # all of which are still loaded above for other exports).


    # --- series (match-level duration leaderboard) ---
    # One row per completed match. A series' total duration is the sum of
    # its maps' durations, but only counted when *every* map in that match
    # has a scraped duration -- a partial sum (e.g. 2 of 3 maps timed)
    # would understate the real length and could wrongly surface as a
    # "shortest series". fullyTimed marks which rows are safe to rank;
    # the frontend only ranks those, though partial rows are still kept
    # in the file in case that's useful later.
    series_rows = []
    for match_id, g in map_ctx.groupby('match_id'):
        row0 = g.iloc[0]
        map_count = len(g)
        maps_timed = int(g['duration_seconds'].notna().sum())
        if maps_timed == 0:
            continue
        d0 = first_day(g)
        series_rows.append({
            "id": int(match_id),
            "team1": row0['c1'],
            "team2": row0['c2'],
            "date": d0,
            "e": int(row0['event_id']) if pd.notna(row0['event_id']) else None,
            "w": row0['stage'] if pd.notna(row0['stage']) else '',
            "mapCount": map_count,
            "mapsTimed": maps_timed,
            "fullyTimed": maps_timed == map_count,
            "durationSeconds": int(g['duration_seconds'].fillna(0).sum()),
        })

    with open(f"{OUT}/series_length.json", "w") as f:
        json.dump({"events": events_lookup, "rows": series_rows}, f, separators=(',', ':'))
    fully = sum(1 for r in series_rows if r['fullyTimed'])
    print(f"series_length.json: {len(series_rows)} matches with a timed map ({fully} fully timed)")

    # --- individual map durations (for the "map" view of the same panel) ---
    # One row per map that actually has a scraped duration -- this is the
    # atomic version of the series rows above, letting the frontend toggle
    # between "longest/shortest series" (whole match) and "longest/
    # shortest map" (a single map within some match).
    map_length_rows = []
    for row in map_ctx.dropna(subset=['duration_seconds']).itertuples():
        map_length_rows.append({
            "id": f"{int(row.match_id)}-{int(row.map_index)}",
            "team1": row.c1,
            "team2": row.c2,
            "mapName": row.map_name,
            "date": (row.match_date[:10] if isinstance(row.match_date, str) else None),
            "e": int(row.event_id) if pd.notna(row.event_id) else None,
            "w": row.stage if pd.notna(row.stage) else '',
            "durationSeconds": int(row.duration_seconds),
        })

    with open(f"{OUT}/map_length.json", "w") as f:
        json.dump({"events": events_lookup, "rows": map_length_rows}, f, separators=(',', ':'))
    print(f"map_length.json: {len(map_length_rows)} timed maps")

    events_out = [clean_row(r) for r in events_vct.to_dict(orient='records')]
    with open(f"{OUT}/events.json", "w") as f:
        json.dump(events_out, f, indent=2)
    print("events.json written")

    # ------------------------------------------------------------------
    # agents.json — pick rates and map win% computed directly from
    # map_player_stats + maps + matches, rather than VLR's own
    # /event/agents/ aggregate page. This is deliberately NOT the
    # event_map_summary / event_map_agent_utilization tables: those are
    # scraped as one aggregate per whole event with no way to filter by
    # phase (Group Stage / Playoffs / etc). Every player's agent pick is
    # already recorded per map in map_player_stats, and matches.stage has
    # real per-match phase text ("Group Stage: Week 2", "Playoffs: Upper
    # Quarterfinals") -- combining these gives full Region -> Stage ->
    # Phase filterability for free, computed from data already scraped.
    #
    # Includes both VCT and EWC; 'competition' is carried through as a
    # facet so the site can scope to either (or both) on demand rather
    # than the data being pre-scoped to one of them.
    # ------------------------------------------------------------------
    matches_tagged = matches.merge(
        events[['event_id', 'stage', 'name', 'region']].rename(
            columns={'stage': 'event_stage', 'name': 'event_name',
                     'region': 'event_region'}),
        on='event_id', how='left'
    )
    matches_tagged['phase'] = matches_tagged['stage'].str.split(':').str[0].str.strip()

    # Per-player-per-map rows, tagged with region/event-stage/phase/map name.
    # Note: mps already has a 'region' column merged in earlier in this
    # script (for players.json) -- only bring in event_stage/phase here to
    # avoid a duplicate-column collision that silently suffixes both to
    # region_x/region_y instead of a single clean 'region' column.
    players_long = mps.merge(
        matches_tagged[['match_id', 'event_stage', 'event_name', 'event_region', 'phase', 'stage']], on='match_id', how='left'
    )
    maps_named = maps_df.merge(
        matches_tagged[['match_id', 'event_stage', 'event_name', 'event_region', 'phase', 'stage', 'status']], on='match_id', how='left'
    )
    players_long = players_long.merge(
        maps_named[['match_id', 'map_index', 'map_name']], on=['match_id', 'map_index'], how='left'
    )

    # Per-map rows (one per map, not per player) for ATK/DEF win rates --
    # derived the same way VLR itself defines it: team1_atk_score +
    # team2_atk_score = rounds won by whichever side was attacking that
    # round, regardless of which named team, divided by total rounds.
    maps_long = maps_named.dropna(subset=['winner']).copy()
    maps_long['atk_win_rounds'] = maps_long['team1_atk_score'].fillna(0) + maps_long['team2_atk_score'].fillna(0)
    maps_long['def_win_rounds'] = maps_long['team1_def_score'].fillna(0) + maps_long['team2_def_score'].fillna(0)
    # Round counts (rounds/atkWinRounds/defWinRounds) are restricted to
    # 'completed' matches only -- same reasoning as team_buckets'
    # map_long_completed above. maps_long itself stays unfiltered so a map
    # doesn't disappear from mapNames (the dropdown/matrix list) just because
    # its only coverage in some scope happens to be partial-only.
    maps_long_completed = maps_long[maps_long['status'] == 'completed']

    # Raw, granular buckets -- one per (region, event, stage, phase, week)
    # combination -- carrying counts, not pre-computed percentages. The
    # site sums these client-side for whatever filter combination is
    # active, which is what makes the 4th tier (week/round) a genuine
    # multi-select: pre-computing every possible subset of weeks up front
    # would blow up combinatorially, but summing raw counts on demand
    # handles any combination for free.
    buckets = []
    # 'year' is redundant with event_name for grouping purposes (VLR's own
    # event names already carry the season, e.g. "Vct 2025 Americas Kickoff"
    # vs "Vct 2026 Americas Kickoff" -- see load_db()), but it's included
    # explicitly anyway so the exported bucket carries a `year` field the
    # Agents page can filter on directly, the same way it already filters
    # directly on `region`/`competition`/`event` (this page uses the raw
    # bucket fields, not the events-lookup-derived eventFields() every other
    # bucket file goes through).
    group_cols = ['competition', 'year', 'event_region', 'event_name', 'event_stage', 'phase', 'stage']
    for (competition, year, region, event_name, event_stage, phase, week), g in players_long.groupby(group_cols, dropna=True):
        agent_counts = g['agent'].value_counts().to_dict()
        map_g = maps_long_completed[
            (maps_long_completed.event_region == region) & (maps_long_completed.event_name == event_name) &
            (maps_long_completed.event_stage == event_stage) &
            (maps_long_completed.phase == phase) & (maps_long_completed.stage == week)
        ]
        map_stats = {}
        for map_name, mg in map_g.groupby('map_name'):
            map_stats[map_name] = {
                "rounds": int(mg['rounds_total'].sum()),
                "atkWinRounds": int(mg['atk_win_rounds'].sum()),
                "defWinRounds": int(mg['def_win_rounds'].sum()),
            }
        # Per-map agent breakdown too (not just per-bucket totals) -- needed
        # for the map x agent matrix, which cross-references both dimensions
        # at once.
        map_agent_counts = {}
        for map_name, mg in g.groupby('map_name'):
            if pd.isna(map_name):
                continue
            map_agent_counts[map_name] = {k: int(v) for k, v in mg['agent'].value_counts().items()}

        buckets.append({
            "competition": competition, "year": int(year),
            "region": region, "event": event_name, "stage": event_stage,
            "phase": phase, "week": week,
            "playerRows": int(len(g)),
            "agentCounts": {k: int(v) for k, v in agent_counts.items()},
            "mapStats": map_stats,
            "mapAgentCounts": map_agent_counts,
        })

    # Faceted filtering replaces the old nested Region->Stage->Phase->Week
    # cascade: every dimension is independent and multi-selectable, and the
    # site derives which options are still reachable directly from the
    # buckets. That means no pre-computed nested lookup tables are needed
    # here at all -- and it fixes a real gap in the old model, where
    # Masters Santiago and Masters London were indistinguishable (both are
    # region=International + stage=Masters).
    agents_out = {
        "buckets": buckets,
        "mapNames": sorted(maps_long['map_name'].dropna().unique().tolist()),
        "facets": ["competition", "year", "region", "event", "stage", "phase", "week"],
    }

    with open(f"{OUT}/agents.json", "w") as f:
        json.dump(agents_out, f, indent=2)
    print(f"agents.json written: {len(buckets)} buckets, "
          f"{len(agents_out['mapNames'])} maps, "
          f"{len(set(b['event'] for b in buckets))} events")


if __name__ == "__main__":
    import os
    os.makedirs(OUT, exist_ok=True)
    main()
