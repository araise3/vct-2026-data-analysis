import { INTENT_BATCH_SCHEMA, sanitizeIntents } from '../../src/lib/intentContract.js'
import { STAT_CATALOG } from '../../src/lib/statCatalog.js'

const MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast'
const MAX_QUERY_LENGTH = 1200

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
    .map((statistic) => `- ${statistic.id}: ${statistic.searchLabel}${statistic.definition.higherIsBetter === false ? ' (lower is better)' : ''}`)
    .join('\n')
  return `You are the intent planner for a competitive VALORANT statistics portal.
Convert the user's complete natural-language request into the provided JSON schema. Never answer the
question and never invent a URL. Preserve every explicit constraint, even when the input has typos.

Return a root object with intents and summary. Create one intent for each independently renderable
answer the user asks for, up to six. Multiple statistics usually require separate intents because one
card renders one primary statistic. Keep named entities together when they are a direct comparison
with the same metric and scope. Repeat genuinely shared filters on every applicable intent, but keep
clause-specific filters on only their clause. Follow pronouns and phrases such as “same scope”, “also”,
“versus”, “respectively”, and “for each”. Never silently discard a requested supported statistic.

Always use destination=analysis. The product has one answer canvas, not traditional destination pages.
Use view=team-profile when the request names one team without a specific catalog statistic, or for
a broad request for one named team's stats, profile, overview, matches,
map record, vetoes, compositions, or current roster. Set teamTab to overview, matches, maps, agents,
or roster when the request names that section; otherwise use overview. This full profile contains
all of those sections as tabs. Keep view empty when the user asks for one specific catalog statistic
or a table comparing multiple teams.
Use view=roster-history when the user asks for a team's roster history, historical lineup, roster
timeline, or roster chart. Put the named organization in teams, set population=teams, and leave
players/stat/role/order empty, includeTable=false, and limit=0. A roster-history request is about a
team even when a similarly spelled player exists; for example, “show me LOUD roster history” means
team LOUD, never player Cloud. For roster-history leave teamTab empty. Leave view and teamTab empty
for ordinary statistical analysis.
Copy player/team names exactly as written into players/teams. If a role is named, set role; otherwise
leave it empty. Set population to the entity type being requested. A named player implies players and
a named team implies teams, but that does NOT imply a comparison table. For map- or series-level
duration statistics, leave population empty unless the user also names a team.

Set includeTable=true only when the user explicitly asks for a table, leaderboard, ranking, list,
population (for example “all Duelists” or “players in Stage 1”), or peer comparison. A request for one
named player's or team's stats must set includeTable=false, even though population still identifies
the entity type. Two named players can share one summary card without a population table unless the
user explicitly requests one. A requested result count (for example “top 3”, “bottom five”, or
“show 10 teams”) must be copied into limit and implies includeTable=true. Set limit=0 when the user
does not request a result count. When the user names a statistic, copy its exact identifier into stat.
Set order=asc for shortest/lowest/fewest requests and order=desc for longest/highest/most requests.
For top/best, leave order empty so the portal uses the statistic's natural best direction. For
bottom/worst, use the opposite of its natural direction (the statistic list marks lower-is-better
metrics). Leave order empty when no direction is explicit.
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
“defuses in 2026 for vct americas” => analysis, players.total-defuses, includeTable true, years [2026], competitions [VCT], regions [Americas].
“give me mada stats in Americas 2026 Stage 1” => analysis, players [mada], empty role/stat,
population players, includeTable false, years [2026], regions [Americas], splits [Stage 1].
“mada stats and a table of all Duelists in Stage 1” => analysis, players [mada], role Duelist,
population players, includeTable true, splits [Stage 1].
“best players in emea stage two 2025” => analysis, population players, includeTable true, years [2025], regions [EMEA], splits [Stage 2].
“top 3 players from vct americas stage 1 2026” => analysis, population players, includeTable true, limit 3, years [2026], competitions [VCT], regions [Americas], splits [Stage 1].
“compare aspas and zekken” => analysis, players [aspas, zekken], population players, includeTable false.
“show me all LOUD team stats” => analysis, view team-profile, teamTab overview, teams [LOUD],
population teams, includeTable false.
“show LOUD map picks and bans” => analysis, view team-profile, teamTab maps, teams [LOUD],
population teams, includeTable false.
“show me LOUD roster history” => analysis, view roster-history, teams [LOUD], population teams,
includeTable false, with empty player/stat/role/order fields.
“top 3 ACS players in Americas Stage 1 and top 5 eco teams in EMEA Stage 2, both in 2026” => two
intents: the first uses players.avg-acs, limit 3, Americas, Stage 1, 2026; the second uses
teams.eco-win-pct, limit 5, EMEA, Stage 2, 2026.
“compare aspas and zekken on rating and K/D in VCT 2026” => two intents with both players and the
shared VCT 2026 scope: one players.avg-rating card and one players.kd card.

Use empty strings/arrays for fields the user did not constrain, including view, teamTab, players,
teams, role, population, stat, and order. Use limit=0 when no count was requested. summary is a short confirmation of
what its card will open, including every applied filter. The root summary briefly confirms the whole plan.`
}

export async function onRequestPost({ request, env }) {
  if (!env?.AI?.run) return json({ error: 'Workers AI binding is not configured.' }, 503)

  const contentLength = Number(request.headers.get('content-length') || 0)
  if (contentLength > 8192) return json({ error: 'Request is too large.' }, 413)

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
      response_format: { type: 'json_schema', json_schema: INTENT_BATCH_SCHEMA },
      temperature: 0.1,
      max_tokens: 1800,
    })
    const parsed = typeof result?.response === 'string' ? JSON.parse(result.response) : result?.response
    const intents = sanitizeIntents(parsed)
    if (!intents.length) return json({ error: 'The model returned an invalid intent plan.' }, 502)
    return json({ intents, intent: intents[0], summary: typeof parsed?.summary === 'string' ? parsed.summary.slice(0, 240) : '', engine: 'workers-ai' })
  } catch {
    // Do not leak provider internals or prompt/model details to the public client.
    return json({ error: 'The intent model could not interpret this request.' }, 502)
  }
}

export function onRequestGet() {
  return json({ error: 'Method not allowed.' }, 405)
}
