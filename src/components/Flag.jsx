export default function Flag({ countryCode, countryName, size = 20 }) {
  if (!countryCode) return null
  return (
    <img
      src={`https://flagcdn.com/${countryCode}.svg`}
      alt={countryName || countryCode}
      title={countryName || countryCode}
      width={size}
      height={Math.round(size * 0.75)}
      className="object-contain rounded-sm shrink-0"
      loading="lazy"
    />
  )
}
