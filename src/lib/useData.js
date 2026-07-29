import { useEffect, useState } from 'react'

const cache = {}

/**
 * Fetches `public/data/{name}.json` once and memoises it for the session.
 *
 * `name` may contain a slash -- the per-match detail files live at
 * `data/matches/{id}.json`, so a match page calls
 * useData(`matches/${id}`). Those are the one case where the argument is
 * user-controlled (it comes from the URL), which is why this reports a
 * real error state instead of only ever resolving: a bad id used to leave
 * `loading` true forever, because a 404's HTML body threw inside .json()
 * and the rejection was never caught, so the page sat on its spinner
 * rather than showing "no such match".
 *
 * `error` is deliberately a boolean, not the thrown value -- nothing
 * renders the message, and every caller wants the same "couldn't load
 * this" branch whether it 404'd or the JSON was malformed.
 */
export function useData(name) {
  const [state, setState] = useState(() =>
    cache[name]
      ? { data: cache[name], loading: false, error: false }
      : { data: null, loading: true, error: false }
  )

  useEffect(() => {
    if (cache[name]) {
      setState({ data: cache[name], loading: false, error: false })
      return
    }
    // Guards against a slow fetch for a previous `name` resolving after
    // the component has already moved on to a different one and
    // overwriting the newer result.
    let cancelled = false
    setState({ data: null, loading: true, error: false })
    fetch(`${import.meta.env.BASE_URL}data/${name}.json`)
      .then((r) => {
        if (!r.ok) throw new Error(`${r.status} ${r.statusText}`)
        return r.json()
      })
      .then((json) => {
        cache[name] = json
        if (!cancelled) setState({ data: json, loading: false, error: false })
      })
      .catch(() => {
        if (!cancelled) setState({ data: null, loading: false, error: true })
      })
    return () => { cancelled = true }
  }, [name])

  return state
}
