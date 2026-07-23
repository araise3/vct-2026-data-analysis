import { forwardRef } from 'react'
import teamLogos from '../lib/teamLogos.json'

/**
 * The exportable stat graphic, styled after the HLTV/@statsmeister
 * infographics: dark navy panel, one row per entity, logo tile + flag,
 * a small "N rounds" secondary column and a huge value on the right.
 * Rank 1 gets a lighter row and a yellow number; everyone else gets the
 * pale-green treatment.
 *
 * Render-only: everything it shows arrives via props, so the same tree
 * is used both for the live preview and for the PNG snapshot.
 *
 * External images (team logo CDN, flag CDN) are routed through the
 * wsrv.nl image proxy, which serves permissive CORS headers -- without
 * that, html-to-image can't inline them and exported PNGs would come out
 * with blank tiles whenever the origin CDN doesn't send
 * Access-Control-Allow-Origin.
 */

export function corsSafe(url) {
  if (!url) return url
  if (url.startsWith('/') || url.startsWith('data:')) return url
  return `https://wsrv.nl/?url=${encodeURIComponent(url)}`
}

const CARD_W = 1080

// Palette lifted from the reference graphics rather than the site's own
// tokens -- these cards are meant to drop into a Twitter feed next to the
// originals, so they keep the navy/green/yellow language.
const C = {
  bg: '#0d1420',
  rowA: '#101a29',
  rowB: '#15202f',
  rowTop: '#1b2940',
  tile: 'rgba(255,255,255,0.07)',
  ink: '#f5f7fa',
  dim: '#8b98ab',
  value: '#cdeaa5',
  valueTop: '#ffe94a',
  accent: '#FF4655',
}

function LogoTile({ team, size }) {
  const entry = teamLogos[team]
  return (
    <div
      style={{
        width: size,
        height: size,
        background: C.tile,
        borderRadius: 12,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
      }}
    >
      {entry?.logo ? (
        <img
          src={corsSafe(entry.logo)}
          alt={team}
          crossOrigin="anonymous"
          style={{ width: '78%', height: '78%', objectFit: 'contain' }}
        />
      ) : (
        <span style={{ color: C.dim, fontWeight: 700, fontSize: size * 0.34 }}>
          {team?.slice(0, 2).toUpperCase()}
        </span>
      )}
    </div>
  )
}

const StatCard = forwardRef(function StatCard(
  { title, subtitle, kicker, credit, rows, valueFormat },
  ref
) {
  return (
    <div
      ref={ref}
      style={{
        width: CARD_W,
        background: `linear-gradient(160deg, ${C.bg} 0%, #0a101a 100%)`,
        fontFamily: '"Plus Jakarta Sans", ui-sans-serif, sans-serif',
        color: C.ink,
        padding: '0 0 6px 0',
      }}
    >
      {/* header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          padding: '30px 36px 24px',
        }}
      >
        <div style={{ display: 'flex', gap: 18, alignItems: 'center' }}>
          <div
            style={{
              width: 74,
              height: 74,
              borderRadius: 14,
              background: C.accent,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            {/* Simple spike glyph */}
            <svg viewBox="0 0 24 24" width="44" height="44" fill="none">
              <path d="M3 5l8 10v4h2v-4l8-10-4 1-4 6h-2L7 6 3 5z" fill="#fff" />
            </svg>
          </div>
          <div>
            <div
              style={{
                color: '#7fb2ff',
                fontWeight: 700,
                fontSize: 21,
                letterSpacing: 0.5,
                textTransform: 'uppercase',
              }}
            >
              {kicker}
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
              <span
                style={{
                  fontWeight: 800,
                  fontSize: 44,
                  letterSpacing: 0.5,
                  textTransform: 'uppercase',
                  lineHeight: 1.1,
                }}
              >
                {title}
              </span>
              {subtitle && (
                <span style={{ color: C.dim, fontWeight: 700, fontSize: 19 }}>
                  {subtitle}
                </span>
              )}
            </div>
          </div>
        </div>
        <div
          style={{
            textAlign: 'right',
            color: C.dim,
            fontSize: 17,
            fontWeight: 600,
            lineHeight: 1.5,
            paddingTop: 4,
            whiteSpace: 'pre-line',
          }}
        >
          {credit}
        </div>
      </div>

      {/* rows */}
      {rows.map((r, i) => {
        const top = i === 0
        return (
          <div
            key={r.name}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 22,
              padding: top ? '20px 36px' : '14px 36px',
              background: top ? C.rowTop : i % 2 ? C.rowB : C.rowA,
            }}
          >
            <LogoTile team={r.team} size={top ? 88 : 72} />
            {r.countryCode && (
              <img
                src={corsSafe(`https://flagcdn.com/${r.countryCode}.svg`)}
                alt={r.countryName || r.countryCode}
                crossOrigin="anonymous"
                style={{
                  width: 40,
                  height: 30,
                  objectFit: 'cover',
                  borderRadius: 4,
                  flexShrink: 0,
                }}
              />
            )}
            <div
              style={{
                fontWeight: 700,
                fontSize: top ? 42 : 36,
                flex: 1,
                minWidth: 0,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {r.name}
            </div>
            <div
              style={{
                textAlign: 'right',
                lineHeight: 1.15,
                flexShrink: 0,
                marginRight: 6,
              }}
            >
              <div style={{ fontWeight: 800, fontSize: 24 }}>
                {r.secondary?.value?.toLocaleString()}
              </div>
              <div style={{ color: C.dim, fontWeight: 600, fontSize: 19 }}>
                {r.secondary?.label}
              </div>
            </div>
            <div
              style={{
                fontWeight: 800,
                fontSize: top ? 72 : 62,
                color: top ? C.valueTop : C.value,
                width: 250,
                textAlign: 'right',
                flexShrink: 0,
                letterSpacing: -1,
              }}
            >
              {valueFormat(r.value)}
            </div>
          </div>
        )
      })}
    </div>
  )
})

export default StatCard
export { CARD_W }
