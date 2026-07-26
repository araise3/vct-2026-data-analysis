/**
 * LeaderCard -- the "top five, one line each" card. Generalised out of the
 * SeriesList block that already lived in Teams.jsx (longest/shortest
 * series), since the same shape suits every stat added in d4db14d far
 * better than a 19th table column does.
 *
 * CardShell is exported separately so SeriesList -- which has a
 * two-teams-and-a-duration row shape that doesn't fit the generic
 * entity/meta/value layout -- can keep its own row markup without the
 * card chrome drifting out of sync.
 */

export function CardShell({ title, note, children }) {
  return (
    <div className="bg-surface border border-hairline rounded-2xl p-5 flex flex-col">
      <h3 className="font-display text-sm font-semibold text-ink mb-4">{title}</h3>
      {children}
      {note && (
        <p className="text-muted text-xs mt-4 leading-relaxed">{note}</p>
      )}
    </div>
  )
}

export default function LeaderCard({
  title,
  note,
  rows,
  renderEntity,
  meta,
  value,
  showRank = false,
  empty = 'Not enough data in scope.',
}) {
  return (
    <CardShell title={title} note={note}>
      {rows.length === 0 ? (
        <p className="text-muted text-sm">{empty}</p>
      ) : (
        <div className="flex flex-col gap-3">
          {rows.map((r, i) => (
            <div key={r.__key ?? i} className="flex items-center gap-3 text-sm">
              {showRank && (
                <span className="text-muted text-xs w-4 text-right shrink-0">{i + 1}</span>
              )}
              <div className="flex items-center gap-2 min-w-0 flex-1">
                {renderEntity(r)}
              </div>
              {meta && (
                <span className="text-muted text-xs shrink-0">{meta(r)}</span>
              )}
              <span className="font-semibold text-ink shrink-0 w-16 text-right tabular-nums">
                {value(r)}
              </span>
            </div>
          ))}
        </div>
      )}
    </CardShell>
  )
}

/**
 * Rank rows by `key`, dropping anything below the sample threshold.
 *
 * The threshold is the whole point: a team that played four anti-eco
 * rounds and won all four is not the best anti-eco team, and a raw sort
 * would put it top of the card every time. `qualify` is a predicate on
 * the row rather than a number so each card can gate on its own
 * denominator (attack rounds, OT maps, maps with a duration, ...), which
 * is also what makes the China-region gap fall out correctly -- those
 * rows have a 0 denominator for economy-derived stats and are excluded
 * rather than shown as 0%.
 */
export function topBy(rows, key, { qualify, invert = false, limit = 5 } = {}) {
  return rows
    .filter((r) => r[key] != null && !Number.isNaN(r[key]) && (!qualify || qualify(r)))
    .sort((a, b) => (invert ? a[key] - b[key] : b[key] - a[key]))
    .slice(0, limit)
}

/**
 * A fixed minimum sample size (e.g. "min. 150 attack rounds") is
 * calibrated against a full season's worth of data. Narrow the filter
 * scope down to one stage of one region -- or anything else with far
 * less volume -- and NO row can ever clear that bar, so every card on
 * the page goes empty at once instead of just showing fewer/lower-
 * confidence entries.
 *
 * This scales the bar down to a fraction of whatever the current
 * LEADER in scope has actually accumulated, capped at the original
 * fixed threshold as a ceiling (so full-season scope behaves exactly
 * as before -- this only ever loosens the gate, never tightens it
 * beyond what was already calibrated). Self-normalizing per stat and
 * per scope: no separate "how big is a full season" constant to
 * maintain, since it's always relative to whatever's actually in view
 * right now.
 *
 * `floor` keeps a small amount of gate even in a near-empty scope --
 * without it, a single team with 1 attack round would qualify as soon
 * as everyone else has 0, which defeats the point of gating at all.
 */
export function dynamicQualify(rows, key, { fixed, fraction = 0.5, floor = 1 } = {}) {
  const maxVal = rows.reduce((m, r) => (r[key] > m ? r[key] : m), 0)
  const threshold = Math.max(floor, Math.min(fixed, Math.round(maxVal * fraction)))
  return (r) => r[key] >= threshold
}
