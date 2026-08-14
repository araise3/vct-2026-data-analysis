import mapIcons from '../lib/mapIcons.json'

// mapIcons.json's icons are landscape thumbnails (valorant-api.com's own
// listViewIcon, ~2.7:1), not square like AgentIcon/TeamLogo -- sized by
// width only, height left to scale naturally (same reason Flag.jsx sizes
// by height only: Tailwind's preflight forces `img { height: auto }`,
// which silently overrides an explicit height attribute but not width).
export default function MapIcon({ map, width = 40, className = '' }) {
  const src = mapIcons[map]
  if (!src) return null

  return (
    <img
      src={src}
      alt={map}
      width={width}
      className={`object-cover shrink-0 rounded ${className}`}
      loading="lazy"
    />
  )
}
