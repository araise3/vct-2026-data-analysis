/**
 * Palette and panel treatment for the Glicko-2 rating surfaces.
 *
 * These are exact hex values from a design spec rather than tailwind
 * tokens, and they're kept here as literals on purpose: the tokens in
 * tailwind.config.js are a site-wide elevation ladder shared by fifteen
 * pages, and bending them to match one component's spec would repaint
 * every one of those. Scoped here, the rating surfaces get the specified
 * palette and nothing else moves.
 *
 * The page background in the same spec (#0D1016) is within two hex points
 * of the site's existing `base` (#0d0f13) -- visually indistinguishable --
 * so the global token is deliberately left alone rather than repainting
 * every page to chase a difference nobody can see.
 */

export const RC = {
  panel: '#171B24',       // chart panel
  elevated: '#202633',    // raised surface inside the panel (pills, chips)
  border: '#303747',
  text: '#F4F7FB',        // primary
  textDim: '#92A0B5',     // secondary
  accent: '#FF4D67',      // reserved for rating data
  positive: '#52D6A3',
  warning: '#F6BD72',
  grid: 'rgba(148,163,184,0.10)',
}

/**
 * The panel itself. Inline style rather than tailwind classes because the
 * radius (20px), padding (24px 28px) and the layered shadow are all
 * off-scale values that would each need a one-off arbitrary-value class.
 *
 * The second shadow layer is the inset top highlight -- a 1px light line
 * along the top edge, which is what stops a dark panel on a dark page from
 * reading as a flat hole rather than a raised surface.
 */
export const PANEL_STYLE = {
  background: RC.panel,
  border: `1px solid ${RC.border}`,
  borderRadius: 20,
  padding: '24px 28px',
  boxShadow: '0 20px 50px rgba(0,0,0,0.28), inset 0 1px 0 rgba(255,255,255,0.05)',
}

/** Segmented-control pill, filled when selected. */
export function pillStyle(active) {
  return {
    background: active ? RC.elevated : 'transparent',
    color: active ? RC.text : RC.textDim,
    border: `1px solid ${active ? RC.border : 'transparent'}`,
  }
}
