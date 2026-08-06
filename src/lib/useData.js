import { useEffect, useState } from 'react'

const cache = {}
const inflight = {}

/**
 * True once the browser has been idle after mount -- for data a page needs
 * *eventually* but not to render anything on first paint.
 *
 * Passing `useData(idle ? 'x' : null)` keeps a secondary file from competing
 * with the page's primary one for bandwidth and (more importantly) main-thread
 * parse time while the first view is still being built. The Players page loads
 * three of these files totalling ~14MB of JSON; without this they all land at
 * once and every JSON.parse blocks the same thread the table is rendering on.
 *
 * requestIdleCallback isn't in Safari, hence the setTimeout fallback. The
 * timeout on the idle request itself matters too: on a page that stays busy,
 * "idle" may never arrive on its own, and this data should still load.
 */
export function useIdle(timeout = 2000) {
  const [idle, setIdle] = useState(false)
  useEffect(() => {
    if (typeof requestIdleCallback === 'function') {
      const h = requestIdleCallback(() => setIdle(true), { timeout })
      return () => cancelIdleCallback(h)
    }
    const h = setTimeout(() => setIdle(true), 200)
    return () => clearTimeout(h)
  }, [timeout])
  return idle
}

/**
 * Fetches and caches `public/data/{name}.json`, sharing one in-flight
 * request across every caller (a prefetch on nav hover and the page's own
 * `useData` call, which lands a beat later, must not both hit the network).
 */
function fetchAndCache(name) {
  if (cache[name]) return Promise.resolve(cache[name])
  if (inflight[name]) return inflight[name]
  const p = fetch(`${import.meta.env.BASE_URL}data/${name}.json`)
    .then((r) => {
      if (!r.ok) throw new Error(`${r.status} ${r.statusText}`)
      return r.json()
    })
    .then((json) => {
      cache[name] = json
      delete inflight[name]
      return json
    })
    .catch((err) => {
      delete inflight[name]
      throw err
    })
  inflight[name] = p
  return p
}

/**
 * Fire-and-forget prefetch, for warming the cache before a page that needs
 * `name` actually mounts -- TopNav calls this on a nav link's hover/focus,
 * so by the time a click lands the fetch is already done or well underway
 * instead of only starting after the destination page renders. Errors are
 * swallowed here; the eventual `useData` call in the mounted page still
 * surfaces them normally.
 */
export function prefetchData(name) {
  if (name) fetchAndCache(name).catch(() => {})
}

/**
 * Fetches `public/data/{name}.json` once and memoises it for the session.
 *
 * `name` may contain a slash, for data nested under `public/data/`. No
 * caller needs that today -- it existed for the per-match detail files at
 * `data/matches/{id}.json`, which are gone now that match links point at
 * vlr.gg instead of a local match page -- but it costs nothing, since the
 * value is only interpolated into the fetch URL.
 *
 * The `error` state also outlived that page, and is deliberately kept: a
 * rejected fetch must resolve to `error: true` rather than leaving
 * `loading` true forever. That was a real bug once -- a 404's HTML body
 * threw inside `.json()`, uncaught, and the page sat on its spinner
 * indefinitely. Any fetch can still 404 (a stale deploy, a renamed file),
 * so the branch stays even with no consumer reading it right now.
 *
 * `error` is deliberately a boolean, not the thrown value -- nothing
 * renders the message, and every caller wants the same "couldn't load
 * this" branch whether it 404'd or the JSON was malformed.
 *
 * `name` may also be falsy (null/undefined/'') to opt out of fetching
 * entirely -- returns the empty/loading=false state without ever hitting
 * the network. SearchBar relies on this: it lives in TopNav, mounted on
 * every route, and player_buckets.json/team_buckets.json are multi-MB
 * files several routes (Agents, Tournaments) don't otherwise load --
 * passing `everFocused ? 'player_buckets' : null` defers the fetch until
 * the user actually opens the search box, instead of adding that weight to
 * every page's initial load.
 */
export function useData(name) {
  const [state, setState] = useState(() =>
    !name
      ? { data: null, loading: false, error: false }
      : cache[name]
      ? { data: cache[name], loading: false, error: false }
      : { data: null, loading: true, error: false }
  )

  useEffect(() => {
    if (!name) {
      setState({ data: null, loading: false, error: false })
      return
    }
    if (cache[name]) {
      setState({ data: cache[name], loading: false, error: false })
      return
    }
    // Guards against a slow fetch for a previous `name` resolving after
    // the component has already moved on to a different one and
    // overwriting the newer result.
    let cancelled = false
    setState({ data: null, loading: true, error: false })
    // Shares one in-flight request with a `prefetchData` call already
    // started on nav hover (see that function's own comment) rather than
    // firing a second, redundant fetch for the same file.
    fetchAndCache(name)
      .then((json) => {
        if (!cancelled) setState({ data: json, loading: false, error: false })
      })
      .catch(() => {
        if (!cancelled) setState({ data: null, loading: false, error: true })
      })
    return () => { cancelled = true }
  }, [name])

  return state
}
