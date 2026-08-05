import eventLogos from '../lib/eventLogos.json'

export default function EventLogo({ event, size = 20 }) {
  const src = eventLogos[event]
  if (!src) return <span className="shrink-0" style={{ width: size, height: size }} />

  return (
    <img
      src={src}
      alt=""
      style={{ height: size, width: 'auto', maxWidth: size * 1.8 }}
      className="object-contain shrink-0"
      loading="lazy"
    />
  )
}
