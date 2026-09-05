import mapImages from '../lib/mapIcons.json'

/**
 * The map assets are 456x100 panoramic list artwork, so they belong in a
 * wide contextual banner rather than being squeezed into square/icon slots.
 */
export default function MapArtwork({ map, eyebrow, detail, className = '' }) {
  const src = mapImages[map]
  if (!src) return null

  return (
    <figure className={`relative m-0 overflow-hidden rounded-md border border-hairline bg-surface2 ${className}`}>
      <img
        src={src}
        alt={`${map} map artwork`}
        width={456}
        height={100}
        className="block h-auto w-full"
        loading="lazy"
      />
      <div
        className="absolute inset-0"
        style={{ background: 'linear-gradient(90deg, rgba(12,13,15,.82) 0%, rgba(12,13,15,.24) 58%, rgba(12,13,15,.08) 100%)' }}
      />
      <figcaption className="absolute inset-y-0 left-0 flex max-w-[78%] flex-col justify-center px-4 py-3">
        {eyebrow && <span className="text-[9px] font-semibold uppercase tracking-[0.14em] text-white/65">{eyebrow}</span>}
        <span className="mt-0.5 text-lg font-semibold tracking-[-0.02em] text-white">{map}</span>
        {detail && <span className="mt-0.5 text-[10px] text-white/70">{detail}</span>}
      </figcaption>
    </figure>
  )
}
