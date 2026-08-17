/**
 * Original vector icons for VCT's real trophies.
 *
 * These are NOT copies of Riot's own photographs or renders (those are
 * Riot's copyrighted assets and aren't hosted here). Each is drawn from
 * scratch as flat vector geometry, using the official multi-angle
 * turnaround renders published by the trophies' fabricator (Volpin Props)
 * and sculptor as shape reference for silhouette, proportion, structure
 * and palette. Working from turnarounds rather than a single lit hero
 * photo mattered: several "obvious" details turn out to be lighting, not
 * the object. The Champions cup in particular reads as "gold cup on a
 * purple crystal cone standing in a wire ring" in arena photos -- the
 * purple is colored stage light falling on what is really a black charred
 * cone, and the wire ring is the venue's display stand, not part of the
 * trophy at all.
 *
 * Proportions are stepped off the front elevation of each turnaround
 * rather than eyeballed, because the first pass got this visibly wrong:
 * a Masters cup drawn ~1.8x wider than tall in the bowl looked squat and
 * generic, where the real bowl is only ~1.1x wider than tall.
 *
 * Four shape FAMILIES, matching what the references actually show:
 *
 *  - Masters (MastersCup): every Masters trophy from Tokyo 2023 through
 *    London 2026 is the SAME sculpt -- a faceted silver goblet whose bowl
 *    is broken open along a jagged seam to reveal a geode, on a waisted
 *    stem carrying a second seam and the Valorant mark. Only the geode's
 *    contents change per event, which is why this is one component
 *    parameterised by `motif` rather than seven near-identical drawings.
 *  - Champions (ChampionsCup): a different sculpt, and unlike Masters it
 *    genuinely is reused UNCHANGED every year (verified across the 2023
 *    and 2024 references) -- an inverted gold cone veined with black
 *    cracks, a molten black neck gripping a gold Valorant cube, over a
 *    black charred cone shot through with gold.
 *  - LOCK//IN (LockInSpire): a one-off 2023 sculpt, unrelated to either --
 *    a crown of angular dark blades cradling a glowing green Valorant
 *    mark, on a tapered column and lit steel plinth.
 *  - Regional (RegionalCup): a deliberate GENERIC stand-in, not a
 *    reproduction. Riot commissions a bespoke design per region PER YEAR
 *    for league/stage titles -- checked directly: the 2024 VCT Americas
 *    trophy is a twisted vein-lit chalice while the 2025 EMEA Stage 2 one
 *    is floating cubes over a purple column, sharing nothing. That's ~50
 *    distinct designs with no honest single answer, so this draws the
 *    twisted-chalice archetype tinted per region, and the UI captions it
 *    as representative rather than exact.
 */

// Faceted-metal ramps. Stops alternate light/dark across the width rather
// than running smoothly, which is what reads as specular metal once the
// icon is only ~20px wide; a plain two-stop ramp just looks flat grey.
const SILVER = [
  ['0', '#5c616a'], ['0.13', '#e2e6ec'], ['0.3', '#a4aab5'],
  ['0.5', '#f6f8fb'], ['0.71', '#959ba6'], ['0.88', '#d6dbe3'], ['1', '#4f545c'],
]
const GOLD = [
  ['0', '#6d4d17'], ['0.14', '#f7dc93'], ['0.32', '#c9a13f'],
  ['0.53', '#ffeec2'], ['0.74', '#b8862c'], ['0.9', '#e8c97a'], ['1', '#5d4213'],
]
const STEEL = [
  ['0', '#3a3e45'], ['0.22', '#98a0ac'], ['0.5', '#2b2f36'],
  ['0.78', '#828a96'], ['1', '#33373e'],
]

function Ramp({ id, stops }) {
  return (
    <linearGradient id={id} x1="0" y1="0" x2="1" y2="0">
      {stops.map(([o, c]) => <stop key={o} offset={o} stopColor={c} />)}
    </linearGradient>
  )
}

/** The Valorant mark, reduced to a six-point angular star -- what the real
 * etched logo resolves to at this size. */
