#!/usr/bin/env python3
"""
Build public/data/patch_notes.json from a hand-curated list of VALORANT
patch notes (v11.10 onward), sourced from Riot's official wiki
(https://wiki.playvalorant.com/en-us/Patch_Notes). Unlike
data_prep/build_liquipedia_data.py, there is no API to hit here -- Riot's
wiki has none -- so the patch data itself is embedded below as a literal
Python list rather than fetched, and this script's only job is to validate
it and write it out in the shape the frontend expects.

Re-run this whenever a new patch ships and gets added to PATCHES below:

    python data_prep/build_patch_notes.py

`OUT` is derived from this file's own location (mirrors export_from_db.py),
so it follows the repo if it ever moves; pass --out to override.

PATCHES below transcribes every patch in the window verbatim, including ones
with no agent balance changes (bug-fix-only patches, or ones that only
touched the map pool) -- ALL of them ship to patch_notes.json, unfiltered.
(An earlier revision of this script filtered out patches with an empty
agentChanges, on the theory that a patch which changed nothing about any
agent has no place on an agent-trend chart. Reverted: the /patches page's
event timeline needs every REAL patch a tournament could have been played
on -- Masters London 2026 was played on 12.10, which has zero agent changes
and would otherwise have no matching line on the chart even though
event_meta.json's own patchStart/patchEnd correctly says 12.10. Patch
windows for the agent-trend view are a byproduct of whatever's in this list;
a bug-fix-only patch just produces a window with no marker on any agent's
series, which is honest rather than a gap.)

Validation before writing (fails loudly rather than silently shipping a
typo that would never join to anything on the frontend):
  - `date` strictly ascending across the list
  - every `type` is one of buff/nerf/adjust/rework/new
  - every `agent` name matches a key in src/lib/agentIcons.json, case-
    insensitively and ignoring non-alphanumerics (the same normalization
    AgentIcon.jsx itself applies), so "KAY/O" would need to be spelled
    "Kayo" here to pass -- which is exactly the join this file's `agent`
    field needs to make against player_agents.json's `ag` field downstream.
"""
import argparse
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
_REPO_ROOT = os.path.dirname(HERE)
OUT = os.environ.get("PATCH_NOTES_OUT", os.path.join(_REPO_ROOT, "public", "data"))
AGENT_ICONS_PATH = os.path.join(_REPO_ROOT, "src", "lib", "agentIcons.json")

VALID_TYPES = {"buff", "nerf", "adjust", "rework", "new"}

