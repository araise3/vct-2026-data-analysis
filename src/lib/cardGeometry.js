export const CARD_BOUNDS = {
  left: 16,
  top: 56,
  right: 16,
  maxHeight: 1400,
}

/** Resize from any edge while keeping the opposite edge anchored and the card on-canvas. */
export function resizeCardGeometry(card, edge, deltaX, deltaY, constraints, viewportWidth) {
  let left = card.x
  let top = card.y
  let right = card.x + card.width
  let bottom = card.y + card.height

  if (edge.includes('w')) left = Math.min(right - constraints.minWidth, Math.max(CARD_BOUNDS.left, left + deltaX))
  if (edge.includes('e')) right = Math.max(left + constraints.minWidth, Math.min(viewportWidth - CARD_BOUNDS.right, right + deltaX))
  if (edge.includes('n')) top = Math.min(bottom - constraints.minHeight, Math.max(CARD_BOUNDS.top, bottom - CARD_BOUNDS.maxHeight, top + deltaY))
  if (edge.includes('s')) bottom = Math.max(top + constraints.minHeight, Math.min(top + CARD_BOUNDS.maxHeight, bottom + deltaY))

  return { x: left, y: top, width: right - left, height: bottom - top }
}
