// The site's signature motif: a compact strip of squares representing
// round-by-round wins/losses, exactly how VLR's own round history works
// and how VALORANT itself structures a map. Reused anywhere "recent form"
// or a specific map's flow is referenced, rather than as decoration.
export default function RoundSquares({ results, size = 7 }) {
  if (!results || results.length === 0) return null
  return (
    <div className="flex gap-[3px] items-center">
      {results.map((won, i) => (
        <span
          key={i}
          className="rounded-[3px]"
          style={{
            width: size,
            height: size,
            backgroundColor: won ? '#4ac97e' : '#4a2b28',
            opacity: won ? 1 : 0.7,
          }}
          title={won ? 'Round won' : 'Round lost'}
        />
      ))}
    </div>
  )
}
