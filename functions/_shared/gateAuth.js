// Shared by every gate's -check.js/-auth.js pair. Prefixed with an
// underscore so Cloudflare Pages treats this directory as a set of
// importable helpers, not routes of its own.

/**
 * Derives a deterministic, non-reversible cookie value from a secret,
 * so the cookie never contains the plaintext password -- but a -check
 * request can recompute the same hash from the same secret and compare,
 * with no need for a separate signing key or session store.
 */
export async function hashToken(gate, secret) {
  const enc = new TextEncoder().encode(`gate:${gate}:${secret}`)
  const digest = await crypto.subtle.digest('SHA-256', enc)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export function cookieName(gate) {
  return `gate_${gate}`
}

export function readCookie(request, name) {
  const header = request.headers.get('Cookie') || ''
  const match = header.match(new RegExp(`(?:^|;\\s*)${name}=([a-f0-9]+)`))
  return match ? match[1] : null
}

/**
 * Constant-time-ish string compare. Not a rigorous defense against a
 * sophisticated network timing attack (an early length-mismatch return
 * still leaks a little), but this is a casual access gate in front of
 * data that's already public as static JSON regardless -- not worth the
 * complexity of a fully length-independent comparison for this threat
 * model.
 */
export function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}
