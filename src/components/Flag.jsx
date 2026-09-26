import { useState } from 'react'

// Every bundled flag SVG has a 640x480 viewBox. Reserve that 4:3 footprint
// before the image loads so table columns do not resize when flags appear.
//
// Served from public/flags/ (fetched once by scraper/download_flags.py)
// rather than hotlinked from jsDelivr on every page view. A table like
// Players renders a flag per row -- dozens of distinct countries, each
// needing its own first-time round trip to a third-party CDN -- which is
// what made flags visibly pop in a beat after the rest of the table had
// already rendered. Serving them same-origin puts them on the same
// connection/cache as everything else, same fix already applied to
// TeamLogo's logos. A code with no local file (not in the dataset when
// download_flags.py last ran -- confirmed gaps include Belarus/Bulgaria) is
// meant to render nothing, same as a missing team logo -- but a 404'd <img>
// doesn't just disappear on its own; without an onError handler the browser
// draws its own broken-image box using the alt text, which for a flag
// sitting right next to a label showing that SAME country name (e.g.
// Select's option rows) read as the text rendering twice, overlapping.
// `failed` tracks that per-instance so a missing flag goes blank while its
// reserved footprint stays in place.
export default function Flag({ countryCode, countryName, size = 20 }) {
  const [failed, setFailed] = useState(false)
  if (!countryCode) return null
  if (failed) return <span className="inline-block shrink-0" style={{ height: size, width: size * 4 / 3 }} />
  return (
    <img
      src={`${import.meta.env.BASE_URL}flags/${countryCode.toLowerCase()}.svg`}
      alt={countryName || countryCode}
      title={countryName || countryCode}
      style={{ height: size, width: size * 4 / 3 }}
      className="rounded-sm shrink-0"
      loading="eager"
      onError={() => setFailed(true)}
    />
  )
}
