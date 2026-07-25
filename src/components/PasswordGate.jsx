import { useEffect, useState } from 'react'

/**
 * Gates its children behind a password, checked against a Cloudflare
 * secret via a Pages Function (functions/api/<gate>-check.js and
 * <gate>-auth.js) -- the actual password never ships in the client JS
 * bundle, only a same-origin fetch result does.
 *
 * IMPORTANT ARCHITECTURAL NOTE: this can only be a client-side gate, not
 * a server-side "block requests to /this-path" one. Every route in this
 * app is client-side routed (React Router) after the initial page load
 * -- clicking a Sidebar link never makes a new network request, so a
 * Cloudflare Function that only intercepts GET /graphics would never
 * even see most of the traffic that reaches this page. Putting the
 * check inside the React component itself means it runs on every mount
 * regardless of whether someone arrived via a fresh page load or an
 * in-app client-side navigation.
 *
 * Also worth being honest about: the underlying data this gate sits in
 * front of (public/data/*.json) is served as plain static files by
 * Cloudflare Pages regardless of this gate -- anyone who already knows
 * or guesses those URLs can fetch them directly. This locks the page/UI
 * from casual visitors, not the underlying stats data, which was never
 * private to begin with.
 *
 * Requires a GRAPHICS_PASSWORD secret set on the Cloudflare Pages
 * project (Settings -> Environment variables -> add as encrypted/
 * secret, for both Production and Preview if you want it gated there
 * too) -- this only works on an actual Cloudflare Pages deployment
 * (functions/ doesn't run under plain `vite dev`; use `wrangler pages
 * dev` locally if you need to test the gate itself, otherwise the
 * fetch below will 404 and the gate fails closed, showing the password
 * form with every attempt failing until the Function is actually live).
 */
export default function PasswordGate({ gate, title, children }) {
  const [authorized, setAuthorized] = useState(null) // null = still checking
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    let cancelled = false
    fetch(`/api/${gate}-check`, { credentials: 'include' })
      .then((r) => r.json())
      .then((d) => { if (!cancelled) setAuthorized(!!d.authorized) })
      .catch(() => { if (!cancelled) setAuthorized(false) })
    return () => { cancelled = true }
  }, [gate])

  async function handleSubmit(e) {
    e.preventDefault()
    setSubmitting(true)
    setError('')
    try {
      const res = await fetch(`/api/${gate}-auth`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok && data.ok) {
        setAuthorized(true)
      } else {
        setError('Incorrect password.')
      }
    } catch {
      setError('Couldn\u2019t reach the auth check \u2014 try again.')
    } finally {
      setSubmitting(false)
    }
  }

  if (authorized === null) {
    return <div className="text-muted text-sm">Checking access\u2026</div>
  }

  if (!authorized) {
    return (
      <div className="max-w-sm mx-auto mt-16 flex flex-col gap-4">
        <div>
          <h1 className="font-display text-xl font-semibold text-ink">{title || 'This page is locked'}</h1>
          <p className="text-muted text-sm mt-1">Enter the password to continue.</p>
        </div>
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <input
            type="password"
            autoFocus
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
            className="bg-surface2 border border-hairline rounded-lg px-3 py-2 text-sm text-ink focus:outline-none focus:border-muted"
          />
          {error && <p className="text-accent text-xs">{error}</p>}
          <button
            type="submit"
            disabled={submitting || !password}
            className="bg-accent text-white rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50"
          >
            {submitting ? 'Checking\u2026' : 'Unlock'}
          </button>
        </form>
      </div>
    )
  }

  return children
}