# Transcribed verbatim from Riot's per-patch wiki pages (11.10 -> 13.02).
# Agent naming matches this site's own spelling (see agentIcons.json) so it
# joins directly against player_agents.json's `ag` field -- KAY/O is stored
# here as "Kayo". Excluded by convention: pure voice-line additions, VFX/
# audio bugfixes, console-only fixes -- where a patch's real notes had none
# of those either, `agentChanges`/`mapChanges` are genuine empty arrays, not
# a sign this patch was skipped.
PATCHES = [
    {
        "version": "11.10", "date": "2025-11-11", "notable": True,
        "url": "https://wiki.playvalorant.com/en-us/Patch_Notes/11.10",
        "agentChanges": [
            {"agent": "Harbor", "ability": "Cove", "type": "rework", "summary": "Moved to the free signature slot (was 350 creds); now forms a water smoke that can be shielded to block bullets."},
            {"agent": "Harbor", "ability": "High Tide", "type": "rework", "summary": "Moved out of the signature slot; now costs 300 creds."},
            {"agent": "Harbor", "ability": "Storm Surge", "type": "rework", "summary": "New ability: throws an explosive whirlpool that nearsights and slows."},
            {"agent": "Harbor", "ability": "Reckoning", "type": "rework", "summary": "Redesigned into a water surge that nearsights and slows enemies it hits."},
            {"agent": "Clove", "ability": "Ruse", "type": "nerf", "summary": "Charges capped at 1 while Clove is dead."},
            {"agent": "Clove", "ability": "Pick-me-up", "type": "nerf", "summary": "Overheal reduced 100 HP to 50 HP."},
            {"agent": "Omen", "ability": "Dark Cover", "type": "adjust", "summary": "Spectators can now watch Omen's own view while he places smokes."},
        ],
        "mapChanges": [],
    },
    {
        "version": "11.11", "date": "2025-12-02", "notable": False,
        "url": "https://wiki.playvalorant.com/en-us/Patch_Notes/11.11",
        "agentChanges": [], "mapChanges": [],
    },
    {
        "version": "12.00", "date": "2026-01-06", "notable": True,
        "url": "https://wiki.playvalorant.com/en-us/Patch_Notes/12.00",
        "agentChanges": [
            {"agent": "Breach", "ability": "Flashpoint", "type": "buff", "summary": "Projectile speed increased 20% (2000 to 2400)."},
            {"agent": "Breach", "ability": "Fault Line", "type": "buff", "summary": "Width increased 7.5m to 8m."},
            {"agent": "Brimstone", "ability": "Sky Smoke", "type": "adjust", "summary": "Tactical map readability updated for Sky Smoke and Orbital Strike."},
            {"agent": "Harbor", "ability": "Storm Surge", "type": "buff", "summary": "No longer requires line of sight to nearsight and slow; explosion windup 0.8s to 0.6s; slow duration 0.6s to 2s."},
            {"agent": "Harbor", "ability": "Reckoning", "type": "buff", "summary": "Slow duration increased 0.6s to 2s."},
            {"agent": "Sage", "ability": "Healing Orb", "type": "buff", "summary": "Targeting updated so a blocked ally's mid and lower model can be healed."},
            {"agent": "Tejo", "ability": "Special Delivery", "type": "nerf", "summary": "Concuss duration 4s to 2.5s; now deals 20-35 damage."},
            {"agent": "Tejo", "ability": "Stealth Drone", "type": "adjust", "summary": "Snapshot reveal changed to full reveal, but pulse radius cut 30m to 16m."},
            {"agent": "Vyse", "ability": "Steel Garden", "type": "buff", "summary": "Radius 26m to 28m; width 7.5m to 8m."},
        ],
        "mapChanges": [
            {"map": "Breeze", "type": "reworked", "summary": "Reworked to reduce angle complexity and tighten spaces."},
            {"map": "Breeze", "type": "added", "summary": "Added to the Competitive map pool."},
            {"map": "Sunset", "type": "removed", "summary": "Removed from the Competitive map pool."},
        ],
    },
    {
        "version": "12.01", "date": "2026-01-21", "notable": False,
        "url": "https://wiki.playvalorant.com/en-us/Patch_Notes/12.01",
        "agentChanges": [], "mapChanges": [],
    },
    {
        "version": "12.02", "date": "2026-02-03", "notable": True,
        "url": "https://wiki.playvalorant.com/en-us/Patch_Notes/12.02",
        "agentChanges": [
            {"agent": "Gekko", "ability": "Wingman", "type": "nerf", "summary": "Can now be concussed."},
            {"agent": "Skye", "ability": "Seekers", "type": "nerf", "summary": "Can now be concussed."},
            {"agent": "Raze", "ability": "Boom Bot", "type": "nerf", "summary": "Can now be concussed."},
            {"agent": "Harbor", "ability": "Cove", "type": "buff", "summary": "Cooldown 40s to 30s; smoke duration 15s to 19.25s; health 500 to 680; faster gun re-equip."},
            {"agent": "Harbor", "ability": "High Tide", "type": "buff", "summary": "Wall height 6m to 8m; max length 50m to 60m."},
            {"agent": "Harbor", "ability": "Reckoning", "type": "buff", "summary": "Wave speed increased 25%; can be re-used to hold the wave in place for 7s."},
            {"agent": "Harbor", "ability": "Storm Surge", "type": "adjust", "summary": "Now plays world audio when enemies are hit."},
            {"agent": "Reyna", "ability": "Soul Orbs", "type": "nerf", "summary": "Orb duration 4s to 3s."},
            {"agent": "Reyna", "ability": "Devour", "type": "nerf", "summary": "Overheal now temporary, lasting 10s; permanent only during Empress."},
            {"agent": "Reyna", "ability": "Empress", "type": "nerf", "summary": "Ultimate cost 6 to 7 points."},
        ],
        "mapChanges": [],
    },
    {
        "version": "12.03", "date": "2026-02-18", "notable": False,
        "url": "https://wiki.playvalorant.com/en-us/Patch_Notes/12.03",
        "agentChanges": [
            {"agent": "Gekko", "ability": "Globules", "type": "nerf", "summary": "Reclaim timer 15s to 20s."},
            {"agent": "Gekko", "ability": "Mosh Pit", "type": "buff", "summary": "Now reclaimable."},
        ],
        "mapChanges": [],
    },
    {
        "version": "12.04", "date": "2026-03-03", "notable": False,
        "url": "https://wiki.playvalorant.com/en-us/Patch_Notes/12.04",
        "agentChanges": [
            {"agent": "Killjoy", "ability": "Turret", "type": "adjust", "summary": "Can be rotated with ALT-FIRE while placing; ACTIVATE swaps direction, matching Sage's Barrier Orb placement."},
        ],
        "mapChanges": [],
    },
    {
        "version": "12.05", "date": "2026-03-17", "notable": True,
        "url": "https://wiki.playvalorant.com/en-us/Patch_Notes/12.05",
        "agentChanges": [
            {"agent": "Miks", "ability": None, "type": "new", "summary": "New Controller agent from Croatia, with Harmonize, M-pulse, Waveform and Bassquake."},
            {"agent": "Skye", "ability": "Guiding Light", "type": "nerf", "summary": "Added a 60s cooldown."},
            {"agent": "Yoru", "ability": "Gatecrash", "type": "nerf", "summary": "Beacon active duration 30s to 15s."},
            {"agent": "Yoru", "ability": "Blindside", "type": "nerf", "summary": "Charges 2 to 1."},
            {"agent": "Clove", "ability": "Ruse", "type": "nerf", "summary": "Smoke duration when cast while dead 14s to 6s."},
            {"agent": "Clove", "ability": "Meddle", "type": "nerf", "summary": "Area of effect 6m to 4m."},
            {"agent": "Sage", "ability": "Healing Orb", "type": "adjust", "summary": "New ally-targeting widget and model highlight."},
        ],
        "mapChanges": [
            {"map": "Lotus", "type": "added", "summary": "Added to the Competitive map pool."},
            {"map": "Lotus", "type": "reworked", "summary": "A-site reworked: thickened attacker lobby wall, repositioned vine jump, reinforced tree room wall, new room outside stairs, modified plant zone."},
            {"map": "Fracture", "type": "added", "summary": "Added to the Competitive map pool."},
            {"map": "Abyss", "type": "removed", "summary": "Removed from the Competitive map pool."},
            {"map": "Corrode", "type": "removed", "summary": "Removed from the Competitive map pool."},
        ],
    },
    {
        "version": "12.06", "date": "2026-03-31", "notable": False,
        "url": "https://wiki.playvalorant.com/en-us/Patch_Notes/12.06",
        "agentChanges": [
            {"agent": "Waylay", "ability": "Saturate", "type": "nerf", "summary": "Changed from INSTANT to EQUIP, to cut low-risk combo potential with teammates."},
            {"agent": "Viper", "ability": "Viper's Pit", "type": "adjust", "summary": "Chemical cloud now spreads more consistently around map geometry."},
        ],
        "mapChanges": [],
    },
    {
        "version": "12.07", "date": "2026-04-14", "notable": False,
        "url": "https://wiki.playvalorant.com/en-us/Patch_Notes/12.07",
        "agentChanges": [], "mapChanges": [],
    },
    {
        "version": "12.08", "date": "2026-04-28", "notable": True,
        "url": "https://wiki.playvalorant.com/en-us/Patch_Notes/12.08",
        "agentChanges": [],
        "mapChanges": [
            {"map": "Ascent", "type": "added", "summary": "Returned to the Competitive map pool."},
            {"map": "Bind", "type": "removed", "summary": "Removed from the Competitive map pool."},
        ],
    },
    {
        "version": "12.09", "date": "2026-05-12", "notable": True,
        "url": "https://wiki.playvalorant.com/en-us/Patch_Notes/12.09",
        "agentChanges": [
            {"agent": "Neon", "ability": "High Gear", "type": "nerf", "summary": "Jumping no longer grants an airborne speed bonus; air sprint speed now matches melee speed."},
            {"agent": "Neon", "ability": "Energy", "type": "nerf", "summary": "Fuel regeneration on kill now only applies while her ultimate is active."},
        ],
        "mapChanges": [],
    },
    {
        "version": "12.10", "date": "2026-05-27", "notable": False,
        "url": "https://wiki.playvalorant.com/en-us/Patch_Notes/12.10",
        "agentChanges": [], "mapChanges": [],
    },
    {
        "version": "12.11", "date": "2026-06-09", "notable": False,
        "url": "https://wiki.playvalorant.com/en-us/Patch_Notes/12.11",
        "agentChanges": [], "mapChanges": [],
    },
    {
        "version": "13.00", "date": "2026-06-23", "notable": True,
        "url": "https://wiki.playvalorant.com/en-us/Patch_Notes/13.00",
        "agentChanges": [
            {"agent": "Killjoy", "ability": "Turret", "type": "buff", "summary": "Rate of fire increased 8 to 12."},
            {"agent": "Killjoy", "ability": "Nanoswarm", "type": "buff", "summary": "Duration increased 4s to 5s."},
            {"agent": "Killjoy", "ability": "Alarmbot", "type": "buff", "summary": "Movement speed increased 15m/s to 22.5m/s."},
            {"agent": "Veto", "ability": "Crosscut", "type": "buff", "summary": "Vortex radius 24m to 30m; deployment time 1.5s to 0.75s."},
            {"agent": "Veto", "ability": "Interceptor", "type": "buff", "summary": "Reclaim cooldown 30s to 20s."},
            {"agent": "Sage", "ability": "Healing Orb", "type": "buff", "summary": "Self heal-over-time increased 50 to 100."},
            {"agent": "Cypher", "ability": "Trapwire", "type": "buff", "summary": "Windup decreased 0.9s to 0.7s."},
            {"agent": "Deadlock", "ability": "GravNet", "type": "buff", "summary": "Cooldown decreased 60s to 50s."},
            {"agent": "Breach", "ability": "Fault Line", "type": "buff", "summary": "Cooldown decreased 60s to 50s."},
            {"agent": "Fade", "ability": "Haunt", "type": "buff", "summary": "Cooldown decreased 60s to 50s."},
            {"agent": "Kayo", "ability": "ZERO/point", "type": "buff", "summary": "Cooldown decreased 60s to 50s."},
            {"agent": "Skye", "ability": "Guiding Light", "type": "buff", "summary": "Cooldown decreased 60s to 50s."},
            {"agent": "Sova", "ability": "Recon Bolt", "type": "buff", "summary": "Cooldown decreased 60s to 50s."},
            {"agent": "Gekko", "ability": "Globules", "type": "buff", "summary": "Cooldown decreased 20s to 15s."},
            {"agent": "Omen", "ability": "Shrouded Step", "type": "adjust", "summary": "SFX clarity improved for enemies."},
        ],
        "mapChanges": [
            {"map": "Summit", "type": "added", "summary": "New map, added to the Competitive map pool."},
            {"map": "Sunset", "type": "added", "summary": "Returned to the Competitive map pool."},
            {"map": "Fracture", "type": "removed", "summary": "Removed from the Competitive map pool."},
            {"map": "Pearl", "type": "removed", "summary": "Removed from the Competitive map pool."},
        ],
    },
    {
        "version": "13.01", "date": "2026-07-14", "notable": False,
        "url": "https://wiki.playvalorant.com/en-us/Patch_Notes/13.01",
        "agentChanges": [
            {"agent": "Iso", "ability": "Double Tap", "type": "buff", "summary": "Weapon re-equip speed changed from Fast to Instant."},
            {"agent": "Yoru", "ability": "Gatecrash", "type": "buff", "summary": "Tether duration increased 15s to 20s."},
            {"agent": "Yoru", "ability": "Fakeout", "type": "adjust", "summary": "Mirror image now equips the last equipped weapon instead of the strongest."},
        ],
        "mapChanges": [],
    },
    {
        "version": "13.02", "date": "2026-07-28", "notable": False,
        "url": "https://wiki.playvalorant.com/en-us/Patch_Notes/13.02",
        "agentChanges": [
            {"agent": "Phoenix", "ability": "Run it Back", "type": "nerf", "summary": "Ultimate cost increased 6 to 7 points."},
            {"agent": "Waylay", "ability": None, "type": "adjust", "summary": "Agent temporarily disabled while ability bugs were fixed."},
        ],
        "mapChanges": [],
    },
]


