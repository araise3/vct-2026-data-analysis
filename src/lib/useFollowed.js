import { useCallback, useEffect, useState } from 'react'

// Client-only "Follow" toggle, no account/backend behind it (this is a
// static site) -- persisted per browser via localStorage instead. One key
// per entity kind (`vct-followed-players`, `vct-followed-teams`, ...) holding
// a plain array of names, so unrelated kinds never collide in storage.
function storageKey(kind) {
  return `vct-followed-${kind}`
}

function readFollowed(kind) {
  try {
    const raw = localStorage.getItem(storageKey(kind))
    return raw ? new Set(JSON.parse(raw)) : new Set()
  } catch {
    return new Set()
  }
}

function writeFollowed(kind, set) {
  try {
    localStorage.setItem(storageKey(kind), JSON.stringify([...set]))
  } catch {
    // Storage unavailable (private browsing, quota) -- the toggle still
    // works for the current render, it just won't survive a reload.
  }
}

/** `[isFollowed, toggle]` for one entity (e.g. a single player name),
 * re-reading storage whenever `name` itself changes so switching profiles
 * doesn't carry the previous player's followed state along with it. */
export function useFollowed(kind, name) {
  const [followed, setFollowed] = useState(() => readFollowed(kind).has(name))

  useEffect(() => {
    setFollowed(readFollowed(kind).has(name))
  }, [kind, name])

  const toggle = useCallback(() => {
    const set = readFollowed(kind)
    if (set.has(name)) set.delete(name)
    else set.add(name)
    writeFollowed(kind, set)
    setFollowed(set.has(name))
  }, [kind, name])

  return [followed, toggle]
}
