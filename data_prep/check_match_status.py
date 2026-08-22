"""
Cheap "did a match just finish" signal for update-data.yml, so that workflow
can react within minutes of a match ending instead of waiting for its own
3-hour cron.

WHY NOT JUST SCRAPE FASTER
--------------------------
update-data.yml's scraper already skips closed events cheaply (~3 requests
per still-active event), so the cost isn't a wasteful scrape -- it's the
3-hour gap between scheduled runs. Tightening that cron directly would mean
hitting vlr.gg itself every few minutes even during the long stretches
between matches. This script instead polls HenrikDev's unofficial VLR
esports API (docs.henrikdev.xyz -- same HENRIKDEV_API_KEY secret
fetch_act_stats.py/resolve_tracker_puuids.py already use) on a tight
schedule, and only asks update-data.yml to run when something actually
finished. HenrikDev cannot supply the site's real stats itself (see
project-history: its match-detail endpoint's per-player box score field is
confirmed empty on every match tested, live and completed, across 5 months
and every region) -- this only asks it "is anything new done yet", which its
`tags` field answers reliably enough for that narrower purpose.

ACTIVE EVENTS: OUR OWN DATA, NOT HENRIKDEV'S
---------------------------------------------
Deliberately does not call HenrikDev's own /events endpoint to discover
what's running. public/data/event_meta.json (Liquipedia dates) already
carries each named event's [startDate, endDate], and public/data/events.json
carries that same name's VLR event_id -- joining them gives "every event
whose date range covers today" for free, self-updating each season with no
edit needed here. (Scope gap, inherited from event_meta.json itself: it only
carries the ~16 "named majors" -- Kickoff/Stage 1/Stage 2/Masters/Champions
per region -- not the standalone EWC regional-qualifier events, which have no
Liquipedia date entry of their own. Not a problem today since this year's
qualifiers already concluded, but a future qualifier window would need its
own event_meta.json entry to be picked up here.)

WHAT SIGNALS "FINISHED"
------------------------
GET /v2/esports/vlr/events/{id}/matches returns every match in the event with
a `tags` array: [] before the match starts, gaining "Map" once VLR has a
final score, then "YouTube" once a VOD is linked. "Map" appearing where it
wasn't on the last run is the signal used here -- confirmed by tracking a
real live match end-to-end (DFM vs ZETA, 2026-08-22): metadata.status went
""->"final" and tags went []->[...]->["Map","Player"] exactly as the real
match concluded.

RETRY WINDOW (VLR publishes the score before the box score)
-------------------------------------------------------------
VLR itself sometimes shows a match's final score for up to ~20 minutes
before the per-player stats table is populated. If update-data.yml's own
scraper hits the match page during that gap, it correctly stores the match
as 'partial' rather than 'completed' (see scraper/vlr_vct_scraper.py) and
will pick it up again on its own next run regardless of this script -- but
if this match happens to be the last one to finish for a while, that "next
run" could otherwise be hours away (the next scheduled cron), wasting the
whole point of triggering early. So a match keeps reporting should_scrape
for RETRY_WINDOW_MINUTES after it first shows "Map", not just on the single
run that first noticed it -- a few extra, cheap triggers within that window
comfortably covers the ~20-minute gap without needing this script to know
anything about the scraper's own database/status.

STATE
-----
Keeps last-seen tags AND first-seen-with-"Map" timestamp per match id in a
small JSON file (path below), so a "Map" that was already there last run
doesn't re-trigger forever, only within its retry window. The workflow
persists this file via actions/cache the same way update-data.yml already
caches its scraper database.

USAGE
-----
    python data_prep/check_match_status.py
Writes `should_scrape=true|false` to $GITHUB_OUTPUT if set (no-op locally).
Never raises on an API failure -- a failed check just means "nothing to
report this run", falling back on update-data.yml's own 3-hour cron as the
real safety net.
"""
import json
import os
import sys
import time
import urllib.error
import urllib.request
from datetime import date, datetime, timedelta, timezone

_REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
EVENT_META_PATH = os.path.join(_REPO_ROOT, "public", "data", "event_meta.json")
EVENTS_PATH = os.path.join(_REPO_ROOT, "public", "data", "events.json")
STATE_PATH = os.path.join(_REPO_ROOT, "data_cache", "match_status_state.json")

API_BASE = "https://api.henrikdev.xyz/valorant/v2/esports/vlr"
REQUEST_DELAY_S = 1.1  # same pacing as resolve_tracker_puuids.py; 60 req/min free tier

# A match's real end can land a day either side of the Liquipedia-listed
# range (announced dates slipping, or the last match of an event running
# past its listed endDate) -- padding by a day in both directions costs a
# handful of extra no-op requests, not correctness.
DATE_PAD = timedelta(days=1)

# See the module docstring's "RETRY WINDOW" section: comfortably covers the
# ~20-minute VLR score-before-stats gap this exists for, without needing to
# know anything about whether the scraper's own re-scrape actually landed.
RETRY_WINDOW_MINUTES = 40

