/**
 * Shared palette and panel treatment for the Glicko-2 rating surfaces.
 * Kept as literals because these values are also consumed by inline SVG and
 * canvas styles that cannot resolve Tailwind tokens.
 */

export const RC = {
  panel: '#141619',
  elevated: '#1B1E22',
  border: '#2D3238',
  text: '#F0F1F3',
  textDim: '#9AA0A8',
  accent: '#78A7D3',
  positive: '#65C48B',
  warning: '#D9AA5B',
  grid: 'rgba(210,220,211,0.11)',
}

/**
 * The panel itself. Inline style rather than tailwind classes because the
 * padding and shadow are off-scale values that would otherwise need several
 * arbitrary Tailwind classes at every call site.
 */
export const PANEL_STYLE = {
  background: RC.panel,
  border: `1px solid ${RC.border}`,
  borderRadius: 8,
  padding: '20px 22px',
  boxShadow: '0 1px 2px rgba(0,0,0,0.28)',
}

/** Segmented-control pill, filled when selected. */
export function pillStyle(active) {
  return {
    background: active ? RC.elevated : 'transparent',
    color: active ? RC.text : RC.textDim,
    border: `1px solid ${active ? RC.border : 'transparent'}`,
  }
}
