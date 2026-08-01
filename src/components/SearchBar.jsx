import { useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useData } from '../lib/useData'

/**
 * Global player/team search, living in TopNav's inner row (same spot as
 * rft.gg's). Rebuilt on the same plain <input list>/<datalist> pattern as
 * PlayerProfile's radar compare box -- the earlier hand-rolled dropdown
 * (its own results list, arrow-key nav, outside-click handling, match
 * ranking) kept misbehaving in practice, and the browser's own datalist
 * popup handles "type a name, see matches, pick one" without any of that
 * code to get wrong. The tradeoff is losing the flag/team-logo icons the
 * old dropdown rendered per row -- a native <option> can't host a React
 * component, only a plain label string -- accepted in exchange for using
 * the same reliable pattern already proven on PlayerProfile.
 *
 * Data source is still player_buckets.json / team_buckets.json's `meta`
 * objects -- the same per-entity metadata every list page already reads
 * off these files, keyed by name, so no new data file was needed.
 *
 * Both files are only fetched once the user actually focuses the box (see
 * `everFocused` and the matching comment on `useData`), not on mount --
 * TopNav renders on every route, and several routes don't otherwise load
 * either multi-MB file.
 */
export default function SearchBar() {
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [everFocused, setEverFocused] = useState(false)
  const inputRef = useRef(null)

  const { data: playerData } = useData(everFocused ? 'player_buckets' : null)
  const { data: teamData } = useData(everFocused ? 'team_buckets' : null)

  // name -> { type, route info } lookup, rebuilt only when the underlying
  // files (re)load, not per keystroke. Teams are inserted first so a
  // same-named player (unlikely, but not impossible) wins the slot --
  // matches the old dropdown's own player-before-team ordering.
  const entries = useMemo(() => {
    const map = new Map()
    if (teamData) {
      for (const [name, meta] of Object.entries(teamData.meta)) {
        map.set(name, { type: 'team', name, sub: meta.region })
      }
    }
    if (playerData) {
      for (const [name, meta] of Object.entries(playerData.meta)) {
        map.set(name, { type: 'player', name, sub: meta.team })
      }
    }
    return map
  }, [playerData, teamData])

  function go(entry) {
    navigate(`/${entry.type === 'player' ? 'players' : 'teams'}/${encodeURIComponent(entry.name)}`)
    setQuery('')
    inputRef.current?.blur()
  }

  // Commits whatever's currently typed if -- and only if -- it exactly
  // matches a known name, same "commit on an exact value" contract as
  // PlayerProfile's commitCompare(). Called both on every change (so
  // picking a suggestion from the native popup navigates immediately,
  // since that sets the input's value to an exact match) and on blur/Enter
  // (so manually typing a full, correct name and confirming it also
  // works, without requiring the popup to be used at all).
  function commit(value) {
    const entry = entries.get(value.trim())
    if (entry) go(entry)
  }

  return (
    <div className="relative w-full max-w-[240px]">
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
          list="global-search-options"
          value={query}
          placeholder="Search"
          onFocus={() => setEverFocused(true)}
          onChange={(e) => { setQuery(e.target.value); commit(e.target.value) }}
          onBlur={(e) => commit(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); commit(query) }
            else if (e.key === 'Escape') { setQuery(''); inputRef.current?.blur() }
          }}
          className="flex-1 w-full min-w-0 bg-transparent text-xs leading-none text-ink placeholder:text-muted focus:outline-none"
        />
      </div>

      <datalist id="global-search-options">
        {[...entries.values()].map((e) => (
          <option
            key={`${e.type}-${e.name}`}
            value={e.name}
            label={`${e.sub ? `${e.sub} · ` : ''}${e.type === 'player' ? 'Player' : 'Team'}`}
          />
        ))}
      </datalist>
    </div>
  )
}
