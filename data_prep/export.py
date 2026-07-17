#!/usr/bin/env python3
"""
Computes every JSON file the site needs, mirroring the logic already
verified in the Excel workbook (VCT_2026_data.xlsx). Run once; outputs
land in ../public/data/*.json for Vite to bundle at build time.
"""
import json
import math
import numpy as np
import pandas as pd

RA = "/home/claude/rating_analysis"
OUT = "/home/claude/vct-site/public/data"

CHINA_TEAMS = ['All Gamers', 'Bilibili Gaming', 'Dragon Ranger Gaming', 'EDward Gaming',
               'FunPlus Phoenix', 'JDG Esports', 'Nova Esports', 'TYLOO',
               'Titan Esports Club', 'Trace Esports', 'Wolves Esports', 'Xi Lai Gaming']


def clean_num(v):
    """JSON can't hold NaN — convert to None."""
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


def main():
    matches = pd.read_pickle(f"{RA}/matches.pkl")
    maps_df = pd.read_pickle(f"{RA}/maps.pkl")
    mps = pd.read_pickle(f"{RA}/map_player_stats.pkl")
    mte = pd.read_pickle(f"{RA}/map_team_economy.pkl")
    mre = pd.read_pickle(f"{RA}/map_round_economy.pkl")
    events = pd.read_pickle(f"{RA}/events.pkl")
    lookup = pd.read_pickle(f"{RA}/team_lookup.pkl")

    # NOTE: this particular pickle already has kast/hs_pct converted to
    # fractions (0.73, not "73%") from an earlier processing step — do NOT
    # run pct_to_float on it again here, or it divides by 100 twice
    # (0.73 -> 0.0073). Verified directly against the raw values before
    # skipping this step.

    # Apply the ULF Esports / Eternal Fire merge (confirmed distinct orgs
    # that held the same EMEA slot sequentially, never played each other)
    lookup = lookup.copy()
    lookup.loc[lookup['canonical_name'].isin(['ULF Esports', 'Eternal Fire']),
               'canonical_name'] = 'ULF Esports / Eternal Fire'
    name_to_canon = lookup.set_index('raw_name')['canonical_name'].to_dict()

    matches['c1'] = matches['team1'].map(name_to_canon).fillna(matches['team1'])
    matches['c2'] = matches['team2'].map(name_to_canon).fillna(matches['team2'])
    mps['canonical_team'] = mps['team'].map(name_to_canon).fillna(mps['team'])
    mte['canonical_team'] = mte['team'].map(name_to_canon).fillna(mte['team'])

    # Tag every match with its region, then propagate to map_player_stats
    matches = matches.merge(events[['event_id', 'region']], on='event_id', how='left')
    mps = mps.merge(matches[['match_id', 'region']], on='match_id', how='left')

    # Region per canonical team: whichever region they appear under most,
    # excluding "International" (Masters/EWC) since that's cross-region
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

    canonical_teams = sorted(lookup['canonical_name'].unique())
    canonical_teams = [t for t in canonical_teams if t != 'TBD']

    # ------------------------------------------------------------------
    # teams.json
    # ------------------------------------------------------------------
    teams_out = []
    for team in canonical_teams:
        team_matches = completed[(completed.c1 == team) | (completed.c2 == team)]
        matches_played = len(team_matches)
        matches_won = int((
            ((team_matches.c1 == team) & (team_matches.score1 > team_matches.score2)) |
            ((team_matches.c2 == team) & (team_matches.score2 > team_matches.score1))
        ).sum())

        team_maps = maps_df[(maps_df.c1 == team) | (maps_df.c2 == team)]
        maps_played = len(team_maps)
        maps_won = int((team_maps.winner == team).sum())

        team_econ = mte[mte.canonical_team == team]
        pistol_won = int(team_econ['pistol_won'].sum()) if len(team_econ) else 0
        pistol_played = maps_played * 2  # fixed rule: 2 pistols/map, none in OT

        team_players = mps[mps.canonical_team == team]
        avg_rating = team_players['rating'].mean()

        teams_out.append(clean_row({
            "team": team,
            "region": team_primary_region.get(team, "International"),
            "matchesPlayed": matches_played,
            "matchesWon": matches_won,
            "matchWinPct": (matches_won / matches_played) if matches_played else None,
            "mapsPlayed": maps_played,
            "mapsWon": maps_won,
            "mapWinPct": (maps_won / maps_played) if maps_played else None,
            "pistolWon": pistol_won,
            "pistolPlayed": pistol_played,
            "pistolWinPct": (pistol_won / pistol_played) if pistol_played else None,
            "avgRating": avg_rating,
        }))

    with open(f"{OUT}/teams.json", "w") as f:
        json.dump(teams_out, f, indent=2)
    print(f"teams.json: {len(teams_out)} teams")

    # ------------------------------------------------------------------
    # players.json
    # ------------------------------------------------------------------
    china_players_set = set(mps[mps['canonical_team'].isin(CHINA_TEAMS)]['player'].unique())
    intl_rows = mps[(mps['player'].isin(china_players_set)) & (mps['region'] == 'International')]
    players_with_intl = set(intl_rows['player'].unique())

    players_first = mps.sort_values(['match_id', 'map_index'])[['player', 'canonical_team']] \
        .drop_duplicates(subset='player', keep='first')

    def player_stats(sub):
        if len(sub) == 0:
            return None
        kills = sub['kills'].sum()
        deaths = sub['deaths'].sum()
        return clean_row({
            "mapsPlayed": len(sub),
            "avgRating": sub['rating'].mean(),
            "avgAcs": sub['acs'].mean(),
            "totalKills": int(kills),
            "totalDeaths": int(deaths),
            "kd": (kills / deaths) if deaths else None,
            "totalAssists": int(sub['assists'].sum()),
            "avgKast": sub['kast'].mean(),
            "avgAdr": sub['adr'].mean(),
            "avgHsPct": sub['hs_pct'].mean(),
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
        sub = mps[mps['player'] == player]
        stats = player_stats(sub)
        entry = {
            "player": player,
            "team": team,
            "isChina": is_china,
            "hasIntlStats": player in players_with_intl,
            "stats": stats,
        }
        if player in players_with_intl:
            intl_sub = sub[sub['region'] == 'International']
            entry["intlStats"] = player_stats(intl_sub)
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
    ranked_players = [p for p in players_out if p['stats'] and p['stats']['mapsPlayed'] >= MIN_MAPS_FOR_RANKING
                       and p['stats']['avgRating'] is not None]
    top_players = sorted(ranked_players, key=lambda p: p['stats']['avgRating'], reverse=True)[:10]
    top_players_out = [clean_row({
        "player": p['player'], "team": p['team'],
        "rating": p['stats']['avgRating'], "mapsPlayed": p['stats']['mapsPlayed']
    }) for p in top_players]

    ranked_teams = [t for t in teams_out if t['mapsPlayed'] and t['mapsPlayed'] >= 10 and t['mapWinPct'] is not None]
    top_teams = sorted(ranked_teams, key=lambda t: t['mapWinPct'], reverse=True)[:10]
    top_teams_out = [clean_row({
        "team": t['team'], "region": t['region'],
        "mapWinPct": t['mapWinPct'], "mapsPlayed": t['mapsPlayed'], "mapsWon": t['mapsWon']
    }) for t in top_teams]

    overview_out = {
        "kpis": {
            "totalEvents": int(events['event_id'].nunique()),
            "totalMatches": int(len(completed)),
            "totalMaps": int(len(maps_df.dropna(subset=['winner']))),
            "totalPlayers": int(len(players_out)),
            "totalTeams": int(len(canonical_teams)),
        },
        "topPlayersByRating": top_players_out,
        "topTeamsByMapWinPct": top_teams_out,
    }
    with open(f"{OUT}/overview.json", "w") as f:
        json.dump(overview_out, f, indent=2)
    print("overview.json written")

    # ------------------------------------------------------------------
    # economy.json — buy-type distribution (global + per-region) and
    # pistol win rates per region
    # ------------------------------------------------------------------
    mte_r = mte.merge(matches[['match_id', 'region']], on='match_id', how='left')

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

    # ------------------------------------------------------------------
    # events.json — for context (dates, stage) on the Overview
    # ------------------------------------------------------------------
    events_out = [clean_row(r) for r in events.to_dict(orient='records')]
    with open(f"{OUT}/events.json", "w") as f:
        json.dump(events_out, f, indent=2)
    print("events.json written")


if __name__ == "__main__":
    import os
    os.makedirs(OUT, exist_ok=True)
    main()
