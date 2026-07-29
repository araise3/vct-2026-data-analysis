// flag-icons (flagicons.lipis.dev) ships each country as a real vector with
// its own baked-in aspect ratio (the 4x3 set), not a size we crop or stretch
// to fit. Only height is set here — width is left to the browser so every
// flag keeps its native proportions instead of being squashed or cropped.
export default function Flag({ countryCode, countryName, size = 20 }) {
  if (!countryCode) return null
  return (
    <img
      src={`https://cdn.jsdelivr.net/npm/flag-icons@7/flags/4x3/${countryCode.toLowerCase()}.svg`}
      alt={countryName || countryCode}
      title={countryName || countryCode}
      style={{ height: size, width: 'auto' }}
      className="rounded-sm shrink-0"
      loading="lazy"
    />
  )
}
