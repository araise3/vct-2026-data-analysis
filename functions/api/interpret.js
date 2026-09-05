import { INTENT_SCHEMA, sanitizeIntent } from '../../src/lib/intentContract.js'
import { STAT_CATALOG } from '../../src/lib/statCatalog.js'

const MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast'
const MAX_QUERY_LENGTH = 600

function json(body, status = 200) {
  return Response.json(body, {
    status,
    headers: {
      'Cache-Control': 'no-store',
      'Content-Security-Policy': "default-src 'none'",
      'X-Content-Type-Options': 'nosniff',
    },
  })
}

function systemPrompt(today) {
  const statistics = STAT_CATALOG
    .map((statistic) => `- ${statistic.id}: ${statistic.searchLabel}`)
    .join('\n')
  return `You are the intent compiler for a competitive VALORANT statistics portal.
Convert the user's natural-language request into the provided JSON schema. Never answer the
question and never invent a URL. Preserve every explicit constraint, even when the input has typos.

Portal destinations:
- players: player ranking/statistics table
- teams: team aggregate statistics table
- agents: agent meta, pick rates, map balance, agent performance
- compositions: five-agent lineups
- events: tournament/event statistics
- ratings: Glicko-2 team strength/rating history
- economy: buys, pistols, conversions, spending
- records: statistical leaderboards and matchup records
- graphics: exportable stat cards
- compare: compare exactly two named players
- analysis: a custom results view that can combine named player/team summaries, a role-based peer
  table, a requested metric, and every supplied filter
- statistics: legacy alias for analysis when only one metric was requested

Use destination=analysis whenever the request combines an entity, role, metric, or filter into a
specific question. Copy player/team names exactly as written into players/teams. If a role is named,
set role; otherwise leave it empty—the client infers a named player's primary role inside the chosen
scope. Set population=players or teams when the request asks for a population/table; a named player
or role implies players, and a named team implies teams. When the user names a statistic, copy its
exact identifier into stat.
Use an empty stat for every other destination. Set order=asc for shortest/lowest/fewest requests,
order=desc for longest/highest/most/best requests, and an empty order when no direction is explicit.
Available statistics:
${statistics}

Filter ontology:
- competitions: VCT or EWC. “Valorant Champions Tour” means VCT; “Esports World Cup” means EWC.
- regions: Americas, EMEA, Pacific, China, International. LATAM/NA -> Americas; Europe/EU -> EMEA;
  APAC/Asia-Pacific -> Pacific; CN -> China.
- splits: Kickoff, Stage 1, Stage 2, Champions.
- years are four-digit calendar years.
- from/to must be ISO YYYY-MM-DD. Resolve relative dates against today (${today}). A bare year
  belongs in years and does not require from/to. A named month or exact range must set from/to.
- event, phase, and week must be copied only when the user actually specifies them.

Critical examples:
“defuses in 2026 for vct americas” => analysis, players.total-defuses, years [2026], competitions [VCT], regions [Americas].
“give me mada stats in Americas 2026 Stage 1” => analysis, players [mada], empty role/stat,
population players, years [2026], regions [Americas], splits [Stage 1]. The client will infer mada's
role and add peers.
“best players in emea stage two 2025” => analysis, population players, years [2025], regions [EMEA], splits [Stage 2].
“compare aspas and zekken” => compare, comparePlayers [aspas, zekken].

Use empty strings/arrays for fields the user did not constrain, including players, teams, role, population,
stat, order, and comparePlayers. summary is a short confirmation of
what will open, including every applied filter.`
}

export async function onRequestPost({ request, env }) {
  if (!env?.AI?.run) return json({ error: 'Workers AI binding is not configured.' }, 503)

  const contentLength = Number(request.headers.get('content-length') || 0)
  if (contentLength > 4096) return json({ error: 'Request is too large.' }, 413)

  let body
  try {
    body = await request.json()
  } catch {
    return json({ error: 'Expected a JSON request.' }, 400)
  }

  const query = typeof body?.query === 'string' ? body.query.trim() : ''
  if (!query || query.length > MAX_QUERY_LENGTH) {
    return json({ error: `Query must contain 1–${MAX_QUERY_LENGTH} characters.` }, 400)
  }

  try {
    const result = await env.AI.run(MODEL, {
      messages: [
        { role: 'system', content: systemPrompt(new Date().toISOString().slice(0, 10)) },
        { role: 'user', content: query },
      ],
      response_format: { type: 'json_schema', json_schema: INTENT_SCHEMA },
      temperature: 0.1,
      max_tokens: 350,
    })
    const parsed = typeof result?.response === 'string' ? JSON.parse(result.response) : result?.response
    const intent = sanitizeIntent(parsed)
    if (!intent) return json({ error: 'The model returned an invalid intent.' }, 502)
    return json({ intent, engine: 'workers-ai' })
  } catch {
    // Do not leak provider internals or prompt/model details to the public client.
    return json({ error: 'The intent model could not interpret this request.' }, 502)
  }
}

export function onRequestGet() {
  return json({ error: 'Method not allowed.' }, 405)
}