function Mark({ cx, cy, r, fill, opacity = 1 }) {
  const d = [
    [0, -1], [0.3, -0.34], [1, -0.5], [0.5, 0], [1, 0.5],
    [0.3, 0.34], [0, 1], [-0.3, 0.34], [-1, 0.5], [-0.5, 0], [-1, -0.5], [-0.3, -0.34],
  ].map(([x, y]) => `${(cx + x * r).toFixed(1)} ${(cy + y * r).toFixed(1)}`).join(' L ')
  return <path d={`M ${d} Z`} fill={fill} opacity={opacity} />
}

// --- Masters skeleton -------------------------------------------------
// Shared, because the sculpt genuinely is shared. 100x140 viewBox; the
// real piece is about twice as tall as it is wide, so the body only
// spans x 12..88 rather than filling the canvas.
const BOWL = 'M12 14 L88 14 L66 70 L34 70 Z'
const LOWER_CONE = 'M36 98 L64 98 L71 123 L29 123 Z'
// Jagged seam edges run past the viewBox so the clip, not the path,
// decides where they stop.
const GEODE = 'M-5 35 L4 28 L14 34 L24 27 L34 33 L44 26 L54 32 L64 27 L74 33 L84 28 L105 34 L105 80 L-5 80 Z'
const LOWER_GEODE = 'M-5 108 L8 103 L19 109 L30 103 L41 109 L52 103 L63 109 L74 103 L85 109 L105 104 L105 132 L-5 132 Z'

// --- Per-event geode contents ----------------------------------------
// Each is drawn around (50, 43) and then placed by MastersCup, so they
// can be authored in one consistent frame.

function MotifMask({ a, hi, lo }) {
  // Tokyo 2023 -- Yoru's oni mask as an angular crystal cluster.
  return (
    <>
      <path d="M30 41 L38 31 L47 36 L50 29 L53 36 L62 31 L70 41 L66 51 L57 57 L50 54 L43 57 L34 51 Z" fill={a} />
      <path d="M37 38 L46 36 L48 43 L39 46 Z" fill={hi} />
      <path d="M54 36 L63 38 L61 46 L52 43 Z" fill={lo} />
      <path d="M45 47 L55 47 L52 54 L48 54 Z" fill={lo} />
      <path d="M50 32 L53 37 L47 37 Z" fill={hi} />
    </>
  )
}

function MotifButterflies({ a, hi, lo }) {
  // Madrid 2024 -- a swarm of butterflies along the seam.
  const wings = [
    [32, 44, 6, lo], [41, 37, 7, a], [50, 44, 8, hi], [59, 37, 7, a],
    [68, 44, 6, lo], [45, 53, 6, a], [56, 53, 6, hi],
  ]
  return wings.map(([cx, cy, s, c], i) => (
    <g key={i} fill={c}>
      <path d={`M${cx} ${cy} L${cx - s} ${cy - s * 0.95} L${cx - s * 1.05} ${cy + s * 0.35} Z`} />
      <path d={`M${cx} ${cy} L${cx + s} ${cy - s * 0.95} L${cx + s * 1.05} ${cy + s * 0.35} Z`} />
    </g>
  ))
}

function MotifMaze({ a, hi, lo }) {
  // Shanghai 2024 -- the event's nested angular emblem.
  return (
    <>
      <path d="M50 26 L70 42 L64 48 L50 36 L36 48 L30 42 Z" fill={lo} />
      <path d="M50 36 L64 47 L59 53 L50 46 L41 53 L36 47 Z" fill={a} />
      <path d="M50 45 L58 52 L50 59 L42 52 Z" fill={hi} />
      <path d="M27 47 L32 51 L29 56 L24 51 Z" fill={a} />
      <path d="M73 47 L76 51 L71 56 L68 51 Z" fill={a} />
    </>
  )
}

function MotifPrism({ a, hi, lo, uid }) {
  // Bangkok 2025 -- the color-shift kite crystal, flanked by brackets.
  return (
    <>
      <defs>
        <linearGradient id={`${uid}-shift`} x1="0" y1="0" x2="0.6" y2="1">
          <stop offset="0" stopColor={hi} />
          <stop offset="0.5" stopColor={a} />
          <stop offset="1" stopColor={lo} />
        </linearGradient>
      </defs>
      <path d="M50 25 L63 43 L50 62 L37 43 Z" fill={`url(#${uid}-shift)`} />
      <path d="M50 25 L50 62 L37 43 Z" fill={hi} opacity="0.4" />
      <path d="M31 32 L38 35 L33 41 L36 49 L29 52 L25 41 Z" fill={lo} />
      <path d="M69 32 L75 41 L71 52 L64 49 L67 41 L62 35 Z" fill={lo} />
    </>
  )
}

