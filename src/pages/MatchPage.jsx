import { useEffect, useMemo, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useData } from '../lib/useData'
import MatchScoreboard from '../components/MatchScoreboard'
import TeamLogo from '../components/TeamLogo'
import { pct, num, duration, eventLabel, roundLabel, phaseLabel } from '../lib/format'

/**
 * One match, in full: series totals plus every individual map, with the
 * per-map extras that only exist at map level (round-by-round outcomes,
 * buy-type economy, multi-kills, objectives).
 *
 * Fetches only its own `data/matches/{id}.json` -- see the export script
 * for why this is one file per match rather than a slice of a big one.
 */

const SIDES = [
  { key: 'all', label: 'All' },
  { key: 'atk', label: 'Attack' },
  { key: 'def', label: 'Defend' },
]

// VLR's round-end icons, as scraped. Single letters keep a 24+ round strip
// readable at a glance; the full word is in each cell's tooltip.
const WIN_CONDITIONS = {
  elim: { letter: 'E', label: 'Elimination' },
  defuse: { letter: 'D', label: 'Defuse' },
  boom: { letter: 'B', label: 'Spike detonated' },
  time: { letter: 'T', label: 'Time expired' },
}

const BUY_TIERS = [
  { key: 'eco', label: 'Eco' },
  { key: 'semiEco', label: 'Semi-eco' },
  { key: 'semiBuy', label: 'Semi-buy' },
  { key: 'fullBuy', label: 'Full buy' },
]

function Fact({ label, value, sub }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-muted text-[11px] uppercase tracking-wide">{label}</span>
      <span className="font-body text-ink text-sm font-medium">{value}</span>
      {sub && <span className="text-muted/70 text-[11px]">{sub}</span>}
    </div>
  )
}

/** Round-by-round strip: who won each round, on which side, and how. */
function RoundTimeline({ rounds, team1, team2 }) {
  if (!rounds?.length) return null
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-1">
        {rounds.map((r) => {
          const isTeam1 = r.w === team1
          const wc = WIN_CONDITIONS[r.c] || { letter: '?', label: r.c || 'Unknown' }
          return (
            <div key={r.n} className="flex flex-col items-center gap-1 w-7">
              <span className="text-muted/60 text-[10px] leading-none">{r.n}</span>
              <span
                title={`Round ${r.n} — ${r.w || 'unknown'} won on ${
                  r.s === 't' ? 'attack' : r.s === 'ct' ? 'defense' : 'unknown side'
                } (${wc.label})`}
                className={`w-7 h-7 rounded flex items-center justify-center text-[11px] font-semibold ${
                  isTeam1 ? 'bg-accent/80 text-white' : 'bg-sky-500/80 text-white'
                }`}
              >
                {wc.letter}
              </span>
              {/* Attack/defense marker for the winning side -- a filled bar
                  for attack, hollow for defense. */}
              <span
                className={`w-4 h-[3px] rounded-full ${
                  r.s === 't' ? 'bg-ink/70' : r.s === 'ct' ? 'bg-ink/25' : 'bg-transparent'
                }`}
              />
            </div>
          )
        })}
      </div>
      <div className="flex flex-wrap gap-x-5 gap-y-1 text-[11px] text-muted">
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded bg-accent/80 inline-block" /> {team1}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded bg-sky-500/80 inline-block" /> {team2}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-4 h-[3px] rounded-full bg-ink/70 inline-block" /> won on attack
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-4 h-[3px] rounded-full bg-ink/25 inline-block" /> won on defense
        </span>
        <span>E elimination · D defuse · B spike · T time</span>
      </div>
    </div>
  )
}

