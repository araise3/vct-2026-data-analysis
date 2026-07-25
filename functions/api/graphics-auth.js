import { hashToken, cookieName, safeEqual } from '../_shared/gateAuth.js'

const GATE = 'graphics'
const MAX_AGE_SECONDS = 60 * 60 * 24 * 30 // 30 days

export async function onRequestPost({ request, env }) {
  const secret = env.GRAPHICS_PASSWORD
  if (!secret) {
    return new Response(JSON.stringify({ ok: false, reason: 'not_configured' }), { status: 500 })
  }

  let body
  try {
    body = await request.json()
  } catch {
    return new Response(JSON.stringify({ ok: false, reason: 'bad_request' }), { status: 400 })
  }

  const submitted = typeof body?.password === 'string' ? body.password : ''
  if (!safeEqual(submitted, secret)) {
    return new Response(JSON.stringify({ ok: false }), { status: 401 })
  }

  const token = await hashToken(GATE, secret)
  const headers = new Headers({ 'Content-Type': 'application/json' })
  headers.append(
    'Set-Cookie',
    `${cookieName(GATE)}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${MAX_AGE_SECONDS}`
  )
  return new Response(JSON.stringify({ ok: true }), { headers })
}
