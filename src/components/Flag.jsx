// flag-icons (flagicons.lipis.dev) ships each country as a real vector with
// its own baked-in aspect ratio (the 4x3 set), not a size we crop or stretch
// to fit. Only height is set here — width is left to the browser so every
// flag keeps its native proportions instead of being squashed or cropped.
//
// Served from public/flags/ (fetched once by scraper/download_flags.py)
// rather than hotlinked from jsDelivr on every page view. A table like
// Players renders a flag per row -- dozens of distinct countries, each
// needing its own first-time round trip to a third-party CDN -- which is
// what made flags visibly pop in a beat after the rest of the table had
// already rendered. Serving them same-origin puts them on the same
// connection/cache as everything else, same fix already applied to
// TeamLogo's logos. A code with no local file (not in the dataset when
// download_flags.py last ran) renders nothing, same as a missing team logo.
export default function Flag({ countryCode, countryName, size = 20 }) {
  if (!countryCode) return null
  return (
    <img
      src={`${import.meta.env.BASE_URL}flags/${countryCode.toLowerCase()}.svg`}
      alt={countryName || countryCode}
      title={countryName || countryCode}
      style={{ height: size, width: 'auto' }}
      className="rounded-sm shrink-0"
      loading="lazy"
    />
  )
}