/** Buy-type economy for one map, both teams. */
function EconomyTable({ econ }) {
  if (!econ?.length) return null
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-separate border-spacing-0 text-[13px]">
        <thead>
          <tr>
            <th className="px-3 py-2 text-left font-medium text-xs uppercase tracking-wide text-muted border-b border-hairline">
              Team
            </th>
            <th className="px-3 py-2 text-right font-medium text-xs uppercase tracking-wide text-muted border-b border-hairline whitespace-nowrap">
              Pistols
            </th>
            {BUY_TIERS.map((t) => (
              <th
                key={t.key}
                className="px-3 py-2 text-right font-medium text-xs uppercase tracking-wide text-muted border-b border-hairline whitespace-nowrap"
              >
                {t.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {econ.map((e) => (
            <tr key={e.t} className="hover:bg-surface2/40 transition-colors">
              <td className="px-3 py-2 border-b border-hairline">
                <Link
                  to={`/teams/${encodeURIComponent(e.t)}`}
                  className="hover:text-accent-bright transition-colors"
                >
                  <TeamLogo team={e.t} size={18} />
                </Link>
              </td>
              <td className="px-3 py-2 text-right border-b border-hairline text-ink/90">
                {e.pistol == null ? '—' : `${e.pistol}/2`}
              </td>
              {BUY_TIERS.map((t) => {
                const [rounds, won] = e[t.key] || []
                return (
                  <td
                    key={t.key}
                    className="px-3 py-2 text-right border-b border-hairline whitespace-nowrap"
                  >
                    {!rounds ? (
                      <span className="text-muted">—</span>
                    ) : (
                      <>
                        <span className="text-ink/90">{won}/{rounds}</span>
                        <span className="text-muted/70 text-[11px] ml-1.5">
                          {pct(won / rounds, 0)}
                        </span>
                      </>
                    )}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default function MatchPage() {
  const { id } = useParams()
  const { data, loading, error } = useData(`matches/${id}`)
  // 'all' = series totals; otherwise the map's own 1-based index.
  const [mapKey, setMapKey] = useState('all')
  const [side, setSide] = useState('all')

  // React reuses this component across /matches/:id navigations (same route
  // pattern), so the selection has to be reset explicitly. Without it,
  // going from map 3 of a Bo5 to a Bo3 leaves mapKey=3 pointing at a map
  // the new match doesn't have: `find` returns undefined, the page falls
  // back to series totals, and NO tab renders as selected -- looking like
  // the selector broke. Reachable in normal use (match -> player profile ->
  // one of their other matches).
  useEffect(() => {
    setMapKey('all')
    setSide('all')
  }, [id])

  const selectedMap = useMemo(
    () => (mapKey === 'all' ? null : data?.maps?.find((m) => m.i === mapKey) ?? null),
    [data, mapKey]
  )

  // Series rows already carry their own agent list; a map's rows carry one
  // agent each. MatchScoreboard normalises that, so both go in as-is.
  const rows = selectedMap ? selectedMap.players : (data?.series ?? [])

  const anySideData = useMemo(() => rows.some((r) => r.atk || r.def), [rows])
  const effectiveSide = anySideData ? side : 'all'

  // How many of the series' maps actually carry an attack/defense split.
  // The export drops placeholder t/ct rows that repeat the map total on
  // both sides (see its "non-partitioning t/ct" filter), and a few matches
  // have a genuine split on some maps but not others. When that happens the
  // SERIES Attack/Defend totals cover only the maps that have one -- which
  // would otherwise read as the player's full-series attack numbers.
  const mapsWithSide = useMemo(
    () => (data?.maps ?? []).filter((m) => m.players?.some((p) => p.atk || p.def)).length,
    [data]
  )
  const totalMaps = data?.maps?.length ?? 0
  const partialSideSeries =
    !selectedMap && effectiveSide !== 'all' && mapsWithSide > 0 && mapsWithSide < totalMaps

  if (loading) return <div className="text-muted text-sm">Loading…</div>

  if (error || !data) {
    return (
      <div className="flex flex-col gap-4">
        <Link to="/tournaments" className="text-sm text-accent-bright hover:underline">
          ← Back to Tournaments
        </Link>
        <p className="text-muted text-sm">No match found with id "{id}".</p>
      </div>
    )
  }

  const t1Won = data.s1 > data.s2
  const t2Won = data.s2 > data.s1

  return (
    <div className="flex flex-col gap-6">
      <Link to="/tournaments" className="text-sm text-muted hover:text-ink w-fit">
        ← Back to Tournaments
      </Link>

      <div className="bg-surface border border-hairline rounded-2xl p-5 flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
          <span className="text-ink/80">{eventLabel(data.event)}</span>
          {data.w && (
            <>
              <span className="text-muted/40">·</span>
              <span>{phaseLabel(data.w)}</span>
              <span className="text-muted/40">·</span>
              <span>{roundLabel(data.w)}</span>
            </>
          )}
          <span className="text-muted/40">·</span>
          <span>{data.date}</span>
          {data.region && (
            <>
              <span className="text-muted/40">·</span>
              <span>{data.region}</span>
            </>
          )}
        </div>

        <div className="flex items-center justify-center gap-6 flex-wrap">
          <Link
            to={`/teams/${encodeURIComponent(data.team1)}`}
            className={`flex items-center gap-3 hover:text-accent-bright transition-colors ${
              t1Won ? 'text-ink' : 'text-muted'
            }`}
          >
            <TeamLogo team={data.team1} size={36} showName={false} />
            <span className="font-display text-lg font-semibold">{data.team1}</span>
          </Link>
          <span className="font-display text-3xl font-semibold whitespace-nowrap">
            <span className={t1Won ? 'text-ink' : 'text-muted'}>{data.s1}</span>
            <span className="text-muted/40 mx-2">–</span>
            <span className={t2Won ? 'text-ink' : 'text-muted'}>{data.s2}</span>
          </span>
          <Link
            to={`/teams/${encodeURIComponent(data.team2)}`}
            className={`flex items-center gap-3 hover:text-accent-bright transition-colors ${
              t2Won ? 'text-ink' : 'text-muted'
            }`}
          >
            <span className="font-display text-lg font-semibold">{data.team2}</span>
            <TeamLogo team={data.team2} size={36} showName={false} />
          </Link>
        </div>
      </div>

      {/* Map selector + side toggle */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setMapKey('all')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
              mapKey === 'all'
                ? 'bg-accent text-white border-accent'
                : 'bg-surface2 text-muted border-hairline hover:text-ink'
            }`}
          >
            All maps
          </button>
          {data.maps.map((m) => (
            <button
              key={m.i}
              onClick={() => setMapKey(m.i)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors whitespace-nowrap ${
                mapKey === m.i
                  ? 'bg-accent text-white border-accent'
                  : 'bg-surface2 text-muted border-hairline hover:text-ink'
              }`}
            >
              {m.name || `Map ${m.i}`}
              <span className={mapKey === m.i ? 'text-white/70 ml-2' : 'text-muted/60 ml-2'}>
                {m.s1}–{m.s2}
              </span>
            </button>
          ))}
        </div>

        {anySideData && (
          <div className="flex rounded-lg overflow-hidden border border-hairline">
            {SIDES.map((opt) => (
              <button
                key={opt.key}
                onClick={() => setSide(opt.key)}
                className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                  side === opt.key ? 'bg-accent text-white' : 'bg-surface2 text-muted hover:text-ink'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Per-map facts. Series view has no single duration or half score, so
          this block only exists once a specific map is picked. */}
      {selectedMap && (
        <div className="bg-surface border border-hairline rounded-2xl p-5 grid grid-cols-2 md:grid-cols-4 gap-4">
          <Fact label="Map" value={selectedMap.name || `Map ${selectedMap.i}`} />
          <Fact
            label="Score"
            value={`${selectedMap.s1} – ${selectedMap.s2}`}
            sub={selectedMap.winner ? `${selectedMap.winner} won` : undefined}
          />
          <Fact
            label="Duration"
            value={selectedMap.dur ? duration(selectedMap.dur) : '—'}
            sub={selectedMap.dur ? undefined : 'Not published'}
          />
          <Fact
            label="Halves (ATK / DEF)"
            value={
              selectedMap.atk1 == null
                ? '—'
                : `${selectedMap.atk1}/${selectedMap.def1} · ${selectedMap.atk2}/${selectedMap.def2}`
            }
            sub={selectedMap.atk1 == null ? 'Not published' : `${data.team1} · ${data.team2}`}
          />
        </div>
      )}

      <div className="bg-surface border border-hairline rounded-2xl p-5 flex flex-col gap-3">
        <div className="flex items-baseline justify-between gap-3 flex-wrap">
          <h2 className="font-display text-sm font-semibold text-ink">
            {selectedMap ? `${selectedMap.name || `Map ${selectedMap.i}`} scoreboard` : 'Series totals'}
          </h2>
          <p className="text-muted text-xs">
            {selectedMap
              ? 'This map only.'
              : `Aggregated across all ${data.maps.length} maps, rounds-weighted.`}
            {effectiveSide !== 'all' && ' Multi-kill, clutch and economy columns have no side split and stay full-map.'}
          </p>
        </div>
        {partialSideSeries && (
          <p className="text-[11px] text-accent-bright bg-accent/10 border border-accent/20 rounded-lg px-3 py-2">
            {/* Noun agrees with the total ("1 of 3 maps"), verb with the
                count ("1 ... has", "2 ... have"). */}
            Only {mapsWithSide} of {totalMaps} {totalMaps === 1 ? 'map' : 'maps'} in this series
            {mapsWithSide === 1 ? ' has' : ' have'} an attack/defense split published, so these side
            totals cover just {mapsWithSide === 1 ? 'that map' : 'those maps'} — not the full series.
            The All view covers every map.
          </p>
        )}
        <MatchScoreboard
          rows={rows}
          team1={data.team1}
          team2={data.team2}
          meta={data.meta}
          side={effectiveSide}
          showExtras
        />
      </div>

      {selectedMap?.rounds?.length > 0 && (
        <div className="bg-surface border border-hairline rounded-2xl p-5 flex flex-col gap-3">
          <div>
            <h2 className="font-display text-sm font-semibold text-ink">Round by round</h2>
            <p className="text-muted text-xs mt-1">
              Who won each round, which side they were on, and how it ended.
            </p>
          </div>
          <RoundTimeline
            rounds={selectedMap.rounds}
            team1={data.team1}
            team2={data.team2}
          />
        </div>
      )}

      {selectedMap?.econ?.length > 0 && (
        <div className="bg-surface border border-hairline rounded-2xl p-5 flex flex-col gap-3">
          <div>
            <h2 className="font-display text-sm font-semibold text-ink">Economy</h2>
            <p className="text-muted text-xs mt-1">
              Rounds won by buy type. Not published for China-region matches.
            </p>
          </div>
          <EconomyTable econ={selectedMap.econ} />
        </div>
      )}

      {selectedMap && !selectedMap.econ?.length && !selectedMap.rounds?.length && (
        <p className="text-muted text-xs px-1">
          No round-by-round or economy data published for this map.
        </p>
      )}
    </div>
  )
}