function MotifShards({ a, hi, lo }) {
  // Toronto 2025 -- radsalt spikes fanning out of a pale seam.
  const spikes = [
    [33, 47, 28, 21, 38, 28], [40, 45, 37, 15, 46, 24], [48, 43, 49, 12, 55, 22],
    [55, 45, 59, 15, 63, 25], [62, 47, 68, 20, 71, 30], [69, 50, 76, 28, 77, 37],
  ]
  return (
    <>
      <path d="M26 48 L35 40 L46 46 L57 39 L69 46 L76 41 L76 60 L26 60 Z" fill={lo} />
      {spikes.map(([x1, y1, x2, y2, x3, y3], i) => (
        <path key={i} d={`M${x1} ${y1} L${x2} ${y2} L${x3} ${y3} Z`} fill={i % 2 ? hi : a} />
      ))}
      <path d="M38 51 L52 47 L59 54 L43 58 Z" fill={hi} opacity="0.55" />
    </>
  )
}

function MotifRings({ a, hi, lo, uid }) {
  // Santiago 2026 -- the illuminated concentric core.
  return (
    <>
      <defs>
        <linearGradient id={`${uid}-ring`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={hi} />
          <stop offset="1" stopColor={a} />
        </linearGradient>
      </defs>
      <circle cx="50" cy="43" r="16" fill="none" stroke={`url(#${uid}-ring)`} strokeWidth="3.4" />
      <circle cx="50" cy="43" r="10.5" fill="none" stroke={a} strokeWidth="2.8" />
      <circle cx="50" cy="43" r="5.6" fill="none" stroke={hi} strokeWidth="2.6" />
      <circle cx="50" cy="43" r="2.1" fill={hi} />
      <path d="M31 29 L42 26 L38 34 Z" fill={lo} />
      <path d="M69 57 L59 61 L62 53 Z" fill={lo} />
      <path d="M70 29 L74 38 L65 34 Z" fill={a} />
    </>
  )
}

function MotifOrb({ a, hi, lo }) {
  // London 2026 -- a cracked teal core ringed by crystal chunks.
  const chunks = [
    [35, 30, 5.5, lo], [43, 25, 5, lo], [52, 24, 4.5, a], [61, 27, 5.5, a],
    [68, 34, 5, hi], [71, 43, 4.5, hi], [30, 39, 4.5, a], [34, 52, 5, hi],
    [43, 58, 4.5, hi], [64, 54, 5, a],
  ]
  return (
    <>
      <circle cx="50" cy="42" r="13" fill={hi} />
      <circle cx="45.5" cy="37.5" r="5.5" fill="#ffffff" opacity="0.22" />
      <path d="M43 33 L49 40 L44 45 L51 50 L47 55" fill="none" stroke="#0b3a39" strokeWidth="1.3" strokeLinecap="round" />
      {chunks.map(([cx, cy, s, c], i) => (
        <path key={i} d={`M${cx} ${cy - s} L${cx + s} ${cy} L${cx} ${cy + s} L${cx - s} ${cy} Z`} fill={c} />
      ))}
    </>
  )
}

const MOTIFS = {
  mask: MotifMask,
  butterflies: MotifButterflies,
  maze: MotifMaze,
  prism: MotifPrism,
  shards: MotifShards,
  rings: MotifRings,
  orb: MotifOrb,
}

/**
 * The shared Masters goblet. `rock` is the geode matrix (near-black on
 * every event except Toronto, whose seam is pale radsalt); `accent` /
 * `accentHi` / `accentLo` are the crystal palette; `motif` picks what is
 * growing in the seam.
 */
export function MastersCup({
  uid = 'm', accent = '#8b6cf2', accentHi = '#c3aef8', accentLo = '#553a9e',
  rock = '#1b1d23', motif = 'mask', size = 34,
}) {
  const Motif = MOTIFS[motif] || MotifMask
  const ag = `url(#${uid}-ag)`
  return (
    <svg viewBox="0 0 100 140" width={(size * 100) / 140} height={size} aria-hidden="true">
      <defs>
        <Ramp id={`${uid}-ag`} stops={SILVER} />
        <clipPath id={`${uid}-bowl`}><path d={BOWL} /></clipPath>
        <clipPath id={`${uid}-cone`}><path d={LOWER_CONE} /></clipPath>
      </defs>

      {/* Foot */}
      <path d="M29 121 L71 121 L84 134 L16 134 Z" fill={ag} />
      <path d="M29 121 L71 121 L68 125 L32 125 Z" fill="#ffffff" opacity="0.18" />
      <path d="M16 134 L84 134 L82 136 L18 136 Z" fill="#000000" opacity="0.4" />

      {/* Lower cone + second seam */}
      <path d={LOWER_CONE} fill={ag} />
      <g clipPath={`url(#${uid}-cone)`}>
        <path d={LOWER_GEODE} fill={rock} />
        <Mark cx={50} cy={115} r={7} fill={accent} />
      </g>

      {/* Waisted stem */}
      <path d="M36 81 C33 89 33 93 37 100 L63 100 C67 93 67 89 64 81 Z" fill={ag} />
      <path d="M41 82 C38 89 38 93 41 99 L45 99 C42 93 42 89 44 82 Z" fill="#ffffff" opacity="0.22" />

      {/* Collar */}
      <path d="M34 69 L66 69 L63 83 L37 83 Z" fill={ag} />
      <path d="M34 69 L66 69 L64.5 73 L35.5 73 Z" fill="#000000" opacity="0.2" />

      {/* Bowl */}
      <path d={BOWL} fill={ag} />
      <g clipPath={`url(#${uid}-bowl)`}>
        <path d={GEODE} fill={rock} />
        {/* Motifs are authored around (50,43); nudge them down into the
            seam. Scaled only slightly, and deliberately allowed to run
            past the bowl's edge -- the clip crops them, which is what
            makes the crystal read as filling the whole broken seam the
            way it does on the real sculpt. Scaling them down to fit
            entirely inside left a small blob floating in a dark band. */}
        <g transform="translate(50 46) scale(0.95) translate(-50 -43)">
          <Motif a={accent} hi={accentHi} lo={accentLo} uid={uid} />
        </g>
        {/* Panel seams from the sculpt, kept faint. */}
        <path d="M64 14 L78 27" stroke="#ffffff" strokeWidth="1" opacity="0.3" fill="none" />
        <path d="M26 14 L19 22" stroke="#ffffff" strokeWidth="1" opacity="0.22" fill="none" />
      </g>

      {/* Rim: bright near lip in front of the dark cup interior. */}
      <path d="M12 14 Q50 7 88 14 Q50 21 12 14 Z" fill="#2b2e35" />
      <path d="M12 14 Q50 7 88 14 Q50 11 12 14 Z" fill="#eef1f6" />
      <path d="M34 70 L66 70 L66 71.5 L34 71.5 Z" fill="#000000" opacity="0.28" />
    </svg>
  )
}

/**
 * Valorant Champions -- one fixed sculpt reused every year, so no
 * per-event props. See the file comment on why the arena-photo "purple
 * base / wire ring" reading is wrong.
 */
export function ChampionsCup({ uid = 'c', size = 34 }) {
  const au = `url(#${uid}-au)`
  return (
    <svg viewBox="0 0 100 140" width={(size * 100) / 140} height={size} aria-hidden="true">
      <defs>
        <Ramp id={`${uid}-au`} stops={GOLD} />
        <clipPath id={`${uid}-cone`}><path d="M13 15 L87 15 L56 68 L44 68 Z" /></clipPath>
        <clipPath id={`${uid}-base`}><path d="M43 86 L57 86 L86 133 L14 133 Z" /></clipPath>
      </defs>

      {/* Charred base cone, gold running up through the cracks. */}
      <path d="M43 86 L57 86 L86 133 L14 133 Z" fill="#151419" />
      <g clipPath={`url(#${uid}-base)`}>
        <path d="M50 87 L53 99 L46 109 L53 120 L49 133" fill="none" stroke="#c9a13f" strokeWidth="1.7" strokeLinecap="round" />
        <path d="M53 99 L64 107 L61 119 L69 133" fill="none" stroke="#a8842f" strokeWidth="1.4" strokeLinecap="round" />
        <path d="M46 109 L34 117 L31 133" fill="none" stroke="#a8842f" strokeWidth="1.4" strokeLinecap="round" />
        <path d="M64 107 L73 114" fill="none" stroke="#8a6b24" strokeWidth="1.1" strokeLinecap="round" />
        <path d="M43 86 L49 86 L26 133 L14 133 Z" fill="#ffffff" opacity="0.06" />
        <path d="M14 133 L86 133 L86 135 L14 135 Z" fill="#000000" opacity="0.5" />
      </g>

      {/* Molten black neck. */}
      <path d="M41 62 Q45 66 43 73 Q41 80 46 86 L41 84 Q35 76 37 69 Z" fill="#151419" />
      <path d="M59 62 Q55 66 57 73 Q59 80 54 86 L59 84 Q65 76 63 69 Z" fill="#151419" />
      <path d="M43 64 L57 64 L56 75 L44 75 Z" fill="#151419" />

      {/* Gold cube gripped by the neck. */}
      <path d="M50 66 L63 78 L50 90 L37 78 Z" fill={au} />
      <path d="M50 66 L63 78 L50 90 Z" fill="#000000" opacity="0.24" />
      <Mark cx={50} cy={78} r={6.5} fill="#3a2c0c" opacity="0.75" />

      {/* Inverted gold cone. */}
      <path d="M13 15 L87 15 L56 68 L44 68 Z" fill={au} />
      <g clipPath={`url(#${uid}-cone)`}>
        <path d="M50 15 L47 28 L55 38 L48 49 L53 60 L49 68" fill="none" stroke="#0f0e11" strokeWidth="2.1" strokeLinecap="round" />
        <path d="M47 28 L34 25 L25 15" fill="none" stroke="#0f0e11" strokeWidth="1.8" strokeLinecap="round" />
        <path d="M55 38 L68 31 L74 15" fill="none" stroke="#0f0e11" strokeWidth="1.8" strokeLinecap="round" />
        <path d="M48 49 L38 44 L31 31" fill="none" stroke="#0f0e11" strokeWidth="1.5" strokeLinecap="round" />
        <path d="M53 60 L62 52 L64 42" fill="none" stroke="#0f0e11" strokeWidth="1.2" strokeLinecap="round" />
        <path d="M34 25 L37 15" fill="none" stroke="#0f0e11" strokeWidth="1.1" strokeLinecap="round" />
        <path d="M62 52 L70 48" fill="none" stroke="#0f0e11" strokeWidth="1" strokeLinecap="round" />
      </g>

      {/* Rim. */}
      <path d="M13 15 Q50 8 87 15 Q50 22 13 15 Z" fill="#4a3712" />
      <path d="M13 15 Q50 8 87 15 Q50 12 13 15 Z" fill="#ffeec2" />
    </svg>
  )
}

/** LOCK//IN São Paulo 2023 -- a one-off angular spire. */
export function LockInSpire({ uid = 'l', size = 34 }) {
  const glow = '#25e07f'
  return (
    <svg viewBox="0 0 100 140" width={(size * 100) / 140} height={size} aria-hidden="true">
      <defs>
        <Ramp id={`${uid}-steel`} stops={STEEL} />
        <Ramp id={`${uid}-plinth`} stops={[['0', '#565b64'], ['0.2', '#d8dde5'], ['0.5', '#8a909b'], ['0.8', '#c9cfd8'], ['1', '#4a4f57']]} />
      </defs>

      {/* Plinth. */}
      <path d="M22 118 L78 118 L84 134 L16 134 Z" fill={`url(#${uid}-plinth)`} />
      <path d="M22 118 L78 118 L77 122 L23 122 Z" fill="#ffffff" opacity="0.24" />
      <path d="M24 112 L76 112 L78 119 L22 119 Z" fill={glow} />
      <path d="M24 112 L76 112 L75 114.5 L25 114.5 Z" fill="#a6ffd3" />

      {/* Tapered column. */}
      <path d="M37 50 L63 50 L58 114 L42 114 Z" fill={`url(#${uid}-steel)`} />
      <path d="M37 50 L48 50 L46 114 L42 114 Z" fill="#000000" opacity="0.3" />
      <path d="M54 50 L63 50 L58 114 L54 114 Z" fill="#ffffff" opacity="0.12" />
      <path d="M40 66 L60 60" stroke="#000000" strokeWidth="1.4" opacity="0.35" fill="none" />
      <path d="M41 88 L59 82" stroke="#000000" strokeWidth="1.4" opacity="0.3" fill="none" />

      {/* Crown of blades. The real piece is near-black anodised metal,
          but drawn at its true value it dissolved into this site's dark
          background -- so each blade is a lit steel face with a darker
          inner facet, which is how the reference renders actually read
          once there's a highlight on them. */}
      <path d="M16 44 L23 12 L33 24 L34 52 Z" fill={`url(#${uid}-steel)`} />
      <path d="M20 24 L23 12 L29 21 L27 40 Z" fill="#0f1116" opacity="0.55" />
      <path d="M84 44 L77 12 L67 24 L66 52 Z" fill={`url(#${uid}-steel)`} />
      <path d="M80 24 L77 12 L71 21 L73 40 Z" fill="#0f1116" opacity="0.45" />
      <path d="M33 24 L40 7 L47 21 L45 54 L34 52 Z" fill={`url(#${uid}-steel)`} />
      <path d="M36 25 L40 7 L44 20 L42 50 Z" fill="#0f1116" opacity="0.5" />
      <path d="M67 24 L60 7 L53 21 L55 54 L66 52 Z" fill={`url(#${uid}-steel)`} />
      <path d="M64 25 L60 7 L56 20 L58 50 Z" fill="#0f1116" opacity="0.4" />
      <path d="M47 21 L50 5 L53 21 L54 54 L46 54 Z" fill={`url(#${uid}-steel)`} />
      <path d="M48.5 22 L50 5 L51.5 22 L52 52 L48 52 Z" fill="#0f1116" opacity="0.45" />

      {/* Glowing mark held in the crown. */}
      <Mark cx={50} cy={32} r={16} fill={glow} />
      <Mark cx={50} cy={32} r={8} fill="#c8ffe6" />
      <path d="M27 16 L35 22 L31 32 Z" fill={glow} opacity="0.8" />
      <path d="M73 16 L65 22 L69 32 Z" fill={glow} opacity="0.8" />
    </svg>
  )
}

/**
 * Generic regional league/stage trophy, tinted per region. Explicitly a
 * stand-in rather than any one real trophy -- see the file comment.
 */
export function RegionalCup({ uid = 'r', accent = '#f2683c', size = 34 }) {
  const ag = `url(#${uid}-ag)`
  return (
    <svg viewBox="0 0 100 140" width={(size * 100) / 140} height={size} aria-hidden="true">
      <defs>
        <Ramp id={`${uid}-ag`} stops={SILVER} />
        <clipPath id={`${uid}-cup`}><path d="M14 16 L86 16 L62 102 L38 102 Z" /></clipPath>
      </defs>

      {/* Pedestal. */}
      <path d="M30 124 L70 124 L76 134 L24 134 Z" fill={ag} />
      <path d="M31 113 L69 113 L70 124 L30 124 Z" fill={ag} />
      <path d="M31 117 L69 117 L69 119.5 L31 119.5 Z" fill={accent} />
      <path d="M38 100 L62 100 L69 114 L31 114 Z" fill={ag} />

      {/* Flared, twisted chalice. */}
      <path d="M14 16 L86 16 L62 102 L38 102 Z" fill={ag} />
      <g clipPath={`url(#${uid}-cup)`}>
        {/* Veins following the twist. */}
        <path d="M19 20 L38 40 L29 62 L44 84 L40 102" fill="none" stroke={accent} strokeWidth="2.8" strokeLinecap="round" />
        <path d="M50 16 L43 38 L58 56 L49 78 L57 102" fill="none" stroke={accent} strokeWidth="2.8" strokeLinecap="round" />
        <path d="M81 20 L64 38 L72 60 L61 76" fill="none" stroke={accent} strokeWidth="2.4" strokeLinecap="round" />
        <path d="M30 30 L47 25" fill="none" stroke={accent} strokeWidth="1.7" strokeLinecap="round" />
        <path d="M55 46 L71 45" fill="none" stroke={accent} strokeWidth="1.7" strokeLinecap="round" />
        <path d="M36 70 L52 68" fill="none" stroke={accent} strokeWidth="1.5" strokeLinecap="round" />
        {/* Facet shading. */}
        <path d="M14 16 L33 16 L40 102 L38 102 Z" fill="#000000" opacity="0.18" />
        <path d="M63 16 L78 16 L58 102 L53 102 Z" fill="#ffffff" opacity="0.14" />
      </g>

      {/* Broken crown -- deliberately irregular. A row of equal triangles
          read as comb teeth in the first pass; the real rim is a shattered
          edge, so peak heights and spacings all differ. */}
      <path
        d="M14 18 L18 5 L23 16 L28 9 L33 19 L40 4 L45 15 L50 8 L54 20 L60 6 L65 17 L71 10 L75 19 L80 7 L86 18 Z"
        fill={ag}
      />
      <path d="M18 5 L21 11 L23 16 Z" fill="#ffffff" opacity="0.32" />
      <path d="M40 4 L43 10 L45 15 Z" fill="#ffffff" opacity="0.32" />
      <path d="M60 6 L63 12 L65 17 Z" fill="#ffffff" opacity="0.28" />
      <path d="M80 7 L83 13 L86 18 Z" fill="#ffffff" opacity="0.28" />
    </svg>
  )
}

// Region tints for RegionalCup -- approximations of each league's own
// brand accent, used only so four otherwise-identical stand-ins are
// distinguishable at a glance.
const REGION_TINT = {
  Americas: '#f2683c',
  EMEA: '#b4ff39',
  Pacific: '#ff4fa3',
  China: '#ffc93c',
  International: '#8b6cf2',
}

// Bespoke art, keyed by event id (events.json). Every entry was drawn
// against that trophy's own reference turnaround.
const BESPOKE = {
  1188: { C: LockInSpire },                                                                                          // LOCK//IN São Paulo 2023
  1494: { C: MastersCup, p: { motif: 'mask', accent: '#8b6cf2', accentHi: '#cbb9fb', accentLo: '#4d3391' } },        // Masters Tokyo 2023
  1921: { C: MastersCup, p: { motif: 'butterflies', accent: '#7b5ce0', accentHi: '#bda9f7', accentLo: '#4a3491' } }, // Masters Madrid 2024
  1999: { C: MastersCup, p: { motif: 'maze', accent: '#9b6ff0', accentHi: '#cfb7fc', accentLo: '#5b3aa8' } },        // Masters Shanghai 2024
  2281: { C: MastersCup, p: { motif: 'prism', accent: '#f0a3c2', accentHi: '#a9e08a', accentLo: '#e0669e' } },       // Masters Bangkok 2025
  2282: { C: MastersCup, p: { motif: 'shards', accent: '#e05fb4', accentHi: '#f9c2e2', accentLo: '#b9bdcd', rock: '#c9ccd8' } }, // Masters Toronto 2025
  2760: { C: MastersCup, p: { motif: 'rings', accent: '#3fc46e', accentHi: '#ffd23c', accentLo: '#1f7a45' } },       // Masters Santiago 2026
  2765: { C: MastersCup, p: { motif: 'orb', accent: '#5a4fe0', accentHi: '#2fd6c4', accentLo: '#3a2fa8' } },         // Masters London 2026
  1657: { C: ChampionsCup }, // Valorant Champions 2023
  2097: { C: ChampionsCup }, // Valorant Champions 2024
  2283: { C: ChampionsCup }, // Valorant Champions 2025
}

/**
 * Picks the art for one won trophy. `exact` reports whether this is that
 * event's real trophy or the region-tinted stand-in, so the UI can caption
 * a generic icon honestly rather than implying a likeness it doesn't have.
 */
export function resolveTrophyArt(trophy) {
  const hit = BESPOKE[trophy.eventId]
  if (hit) return { Component: hit.C, props: hit.p || {}, exact: true }
  return {
    Component: RegionalCup,
    props: { accent: REGION_TINT[trophy.region] || REGION_TINT.International },
    exact: false,
  }
}
