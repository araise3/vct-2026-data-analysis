const MONTHS = {
  january: 0, jan: 0,
  february: 1, feb: 1,
  march: 2, mar: 2,
  april: 3, apr: 3,
  may: 4,
  june: 5, jun: 5,
  july: 6, jul: 6,
  august: 7, aug: 7,
  september: 8, sep: 8, sept: 8,
  october: 9, oct: 9,
  november: 10, nov: 10,
  december: 11, dec: 11,
}

const MONTH_PATTERN = Object.keys(MONTHS)
  .sort((a, b) => b.length - a.length)
  .join('|')

export function normalizeQuery(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase()
    .replace(/[’']/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
}

/** Damerau-Levenshtein distance, including the typo people make most: transposed letters. */
export function editDistance(left, right) {
  const a = normalizeQuery(left)
  const b = normalizeQuery(right)
  const rows = Array.from({ length: a.length + 1 }, () => Array(b.length + 1).fill(0))
  for (let i = 0; i <= a.length; i++) rows[i][0] = i
  for (let j = 0; j <= b.length; j++) rows[0][j] = j

  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      rows[i][j] = Math.min(
        rows[i - 1][j] + 1,
        rows[i][j - 1] + 1,
        rows[i - 1][j - 1] + cost,
      )
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        rows[i][j] = Math.min(rows[i][j], rows[i - 2][j - 2] + cost)
      }
    }
  }
  return rows[a.length][b.length]
}

function typoAllowance(length) {
  if (length <= 3) return 0
  if (length <= 5) return 1
  if (length <= 9) return 2
  return 3
}

/**
 * Returns a sortable score when a phrase occurs in a conversational query,
 * even with a small typo. Matching equal-sized word windows prevents a short
 * keyword from fuzzily matching an unrelated fragment inside a long query.
 */
export function fuzzyPhraseScore(query, phrase) {
  const haystack = normalizeQuery(query)
  const needle = normalizeQuery(phrase)
  if (!haystack || !needle) return Infinity
  if (haystack === needle) return 0
  if (` ${haystack} `.includes(` ${needle} `)) return 1

  const words = haystack.split(' ')
  const phraseWords = needle.split(' ')
  let best = Infinity
  for (let size = Math.max(1, phraseWords.length - 1); size <= phraseWords.length + 1; size++) {
    if (size > words.length) continue
    for (let i = 0; i <= words.length - size; i++) {
      const window = words.slice(i, i + size).join(' ')
      const distance = editDistance(window, needle)
      if (distance <= typoAllowance(Math.max(window.length, needle.length))) {
        best = Math.min(best, 5 + distance + Math.abs(window.length - needle.length) / 100)
      }
    }
  }
  return best
}

/**
 * Statistic vocabulary needs a stricter matcher than general search terms.
 * Requiring each word in a multi-word alias to match its counterpart prevents
 * compact labels such as "Player HS%" from accidentally matching prose such
 * as "players in", while still accepting small spelling mistakes.
 */
export function fuzzyStatisticScore(query, phrase) {
  const haystack = normalizeQuery(query)
  const needle = normalizeQuery(phrase)
  if (!haystack || !needle) return Infinity
  if (haystack === needle) return 0
  if (` ${haystack} `.includes(` ${needle} `)) return 1

  const words = haystack.split(' ')
  const phraseWords = needle.split(' ')
  let best = Infinity
  for (let i = 0; i <= words.length - phraseWords.length; i++) {
    const windowWords = words.slice(i, i + phraseWords.length)
    const tokenDistances = phraseWords.map((word, index) => editDistance(windowWords[index], word))
    const everyTokenMatches = tokenDistances.every((distance, index) => (
      distance <= typoAllowance(Math.max(windowWords[index].length, phraseWords[index].length))
    ))
    if (!everyTokenMatches) continue

    const distance = tokenDistances.reduce((sum, value) => sum + value, 0)
    if (distance <= typoAllowance(Math.max(windowWords.join(' ').length, needle.length))) {
      best = Math.min(best, 5 + distance)
    }
  }
  return best
}

