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
    maps_df_vct = maps_df[maps_df.competition == 'VCT']
    mps_vct = mps[mps.competition == 'VCT']
    mte_vct = mte[mte.competition == 'VCT']

    teams_out = []
    for team in canonical_teams:
        base = team_stats(completed_vct, maps_df_vct, mps_vct, mte_vct, team)
        base["team"] = team
        base["region"] = team_primary_region.get(team, "International")
        base["withEwc"] = team_stats(completed, maps_df, mps, mte, team)
        teams_out.append(base)

    with open(f"{OUT}/teams.json", "w") as f:
        json.dump(teams_out, f, indent=2)
    print(f"teams.json: {len(teams_out)} teams")

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
        sub_all = mps[mps['player'] == player]
        sub = sub_all[sub_all['competition'] == 'VCT']
        stats = player_stats(sub)
        nat = nationality_map.get(player)
        entry = {
            "player": player,
            "team": team,
            "isChina": is_china,
            "hasIntlStats": player in players_with_intl,
            "countryCode": nat['country_code'] if nat and nat['country_code'] != 'un' else None,
            "countryName": nat['country_name'] if nat and nat['country_code'] != 'un' else None,
            "stats": stats,
            "statsWithEwc": player_stats(sub_all),
        }
        if player in players_with_intl:
            intl_sub = sub[sub['region'] == 'International']
            entry["intlStats"] = player_stats(intl_sub)

        # For China players specifically: a variant that excludes any map
        # missing Rating 2.0 entirely (not just averaging around the gap),
        # so every stat in this variant is drawn from the exact same set
        # of maps -- consistent, rather than avgRating quietly covering
        # fewer maps than avgAcs/avgKast/etc. Only meaningfully differs
        # from "stats" for the ~9 China matches missing rating; harmless
        # (identical) for everyone else.
        if is_china:
            rated_sub = sub[sub['rating'].notna()]
            if len(rated_sub) < len(sub):
                entry["ratedOnlyStats"] = player_stats(rated_sub)

        players_out.append(entry)

    with open(f"{OUT}/players.json", "w") as f:
        json.dump(players_out, f, indent=2)
    print(f"players.json: {len(players_out)} players "
          f"({sum(1 for p in players_out if not p['isChina'])} non-China, "
          f"{sum(1 for p in players_out if p['isChina'])} China, "
          f"{sum(1 for p in players_out if p['hasIntlStats'])} with Intl stats)")

    # ------------------------------------------------------------------
    # overview.json
    # ------------------------------------------------------------------
    MIN_MAPS_FOR_RANKING = 10

    def compute_top_lists(player_field, team_field):
        ranked_players = [p for p in players_out if p[player_field]
                           and p[player_field]['mapsPlayed'] >= MIN_MAPS_FOR_RANKING
                           and p[player_field]['avgRating'] is not None]
        top_players = sorted(ranked_players, key=lambda p: p[player_field]['avgRating'], reverse=True)[:10]
        top_players_out = [clean_row({
            "player": p['player'], "team": p['team'],
            "countryCode": p.get('countryCode'), "countryName": p.get('countryName'),
            "rating": p[player_field]['avgRating'], "mapsPlayed": p[player_field]['mapsPlayed']
        }) for p in top_players]

        ranked_teams = [t for t in teams_out if t[team_field]['mapsPlayed'] and t[team_field]['mapsPlayed'] >= 10
                         and t[team_field]['mapWinPct'] is not None]
        top_teams = sorted(ranked_teams, key=lambda t: t[team_field]['mapWinPct'], reverse=True)[:10]
        top_teams_out = [clean_row({
            "team": t['team'], "region": t['region'],
            "mapWinPct": t[team_field]['mapWinPct'],
            "mapsPlayed": t[team_field]['mapsPlayed'], "mapsWon": t[team_field]['mapsWon']
        }) for t in top_teams]
        return top_players_out, top_teams_out

    # For VCT-only, team_field needs to read the team's top-level fields
    # rather than a nested dict -- wrap each team once so both branches can
    # use the same dict-key access pattern uniformly.
    for t in teams_out:
        t['_self'] = {k: v for k, v in t.items() if k not in ('team', 'region', 'withEwc', '_self')}

    top_players_out, top_teams_out = compute_top_lists('stats', '_self')
    top_players_out_ewc, top_teams_out_ewc = compute_top_lists('statsWithEwc', 'withEwc')

    for t in teams_out:
        del t['_self']

    events_vct = events[events.competition == 'VCT']

    overview_out = {
        "kpis": {
            "totalEvents": int(events_vct['event_id'].nunique()),
            "totalMatches": int(len(completed_vct)),
            "totalMaps": int(len(maps_df_vct.dropna(subset=['winner']))),
            "totalRounds": int(maps_df_vct['rounds_total'].sum()),
            "totalPlayers": int(sum(1 for p in players_out if p['stats'])),
            "totalTeams": int(len(canonical_teams)),
        },
        "kpisWithEwc": {
            "totalEvents": int(events['event_id'].nunique()),
            "totalMatches": int(len(completed)),
            "totalMaps": int(len(maps_df.dropna(subset=['winner']))),
            "totalRounds": int(maps_df['rounds_total'].sum()),
            "totalPlayers": int(sum(1 for p in players_out if p['statsWithEwc'])),
            "totalTeams": int(len(canonical_teams)),
        },
        "topPlayersByRating": top_players_out,
        "topTeamsByMapWinPct": top_teams_out,
        "topPlayersByRatingWithEwc": top_players_out_ewc,
        "topTeamsByMapWinPctWithEwc": top_teams_out_ewc,
    }
    with open(f"{OUT}/overview.json", "w") as f:
        json.dump(overview_out, f, indent=2)
    print("overview.json written")

    # ------------------------------------------------------------------
    # economy.json -- deliberately VCT-only for now (EWC toggle isn't
    # wired up here yet; scoped to Players/Teams/Overview for this pass)
    # ------------------------------------------------------------------
    mte_r = mte_vct.merge(matches[['match_id', 'region']], on='match_id', how='left')

    def buy_tier_summary(sub):
        tiers = {
            "eco": (sub['eco_rounds'].sum(), sub['eco_won'].sum()),
            "semiEco": (sub['semi_eco_rounds'].sum(), sub['semi_eco_won'].sum()),
            "semiBuy": (sub['semi_buy_rounds'].sum(), sub['semi_buy_won'].sum()),
            "fullBuy": (sub['full_buy_rounds'].sum(), sub['full_buy_won'].sum()),
        }
        out = {}
        for name, (rounds, won) in tiers.items():
            out[name] = clean_row({"rounds": int(rounds), "won": int(won),
                                    "winPct": (won / rounds) if rounds else None})
        return out

    economy_out = {
        "overall": buy_tier_summary(mte_r),
        "byRegion": {region: buy_tier_summary(sub) for region, sub in mte_r.groupby('region')},
    }
    with open(f"{OUT}/economy.json", "w") as f:
        json.dump(economy_out, f, indent=2)
    print("economy.json written")

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
    # Deliberately VCT-only for now, same as economy.json -- the EWC
    # toggle isn't wired up here yet.
    # ------------------------------------------------------------------
    matches = matches[matches.competition == 'VCT']
    maps_df = maps_df_vct
    mps = mps_vct
    matches_tagged = matches.merge(
        events_vct[['event_id', 'stage']].rename(columns={'stage': 'event_stage'}),
        on='event_id', how='left'
    )
    matches_tagged['phase'] = matches_tagged['stage'].str.split(':').str[0].str.strip()

    # Per-player-per-map rows, tagged with region/event-stage/phase/map name.
    # Note: mps already has a 'region' column merged in earlier in this
    # script (for players.json) -- only bring in event_stage/phase here to
    # avoid a duplicate-column collision that silently suffixes both to
    # region_x/region_y instead of a single clean 'region' column.
    players_long = mps.merge(
        matches_tagged[['match_id', 'event_stage', 'phase', 'stage']], on='match_id', how='left'
    )
    maps_named = maps_df.merge(
        matches_tagged[['match_id', 'region', 'event_stage', 'phase', 'stage']], on='match_id', how='left'
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

    # Cascade options: only stages/phases/weeks that actually exist per
    # region (and per region+stage, etc), not hardcoded -- an "if they
    # exist" filter at every tier.
    region_stages = {
        region: sorted(sub['stage'].dropna().unique().tolist())
        for region, sub in events_vct.groupby('region')
    }
    region_stage_phases = {}
    region_stage_phase_weeks = {}
    for region, sub in matches_tagged.groupby('region'):
        region_stage_phases[region] = {}
        region_stage_phase_weeks[region] = {}
        for stage, sub2 in sub.groupby('event_stage'):
            region_stage_phases[region][stage] = sorted(sub2['phase'].dropna().unique().tolist())
            region_stage_phase_weeks[region][stage] = {}
            for phase, sub3 in sub2.groupby('phase'):
                region_stage_phase_weeks[region][stage][phase] = sorted(sub3['stage'].dropna().unique().tolist())

    # Raw, granular buckets -- one per (region, event_stage, phase, week)
    # combination -- carrying counts, not pre-computed percentages. The
    # site sums these client-side for whatever filter combination is
    # active, which is what makes the 4th tier (week/round) a genuine
    # multi-select: pre-computing every possible subset of weeks up front
    # would blow up combinatorially, but summing raw counts on demand
    # handles any combination for free.
    buckets = []
    group_cols = ['region', 'event_stage', 'phase', 'stage']  # 'stage' here = full week/round text
    for (region, event_stage, phase, week), g in players_long.groupby(group_cols, dropna=True):
        agent_counts = g['agent'].value_counts().to_dict()
        map_g = maps_long[
            (maps_long.region == region) & (maps_long.event_stage == event_stage) &
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
            "region": region, "stage": event_stage, "phase": phase, "week": week,
            "playerRows": int(len(g)),
            "agentCounts": {k: int(v) for k, v in agent_counts.items()},
            "mapStats": map_stats,
            "mapAgentCounts": map_agent_counts,
        })

    agents_out = {
        "buckets": buckets,
        "mapNames": sorted(maps_long['map_name'].dropna().unique().tolist()),
        "regionStages": region_stages,
        "regionStagePhases": region_stage_phases,
        "regionStagePhaseWeeks": region_stage_phase_weeks,
    }

    with open(f"{OUT}/agents.json", "w") as f:
        json.dump(agents_out, f, indent=2)
    print(f"agents.json written: {len(buckets)} buckets, "
          f"{len(agents_out['mapNames'])} maps, "
          f"regions: {list(agents_out['regionStages'].keys())}")


if __name__ == "__main__":
    import os
    os.makedirs(OUT, exist_ok=True)
    main()
