import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useData } from '../lib/useData'
import TeamLogo from './TeamLogo'
import Flag from './Flag'

const MAX_RESULTS = 8

// Case-insensitive substring match, prefix matches ranked ahead of
// mid-string ones -- deliberately simpler than rft.gg's own search, which
// does fuzzy subsequence matching (typing "fake" surfaces "ShowMaker" and
// "SAKEN" there, not just "Faker"). The real use case here is typing a
// name you already know, which substring matching covers, without pulling
// in a fuzzy-scoring dependency for it.
function matchRank(name, query) {
  const i = name.toLowerCase().indexOf(query)
  return i === -1 ? null : i === 0 ? 0 : 1
}

/**
 * Global player/team search, living in TopNav's inner row (same spot as
 * rft.gg's). Data source is `player_buckets.json` / `team_buckets.json`'s
 * `meta` objects -- the same per-entity metadata (team, region, flag)
 * every list page already reads off these files, keyed by name, so no new
 * data file was needed.
 *
 * Both files are only fetched once the user actually focuses the box (see
 * `everFocused` and the matching comment on `useData`), not on mount --
 * TopNav renders on every route, and several routes don't otherwise load
 * either multi-MB file.
 */
export default function SearchBar() {
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)
  const [everFocused, setEverFocused] = useState(false)
  const containerRef = useRef(null)
  const inputRef = useRef(null)

  const { data: playerData } = useData(everFocused ? 'player_buckets' : null)
  const { data: teamData } = useData(everFocused ? 'team_buckets' : null)

  const results = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return []

    const players = []
    if (playerData) {
      for (const [name, meta] of Object.entries(playerData.meta)) {
        const rank = matchRank(name, q)
        if (rank !== null) {
          players.push({
            type: 'player', name, rank,
            sub: meta.team, countryCode: meta.countryCode, countryName: meta.countryName,
          })
        }
      }
    }

    const teams = []
    if (teamData) {
      for (const [name, meta] of Object.entries(teamData.meta)) {
        const rank = matchRank(name, q)
        if (rank !== null) teams.push({ type: 'team', name, rank, sub: meta.region })
      }
    }

    return [...players, ...teams]
      .sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name))
      .slice(0, MAX_RESULTS)
  }, [query, playerData, teamData])

  useEffect(() => { setActiveIndex(0) }, [results])

  // Closes the dropdown on an outside click -- a plain onBlur would also
  // fire when clicking a result itself (blur happens before the result's
  // own click handler runs), which is why `go()` below also guards against
  // that via onMouseDown's preventDefault instead of relying on this.
  useEffect(() => {
    function onClickOutside(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [])

  function go(result) {
    if (!result) return
    navigate(`/${result.type === 'player' ? 'players' : 'teams'}/${encodeURIComponent(result.name)}`)
    setQuery('')
    setOpen(false)
    inputRef.current?.blur()
  }

  function onKeyDown(e) {
    if (!open || results.length === 0) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIndex((i) => (i + 1) % results.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIndex((i) => (i - 1 + results.length) % results.length)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      go(results[activeIndex])
    } else if (e.key === 'Escape') {
      setOpen(false)
      inputRef.current?.blur()
    }
  }

  return (
    <div ref={containerRef} className="relative w-full max-w-[240px]">
      <div className="flex items-center gap-2 h-7 px-2.5 rounded-md bg-ink/[0.04] border border-hairline focus-within:border-muted transition-colors">
        <svg
          viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2"
          strokeLinecap="round" strokeLinejoin="round" className="text-muted shrink-0 opacity-70"
        >
          <path d="m21 21-4.34-4.34" />
          <circle cx="11" cy="11" r="8" />
        </svg>
        <input
          ref={inputRef}
          type="text"
          value={query}
          placeholder="Search"
          onFocus={() => { setEverFocused(true); setOpen(true) }}
          onChange={(e) => { setQuery(e.target.value); setOpen(true) }}
          onKeyDown={onKeyDown}
          // leading-none: without it the input inherits the row's taller
          // line-height, so the blinking text caret renders much taller
          // than the actual text-xs glyphs next to it.
          className="flex-1 w-full min-w-0 bg-transparent text-xs leading-none text-ink placeholder:text-muted focus:outline-none"
        />
      </div>

      {open && query.trim() !== '' && (
        <div className="absolute right-0 mt-1.5 w-[280px] max-h-[360px] overflow-auto bg-surface border border-hairline rounded-xl shadow-lg py-1.5 z-50">
          {results.length === 0 ? (
            <div className="px-3 py-3 text-xs text-muted">No players or teams found.</div>
          ) : (
            results.map((r, i) => (
              <button
                key={`${r.type}-${r.name}`}
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => go(r)}
                onMouseEnter={() => setActiveIndex(i)}
                className={`w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors ${
                  i === activeIndex ? 'bg-surface2' : ''
                }`}
              >
                {r.type === 'player' ? (
                  <Flag countryCode={r.countryCode} countryName={r.countryName} size={16} />
                ) : (
                  <TeamLogo team={r.name} size={18} showName={false} />
                )}
                <span className="flex flex-col min-w-0 leading-tight">
                  <span className="text-xs font-medium text-ink truncate">{r.name}</span>
                  {r.sub && <span className="text-[10px] text-muted truncate">{r.sub}</span>}
                </span>
                <span className="ml-auto text-[10px] uppercase tracking-wide text-muted/60 shrink-0">
                  {r.type}
                </span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  )
}
