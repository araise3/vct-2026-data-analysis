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

DB_PATH = "/mnt/user-data/uploads/vlr_vct_2026.db"
EWC_DB_PATH = "/mnt/user-data/uploads/vlr_ewc_2026.db"
OUT = "/home/claude/vct-site/public/data"

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


def load_db(path, competition):
    conn = sqlite3.connect(path)
    tables = {}
    for name in ["matches", "maps", "map_player_stats", "map_team_economy", "events"]:
        df = pd.read_sql_query(f"SELECT * FROM {name}", conn)
        df["competition"] = competition
        tables[name] = df
    conn.close()
    return tables


def main():
    vct = load_db(DB_PATH, "VCT")
    ewc = load_db(EWC_DB_PATH, "EWC")

    # Combined universe: every downstream computation runs on this, then
    # gets filtered back down to competition=='VCT' for the default
    # (today's) output, or left unfiltered for the "+EWC" variant. This
    # keeps the two code paths identical except for which rows are in
    # scope, rather than maintaining two separate pipelines.
    matches = pd.concat([vct["matches"], ewc["matches"]], ignore_index=True)
    maps_df = pd.concat([vct["maps"], ewc["maps"]], ignore_index=True)
    mps = pd.concat([vct["map_player_stats"], ewc["map_player_stats"]], ignore_index=True)
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
        [load_nationality(DB_PATH), load_nationality(EWC_DB_PATH)], ignore_index=True
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

    players_first = mps_vct.sort_values(['match_id', 'map_index'])[['player', 'canonical_team']] \
        .drop_duplicates(subset='player', keep='first')

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
    all_mps = pd.concat([vct["map_player_stats"], ewc["map_player_stats"]], ignore_index=True)
    all_mte = pd.concat([vct["map_team_economy"], ewc["map_team_economy"]], ignore_index=True)
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
            "competition": r['competition'],
        }

    am = all_maps.merge(
        all_matches[['match_id', 'event_id', 'stage', 'c1', 'c2', 'status']],
        on='match_id', how='left', suffixes=('', '_m')
    )
    am['rounds_total'] = am['team1_score'] + am['team2_score']
    am['winner'] = np.where(am.team1_score > am.team2_score, am.c1,
                     np.where(am.team2_score > am.team1_score, am.c2, None))

    mps_ctx = all_mps.merge(
        all_matches[['match_id', 'event_id', 'stage']], on='match_id', how='left'
    ).merge(
        am[['match_id', 'map_index', 'rounds_total']], on=['match_id', 'map_index'], how='left'
    )

    def wsum(g, col):
        """(value x rounds) sum and the rounds behind it, ignoring nulls."""
        valid = g[[col, 'rounds_total']].dropna()
        if len(valid) == 0:
            return 0.0, 0
        return float((valid[col] * valid['rounds_total']).sum()), int(valid['rounds_total'].sum())

    player_buckets = []
    for (player, event_id, week), g in mps_ctx.groupby(['player', 'event_id', 'stage'], dropna=True):
        r_sum, r_rnd = wsum(g, 'rating')
        k_sum, k_rnd = wsum(g, 'kast')
        a_sum, a_rnd = wsum(g, 'adr')
        h_sum, h_rnd = wsum(g, 'hs_pct')
        acs_valid = g['acs'].dropna()
        row = {
            "p": player, "e": int(event_id), "w": week,
            "maps": int(len(g)), "rnd": int(g['rounds_total'].fillna(0).sum()),
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

    # --- teams ---
    completed_all = all_matches[all_matches['status'] == 'completed']
    team_buckets = []
    map_ctx = am.dropna(subset=['winner'])
    mte_ctx = all_mte.merge(
        all_matches[['match_id', 'event_id', 'stage']], on='match_id', how='left'
    )

    team_rows = []
    for team_col, opp_col in (('c1', 'c2'), ('c2', 'c1')):
        sub = completed_all[['event_id', 'stage', team_col, 'score1', 'score2']].copy()
        sub.columns = ['event_id', 'week', 'team', 's1', 's2']
        sub['won'] = (sub['s1'] > sub['s2']) if team_col == 'c1' else (sub['s2'] > sub['s1'])
        team_rows.append(sub[['event_id', 'week', 'team', 'won']])
    match_long = pd.concat(team_rows, ignore_index=True)

    map_rows = []
    for team_col in ('c1', 'c2'):
        sub = map_ctx[['event_id', 'stage', team_col, 'winner', 'rounds_total']].copy()
        sub.columns = ['event_id', 'week', 'team', 'winner', 'rounds_total']
        map_rows.append(sub)
    map_long = pd.concat(map_rows, ignore_index=True)

    mps_team = mps_ctx.copy()
    keys = ['team', 'event_id', 'week']
    agg = {}
    for (team, eid, wk), g in match_long.groupby(['team', 'event_id', 'week'], dropna=True):
        agg[(team, int(eid), wk)] = {"mP": int(len(g)), "mW": int(g['won'].sum())}
    for (team, eid, wk), g in map_long.groupby(['team', 'event_id', 'week'], dropna=True):
        d = agg.setdefault((team, int(eid), wk), {})
        d["mapP"] = int(len(g))
        d["mapW"] = int((g['winner'] == team).sum())
        d["rnd"] = int(g['rounds_total'].fillna(0).sum())
    for (team, eid, wk), g in mte_ctx.groupby(['canonical_team', 'event_id', 'stage'], dropna=True):
        d = agg.setdefault((team, int(eid), wk), {})
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
    for (team, eid, wk), g in mps_team.groupby(['canonical_team', 'event_id', 'stage'], dropna=True):
        d = agg.setdefault((team, int(eid), wk), {})
        r_sum, r_rnd = wsum(g, 'rating')
        d["ratS"] = round(r_sum, 3)
        d["ratR"] = r_rnd

    for (team, eid, wk), d in agg.items():
        if team == 'TBD':
            continue
        team_buckets.append({"t": team, "e": eid, "w": wk, **d})

    team_meta = {t['team']: {"region": t['region']} for t in teams_out}
    with open(f"{OUT}/team_buckets.json", "w") as f:
        json.dump({"events": events_lookup, "meta": team_meta, "buckets": team_buckets},
                  f, separators=(',', ':'))
    print(f"team_buckets.json: {len(team_buckets)} buckets")

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
        matches_tagged[['match_id', 'event_stage', 'event_name', 'event_region', 'phase', 'stage']], on='match_id', how='left'
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

    # Raw, granular buckets -- one per (region, event, stage, phase, week)
    # combination -- carrying counts, not pre-computed percentages. The
    # site sums these client-side for whatever filter combination is
    # active, which is what makes the 4th tier (week/round) a genuine
    # multi-select: pre-computing every possible subset of weeks up front
    # would blow up combinatorially, but summing raw counts on demand
    # handles any combination for free.
    buckets = []
    group_cols = ['competition', 'event_region', 'event_name', 'event_stage', 'phase', 'stage']
    for (competition, region, event_name, event_stage, phase, week), g in players_long.groupby(group_cols, dropna=True):
        agent_counts = g['agent'].value_counts().to_dict()
        map_g = maps_long[
            (maps_long.event_region == region) & (maps_long.event_name == event_name) &
            (maps_long.event_stage == event_stage) &
            (maps_long.phase == phase) & (maps_long.stage == week)
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
            "competition": competition,
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
        "facets": ["competition", "region", "event", "stage", "phase", "week"],
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
