import { useEffect, useMemo, useRef, useState } from 'react'
import { AutoComplete, Input } from 'antd'
import { useNavigate } from 'react-router-dom'
import { useData } from '../lib/useData'
import TeamLogo from './TeamLogo'
import Flag from './Flag'
import { STAT_CATALOG } from '../lib/statCatalog'

const MAX_RESULTS = 8

function matchRank(name, query) {
  const index = name.toLowerCase().indexOf(query)
  return index === -1 ? null : index === 0 ? 0 : 1
}

export default function SearchBar() {
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [everFocused, setEverFocused] = useState(false)
  const searchRef = useRef(null)

  const { data: playerData } = useData(everFocused ? 'player_buckets' : null)
  const { data: teamData } = useData(everFocused ? 'team_buckets' : null)

  const results = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return []

    const players = []
    if (playerData) {
      for (const [name, meta] of Object.entries(playerData.meta)) {
        const rank = matchRank(name, needle)
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
        const rank = matchRank(name, needle)
        if (rank !== null) teams.push({ type: 'team', name, rank, sub: meta.region })
      }
    }

    const statistics = []
    const includeStatistics = !['player', 'players', 'team', 'teams', 'stat', 'stats', 'statistics'].includes(needle)
    for (const statistic of includeStatistics ? STAT_CATALOG : []) {
      let rank = null
      for (const phrase of statistic.keywords) {
        const nextRank = matchRank(String(phrase), needle)
        if (nextRank !== null) rank = rank === null ? nextRank : Math.min(rank, nextRank)
      }
      if (rank !== null) {
        const order = /\b(?:shortest|lowest|least|fewest)\b/.test(needle)
          ? 'asc'
          : /\b(?:longest|highest|best|most|top)\b/.test(needle) ? 'desc' : ''
        statistics.push({
          type: 'statistic', name: statistic.searchLabel, rank,
          sub: statistic.entity === 'players' ? 'Player leaderboard' : statistic.definition.matchLevel ? 'Matchup leaderboard' : 'Team leaderboard',
          route: `/analysis?metric=${encodeURIComponent(statistic.id)}${order ? `&order=${order}` : ''}`,
        })
      }
    }

    return [...statistics, ...players, ...teams]
      .sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name))
      .slice(0, MAX_RESULTS)
  }, [query, playerData, teamData])

  useEffect(() => {
    function focusSearch(event) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setEverFocused(true)
        setOpen(true)
        searchRef.current?.focus()
      }
    }
    document.addEventListener('keydown', focusSearch)
    return () => document.removeEventListener('keydown', focusSearch)
  }, [])

  const ROUTE_BASE = { player: 'players', team: 'teams' }
  function go(index) {
    const result = results[Number(index)]
    if (!result) return
    navigate(result.route || `/${ROUTE_BASE[result.type]}/${encodeURIComponent(result.name)}`)
    setQuery('')
    setOpen(false)
    searchRef.current?.blur()
  }

  const options = results.map((result, index) => ({
    value: String(index),
    label: (
      <div className="flex min-w-[260px] items-center gap-2.5 py-0.5">
        {result.type === 'statistic'
          ? <span className="flex h-[18px] w-[18px] items-center justify-center rounded bg-surface3 text-[10px] font-semibold text-accent-bright">Σ</span>
          : result.type === 'team'
          ? <TeamLogo team={result.name} size={18} showName={false} />
          : <Flag countryCode={result.countryCode} countryName={result.countryName} size={16} />}
        <span className="flex min-w-0 flex-1 flex-col leading-tight">
          <span className="truncate text-xs font-semibold text-ink">{result.name}</span>
          {result.sub && <span className="truncate text-[10px] text-muted">{result.sub}</span>}
        </span>
        <span className="text-[9px] uppercase tracking-wide text-muted">{result.type}</span>
      </div>
    ),
  }))

  return (
    <AutoComplete
      ref={searchRef}
      value={query}
      options={options}
      open={open && query.trim() !== ''}
      onOpenChange={setOpen}
      onFocus={() => { setEverFocused(true); setOpen(true) }}
      onSearch={(value) => { setQuery(value); setOpen(true) }}
      onSelect={go}
      notFoundContent={<span className="text-xs text-muted">No players, teams, or statistics found.</span>}
      className="w-full"
    >
      <Input
        prefix={(
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" className="text-muted" aria-hidden="true">
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-4-4" />
          </svg>
        )}
        suffix={<kbd className="hidden rounded border border-hairline bg-surface px-1.5 py-0.5 font-mono text-[9px] text-muted sm:block">Ctrl K</kbd>}
        placeholder="Search players, teams, and statistics"
        aria-label="Search players, teams, and statistics"
      />
    </AutoComplete>
  )
}
