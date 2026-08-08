/**
 * Joins this site's own event records to Liquipedia-sourced tournament
 * structure (public/data/tournament_structure.json) -- group composition,
 * tiebreaker rules, seed outcomes, bracket skeletons. Only currently-live/
 * incomplete stages have an entry (see the scraper's own TARGET_STAGES
 * comment) -- every other event resolves to null, and callers must
 * degrade gracefully (TournamentDetail.jsx falls back to the plain match
 * list it already had).
 *
 * The join key is `public/data/events.json`'s own `slug` field (a stable,
 * hyphenated id every event already carries at export time), not
 * something re-derived here -- a second slug-generation scheme would risk
 * silently drifting out of sync with the one export_from_db.py already
 * computes. `events.json` (confirmed a plain array of
 * `{event_id, slug, name, region, stage, competition, year, ...}` rows) is
 * NOT otherwise fetched anywhere on the site -- every other page reads the
 * small per-file `events` lookup table embedded in each bucket/match JSON
 * instead, which doesn't carry `slug` -- so TournamentDetail.jsx is the
 * first consumer, via its own `useData('events')` call.
 */
export function stageStructureFor(tournamentData, eventsData, eventName) {
  if (!tournamentData || !eventsData) return null
  const ev = eventsData.find((e) => e.name === eventName)
  if (!ev) return null
  return tournamentData.stages?.[ev.slug] ?? null
}