def norm_agent_key(name):
    """Same normalization AgentIcon.jsx applies to its `agent` prop before
    looking it up in agentIcons.json -- lowercase, strip non-alphanumerics."""
    return re.sub(r"[^a-z0-9]", "", name.lower())


def validate(patches, agent_icon_keys):
    errors = []

    prev_date = None
    for p in patches:
        if prev_date is not None and p["date"] <= prev_date:
            errors.append(f"dates not strictly ascending at {p['version']} ({p['date']} <= {prev_date})")
        prev_date = p["date"]

        for change in p["agentChanges"]:
            if change["type"] not in VALID_TYPES:
                errors.append(f"{p['version']}: invalid type '{change['type']}' for {change['agent']}")
            key = norm_agent_key(change["agent"])
            if key not in agent_icon_keys:
                errors.append(
                    f"{p['version']}: agent '{change['agent']}' (key '{key}') not found in "
                    f"src/lib/agentIcons.json -- typo, or a name that needs remapping to this "
                    f"site's spelling"
                )

    if errors:
        print("patch_notes validation failed:", file=sys.stderr)
        for e in errors:
            print(f"  - {e}", file=sys.stderr)
        sys.exit(1)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", default=OUT, help="Output directory (default: public/data)")
    args = parser.parse_args()

    with open(AGENT_ICONS_PATH, encoding="utf-8") as f:
        agent_icon_keys = set(json.load(f).keys())

    validate(PATCHES, agent_icon_keys)

    out = {
        "_meta": {
            "source": "wiki.playvalorant.com",
            "attribution": "Patch versions, dates and balance changes from Riot Games' official VALORANT wiki (wiki.playvalorant.com).",
            "generatedAt": "2026-08-13T00:00:00Z",
            "coverageStart": PATCHES[0]["date"],
            "coverageEnd": PATCHES[-1]["date"],
            "note": "Hand-curated from Riot's per-patch pages, v11.10 onward only -- every real patch in that window ships here, including ones with no agent balance changes (bug-fix-only or map-pool-only patches), since a tournament can genuinely have been played on one of those (see event_meta.json's patchStart/patchEnd). Voice-line-only, VFX/audio bugfix and console-only entries WITHIN a kept patch are still deliberately excluded from its agentChanges. Agent names use this site's spelling (KAY/O is stored as Kayo).",
        },
        "patches": PATCHES,
    }

    os.makedirs(args.out, exist_ok=True)
    out_path = os.path.join(args.out, "patch_notes.json")
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(out, f, indent=2)

    print(f"Wrote {len(PATCHES)} patches to {out_path}")


if __name__ == "__main__":
    main()