_ISO_FMT = "%Y-%m-%dT%H:%M:%SZ"


def _now_iso():
    return datetime.now(timezone.utc).strftime(_ISO_FMT)


def _parse_iso(s):
    try:
        return datetime.strptime(s, _ISO_FMT).replace(tzinfo=timezone.utc)
    except (TypeError, ValueError):
        return None


def _get(path):
    req = urllib.request.Request(
        f"{API_BASE}{path}",
        headers={"Authorization": os.environ["HENRIKDEV_API_KEY"]},
    )
    with urllib.request.urlopen(req, timeout=15) as resp:
        return json.load(resp)["data"]


def active_event_ids(today=None):
    today = today or date.today()
    with open(EVENT_META_PATH, encoding="utf-8") as f:
        meta = json.load(f)["events"]
    with open(EVENTS_PATH, encoding="utf-8") as f:
        events = json.load(f)
    name_to_id = {e["name"]: e["event_id"] for e in events}

    ids = []
    for name, info in meta.items():
        start, end = info.get("startDate"), info.get("endDate")
        if not start or not end:
            continue
        start_d = date.fromisoformat(start) - DATE_PAD
        end_d = date.fromisoformat(end) + DATE_PAD
        if start_d <= today <= end_d:
            eid = name_to_id.get(name)
            if eid is not None:
                ids.append(eid)
            else:
                print(f"  [warn] active per event_meta.json but no matching event_id in events.json: {name!r}")
    return sorted(set(ids))


def load_state():
    if os.path.exists(STATE_PATH):
        with open(STATE_PATH, encoding="utf-8") as f:
            return json.load(f)
    return {}


def save_state(state):
    os.makedirs(os.path.dirname(STATE_PATH), exist_ok=True)
    with open(STATE_PATH, "w", encoding="utf-8") as f:
        json.dump(state, f)


def write_output(should_scrape):
    gh_out = os.environ.get("GITHUB_OUTPUT")
    if not gh_out:
        return
    with open(gh_out, "a", encoding="utf-8") as f:
        f.write(f"should_scrape={'true' if should_scrape else 'false'}\n")


def main():
    if not os.environ.get("HENRIKDEV_API_KEY"):
        print("[FATAL] HENRIKDEV_API_KEY not set.", file=sys.stderr)
        return 1

    ids = active_event_ids()
    if not ids:
        print("No currently-active events in event_meta.json -- nothing to poll.")
        write_output(False)
        return 0
    print(f"Active events today: {ids}")

    prev_state = load_state()
    new_state = {}
    newly_finished = []
    retry_pending = []
    now = datetime.now(timezone.utc)

    for i, eid in enumerate(ids):
        if i > 0:
            time.sleep(REQUEST_DELAY_S)
        try:
            matches = _get(f"/events/{eid}/matches")
        except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError) as e:
            print(f"  [warn] event {eid}: fetch failed ({e}) -- skipping this event this run")
            continue

        for m in matches:
            mid = str(m["id"])
            tags = m.get("tags") or []
            prev = prev_state.get(mid) or {}
            had_map = "Map" in (prev.get("tags") or [])
            has_map = "Map" in tags

            entry = {"tags": tags}
            if has_map and not had_map:
                entry["first_map_at"] = _now_iso()
                newly_finished.append(m)
            elif has_map:
                # Carry the ORIGINAL first-seen timestamp forward -- this is
                # what anchors the retry window to when the match actually
                # finished, not to whenever this run happens to check it.
                entry["first_map_at"] = prev.get("first_map_at") or _now_iso()
                fp = _parse_iso(entry["first_map_at"])
                if fp and (now - fp) <= timedelta(minutes=RETRY_WINDOW_MINUTES):
                    retry_pending.append(m)
            new_state[mid] = entry

    # Matches from events no longer active (e.g. an event that just closed)
    # keep their last-known state rather than being dropped, so a late-tagged
    # VOD add doesn't look like a spurious re-finish next time that event
    # happens to be active again (a false "Map" re-appearance can't happen
    # anyway since it's already in prev_state, but this keeps the file from
    # silently shrinking every time the active window narrows).
    for mid, entry in prev_state.items():
        new_state.setdefault(mid, entry)
    save_state(new_state)

    if newly_finished:
        print(f"{len(newly_finished)} match(es) newly finished:")
        for m in newly_finished:
            print(f"  {m['id']}: {m.get('slug')}")
    if retry_pending:
        print(f"{len(retry_pending)} match(es) still within their {RETRY_WINDOW_MINUTES}min retry window:")
        for m in retry_pending:
            print(f"  {m['id']}: {m.get('slug')}")
    if not newly_finished and not retry_pending:
        print("No newly-finished or retry-pending matches since last check.")

    write_output(bool(newly_finished or retry_pending))
    return 0


if __name__ == "__main__":
    sys.exit(main())
