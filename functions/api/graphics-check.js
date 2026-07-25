import { hashToken, cookieName, readCookie } from '../_shared/gateAuth.js'

const GATE = 'graphics'

export async function onRequestGet({ request, env }) {
  const secret = env.GRAPHICS_PASSWORD
  if (!secret) {
    // Fail closed: an unconfigured secret should never silently unlock
    // the gate. This is what you'll see if GRAPHICS_PASSWORD hasn't
    // been set on the Pages project yet.
    return new Response(JSON.stringify({ authorized: false, reason: 'not_configured' }), {
      headers: { 'Content-Type': 'application/json' },
    })
  }
  const cookie = readCookie(request, cookieName(GATE))
  const expected = await hashToken(GATE, secret)
  const authorized = !!cookie && cookie === expected
  return new Response(JSON.stringify({ authorized }), {
    headers: { 'Content-Type': 'application/json' },
  })
}
