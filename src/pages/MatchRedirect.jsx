import { useEffect } from 'react'
import { useParams } from 'react-router-dom'
import { vlrMatchUrl } from '../lib/format'

/**
 * Sends a legacy `/matches/:id` URL to the same match on vlr.gg.
 *
 * The site used to render its own match page here. Deleting the route
 * outright left any already-shared or bookmarked match link rendering a
 * blank page (no catch-all route exists), so this keeps those URLs working
 * by forwarding them to the thing that replaced them.
 *
 * `location.replace`, not `assign`: the dead URL shouldn't stay in history,
 * or pressing Back would land on it again and bounce straight forward.
 *
 * Non-numeric ids are NOT forwarded -- every real match id is an integer
 * (it's vlr.gg's own primary key), so anything else is a bad link and would
 * only produce a vlr.gg 404. Those render the message and stop here.
 */
export default function MatchRedirect() {
  const { id } = useParams()
  const isRealId = /^\d+$/.test(id ?? '')
  const url = isRealId ? vlrMatchUrl(id) : null

  useEffect(() => {
    if (url) window.location.replace(url)
  }, [url])

  return (
    <div className="flex flex-col gap-2">
      <h1 className="font-display text-lg font-semibold text-ink">
        Match pages now live on vlr.gg
      </h1>
      {url ? (
        <p className="text-muted text-sm">
          Taking you to{' '}
          <a href={url} className="text-accent-bright hover:underline">
            vlr.gg/{id}
          </a>
          …
        </p>
      ) : (
        <p className="text-muted text-sm">
          "{id}" isn't a valid match id. Browse matches from a{' '}
          <a href="/players" className="text-accent-bright hover:underline">player</a>,{' '}
          <a href="/teams" className="text-accent-bright hover:underline">team</a> or{' '}
          <a href="/tournaments" className="text-accent-bright hover:underline">tournament</a> page.
        </p>
      )}
    </div>
  )
}
