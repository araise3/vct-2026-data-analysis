import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useData } from '../lib/useData'
import { RailCard } from './MatchRail'

/**
 * rft.gg's "COMPARE PLAYERS" card: two name boxes that hand off to the radar
 * comparison already built into PlayerProfile.jsx.
 *
 * The player list (player_buckets.json) is 6.7MB, so it is NOT fetched until
 * a box is first focused -- `useData(null)` skips the request entirely, the
 * same deferral SearchBar.jsx uses for exactly this reason. Without it this
 * card would put a multi-megabyte download on the Events page's critical
 * path to populate an autocomplete most visitors never open.
 *
 * Submitting navigates to `/players/A?compare=B`; PlayerProfile seeds its
 * own compare state from that query param. It can only route to one profile,
 * so the second name has to travel in the URL.
 */
export default function ComparePlayersCard() {
  const navigate = useNavigate()
  const [touched, setTouched] = useState(false)
  const [a, setA] = useState('')
  const [b, setB] = useState('')

  const { data, loading } = useData(touched ? 'player_buckets' : null)

  const options = useMemo(() => {
    if (!data?.meta) return []
    return Object.keys(data.meta).sort((x, y) => x.localeCompare(y))
  }, [data])

  const canSubmit = a.trim() && b.trim() && a.trim() !== b.trim()

  function submit(e) {
    e.preventDefault()
    if (!canSubmit) return
    navigate(`/players/${encodeURIComponent(a.trim())}?compare=${encodeURIComponent(b.trim())}`)
  }

  return (
    <RailCard title="Compare players">
      <form onSubmit={submit} className="flex flex-col gap-2 p-3">
        <NameInput value={a} onChange={setA} onFocus={() => setTouched(true)}
                   placeholder={loading ? 'Loading…' : 'Player'} listId="cmp-a" options={options} />
        <div className="text-center text-[10px] font-semibold uppercase text-muted/50">vs</div>
        <NameInput value={b} onChange={setB} onFocus={() => setTouched(true)}
                   placeholder={loading ? 'Loading…' : 'Player'} listId="cmp-b" options={options} />
        <button
          type="submit"
          disabled={!canSubmit}
          className="mt-1 rounded-2xl border border-hairline bg-surface2 px-3 py-1.5 text-[11px] font-medium text-ink transition-colors hover:border-muted disabled:cursor-not-allowed disabled:opacity-40"
        >
          Compare
        </button>
      </form>
    </RailCard>
  )
}

function NameInput({ value, onChange, onFocus, placeholder, listId, options }) {
  return (
    <>
      <input
        list={listId}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={onFocus}
        placeholder={placeholder}
        className="w-full rounded-lg border border-hairline bg-surface2 px-2.5 py-1.5 text-[11px] text-ink placeholder:text-muted focus:border-muted focus:outline-none"
      />
      <datalist id={listId}>
        {options.map((n) => <option key={n} value={n} />)}
      </datalist>
    </>
  )
}