function iso(year, month, day) {
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function localIso(date) {
  return iso(date.getFullYear(), date.getMonth(), date.getDate())
}

function lastDay(year, month) {
  return new Date(year, month + 1, 0).getDate()
}

function prettyDate(dateString) {
  if (!dateString) return ''
  const [year, month, day] = dateString.split('-').map(Number)
  return new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', year: 'numeric' })
    .format(new Date(year, month - 1, day))
}

function rangeLabel(from, to) {
  return from === to ? prettyDate(from) : `${prettyDate(from)} – ${prettyDate(to)}`
}

function validIso(value) {
  const match = /^(20\d{2})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return false
  const [, year, month, day] = match.map(Number)
  return month >= 1 && month <= 12 && day >= 1 && day <= lastDay(year, month - 1)
}

function applyRange(result, from, to) {
  if (!validIso(from) || !validIso(to)) return false
  if (from > to) [from, to] = [to, from]
  result.params.from = from
  result.params.to = to
  const fromYear = Number(from.slice(0, 4))
  const toYear = Number(to.slice(0, 4))
  if (fromYear === toYear) result.params.year = fromYear
  result.timeLabel = rangeLabel(from, to)
  return true
}

/** Convert natural time language into the same facet/date values FilterPanel uses. */
export function parseTimeframe(query, now = new Date()) {
  const text = normalizeQuery(query)
  const result = { params: {}, timeLabel: '', splitLabel: '', competitionLabel: '', regionLabel: '' }

  const competitionMatchers = [
    { pattern: /\b(?:ewc|esports world cup)\b/, value: 'EWC' },
    { pattern: /\b(?:vct|valorant champions tour)\b/, value: 'VCT' },
  ]
  const competition = competitionMatchers.find(({ pattern }) => pattern.test(text))
  if (competition) {
    result.params.competition = competition.value
    result.competitionLabel = competition.value
  }

  const regionMatchers = [
    { pattern: /\b(?:americas|north america|latin america|latam)\b/, value: 'Americas' },
    { pattern: /\b(?:emea|europe|european)\b/, value: 'EMEA' },
    { pattern: /\b(?:pacific|apac|asia pacific)\b/, value: 'Pacific' },
    { pattern: /\b(?:china|chinese)\b/, value: 'China' },
    { pattern: /\binternational\b/, value: 'International' },
  ]
  const region = regionMatchers.find(({ pattern }) => pattern.test(text))
  if (region) {
    result.params.region = region.value
    result.regionLabel = region.value
  }

  const splitMatchers = [
    { pattern: /\bkick ?off\b/, value: 'Kickoff' },
    { pattern: /\bstage (?:1|one)\b/, value: 'Stage 1' },
    { pattern: /\bstage (?:2|two)\b/, value: 'Stage 2' },
    { pattern: /\bchampions\b/, value: 'Champions' },
  ]
  const split = splitMatchers.find(({ pattern }) => pattern.test(text))
  if (split) {
    result.params.split = split.value
    result.splitLabel = split.value
  }

  // Fully explicit dates take precedence over every looser calendar phrase.
  const explicitDates = String(query).match(/20\d{2}-\d{2}-\d{2}/g)?.filter(validIso) || []
  if (explicitDates.length >= 2) {
    applyRange(result, explicitDates[0], explicitDates[1])
  } else if (explicitDates.length === 1) {
    applyRange(result, explicitDates[0], explicitDates[0])
  }

  if (!result.timeLabel) {
    const naturalRange = new RegExp(`\\b(?:from |between )?(${MONTH_PATTERN}) (\\d{1,2})(?: (20\\d{2}))? (?:to|through|until|and) (${MONTH_PATTERN}) (\\d{1,2}) (20\\d{2})\\b`).exec(text)
    if (naturalRange) {
      const fromYear = Number(naturalRange[3] || naturalRange[6])
      const toYear = Number(naturalRange[6])
      applyRange(
        result,
        iso(fromYear, MONTHS[naturalRange[1]], Number(naturalRange[2])),
        iso(toYear, MONTHS[naturalRange[4]], Number(naturalRange[5])),
      )
    }
  }

  if (!result.timeLabel) {
    const shortNaturalRange = new RegExp(`\\b(${MONTH_PATTERN}) (\\d{1,2}) (?:to|through|until) (\\d{1,2}) (20\\d{2})\\b`).exec(text)
    if (shortNaturalRange) {
      const month = MONTHS[shortNaturalRange[1]]
      const year = Number(shortNaturalRange[4])
      applyRange(result, iso(year, month, Number(shortNaturalRange[2])), iso(year, month, Number(shortNaturalRange[3])))
    }
  }

  if (!result.timeLabel) {
    const betweenMonths = new RegExp(`\\bbetween (${MONTH_PATTERN}) and (${MONTH_PATTERN}) (20\\d{2})\\b`).exec(text)
    if (betweenMonths) {
      const fromYear = Number(betweenMonths[3])
      const fromMonth = MONTHS[betweenMonths[1]]
      const toMonth = MONTHS[betweenMonths[2]]
      const toYear = toMonth < fromMonth ? fromYear + 1 : fromYear
      applyRange(result, iso(fromYear, fromMonth, 1), iso(toYear, toMonth, lastDay(toYear, toMonth)))
    }
  }

  if (!result.timeLabel) {
    const quarter = /\b(?:q([1-4])|(?:the )?(first|second|third|fourth) quarter)(?: of)? (20\d{2})\b/.exec(text)
    if (quarter) {
      const names = { first: 1, second: 2, third: 3, fourth: 4 }
      const number = Number(quarter[1] || names[quarter[2]])
      const year = Number(quarter[3])
      const fromMonth = (number - 1) * 3
      const toMonth = fromMonth + 2
      applyRange(result, iso(year, fromMonth, 1), iso(year, toMonth, lastDay(year, toMonth)))
    }
  }

  if (!result.timeLabel) {
    const half = /\b(?:first|1st|second|2nd) half(?: of)? (20\d{2})\b/.exec(text)
    if (half) {
      const second = /\b(?:second|2nd)\b/.test(half[0])
      const year = Number(half[1])
      applyRange(result, iso(year, second ? 6 : 0, 1), iso(year, second ? 11 : 5, second ? 31 : 30))
    }
  }

  if (!result.timeLabel) {
    const naturalDate = new RegExp(`\\b(?:on )?(${MONTH_PATTERN}) (\\d{1,2}) (20\\d{2})\\b`).exec(text)
    if (naturalDate) {
      const value = iso(Number(naturalDate[3]), MONTHS[naturalDate[1]], Number(naturalDate[2]))
      applyRange(result, value, value)
    }
  }

  if (!result.timeLabel) {
    const monthYear = new RegExp(`\\b(${MONTH_PATTERN}) (20\\d{2})\\b`).exec(text)
    if (monthYear) {
      const month = MONTHS[monthYear[1]]
      const year = Number(monthYear[2])
      applyRange(result, iso(year, month, 1), iso(year, month, lastDay(year, month)))
    }
  }

  if (!result.timeLabel) {
    const amountMatch = /\b(?:last|past|previous) (\d+) (day|week|month|year)s?\b/.exec(text)
    if (amountMatch) {
      const amount = Number(amountMatch[1])
      const unit = amountMatch[2]
      const end = new Date(now.getFullYear(), now.getMonth(), now.getDate())
      const start = new Date(end)
      if (unit === 'day') start.setDate(start.getDate() - amount + 1)
      if (unit === 'week') start.setDate(start.getDate() - amount * 7 + 1)
      if (unit === 'month') start.setMonth(start.getMonth() - amount)
      if (unit === 'year') start.setFullYear(start.getFullYear() - amount)
      applyRange(result, localIso(start), localIso(end))
    }
  }

  if (!result.timeLabel && /\b(?:last|past) week\b/.test(text)) {
    const end = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const start = new Date(end)
    start.setDate(start.getDate() - 6)
    applyRange(result, localIso(start), localIso(end))
  }

  if (!result.timeLabel && /\byesterday\b/.test(text)) {
    const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1)
    applyRange(result, localIso(day), localIso(day))
  }

  if (!result.timeLabel && /\btoday\b/.test(text)) {
    applyRange(result, localIso(now), localIso(now))
  }

  if (!result.timeLabel && /\blast month\b/.test(text)) {
    const year = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear()
    const month = now.getMonth() === 0 ? 11 : now.getMonth() - 1
    applyRange(result, iso(year, month, 1), iso(year, month, lastDay(year, month)))
  }

  if (!result.timeLabel && /\bthis month\b/.test(text)) {
    applyRange(result, iso(now.getFullYear(), now.getMonth(), 1), localIso(now))
  }

  if (!result.timeLabel && /\bthis year\b/.test(text)) {
    applyRange(result, iso(now.getFullYear(), 0, 1), localIso(now))
  }

  if (!result.timeLabel && /\blast year\b/.test(text)) {
    const year = now.getFullYear() - 1
    applyRange(result, iso(year, 0, 1), iso(year, 11, 31))
  }

  if (!result.timeLabel) {
    const yearMatch = /\b(20\d{2})\b/.exec(text)
    if (yearMatch) {
      result.params.year = Number(yearMatch[1])
      result.timeLabel = yearMatch[1]
    }
  }

  result.label = [result.timeLabel, result.competitionLabel, result.regionLabel, result.splitLabel].filter(Boolean).join(' · ')
  result.hasScope = Object.keys(result.params).length > 0
  return result
}

/** Add parsed scope without losing an existing stat/comparison query or hash. */
export function withScope(to, scope) {
  if (!scope?.hasScope) return to
  const hashIndex = to.indexOf('#')
  const hash = hashIndex >= 0 ? to.slice(hashIndex) : ''
  const beforeHash = hashIndex >= 0 ? to.slice(0, hashIndex) : to
  const queryIndex = beforeHash.indexOf('?')
  const path = queryIndex >= 0 ? beforeHash.slice(0, queryIndex) : beforeHash
  const params = new URLSearchParams(queryIndex >= 0 ? beforeHash.slice(queryIndex + 1) : '')
  for (const [key, value] of Object.entries(scope.params)) params.set(key, String(value))
  const query = params.toString()
  return `${path}${query ? `?${query}` : ''}${hash}`
}
