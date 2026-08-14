import { tv } from 'tailwind-variants'

/**
 * The one toggle-pill visual language for every "row of selectable
 * options" pattern in the app (FacetGroup's facet values, StageTabs'
 * stage/phase tabs, FilterChips, MultiFilterChips). Previously each of
 * those hand-rolled the same `px-3 py-1.5 rounded-2xl ... border` string
 * independently — this is that string, once, with actual depth added:
 * inactive chips get a faint cast shadow that lifts on hover, active chips
 * get an accent glow (echoing Button's active-state glow) instead of the
 * flat `bg-accent/20` fill alone, so "selected" reads as raised/lit rather
 * than just recolored.
 */
const chip = tv({
  // transition-[background-color,...] rather than transition-all: `all`
  // was also watching background-image (which can't interpolate between
  // two gradients anyway, so it just snaps) and made toggling off feel like
  // it lagged behind the click while box-shadow/border kept easing for the
  // full duration after the fill had already jumped. Explicit properties +
  // a shorter 100ms duration reads as immediate again.
  base: 'rounded-2xl text-xs font-semibold border transition-[background-color,border-color,box-shadow,color,transform] duration-100 ease-out cursor-pointer select-none focus-visible:outline-none focus-visible:shadow-focus-ring',
  variants: {
    active: {
      // A real gradient fill (not a translucent tint) so an active chip
      // reads as a small raised button, matching Button's own primary
      // treatment. Muted slate-blue rather than accent red -- red is
      // reserved for primary CTAs/brand elsewhere; a selection state on
      // every active facet chip doesn't need to shout as loud.
      true: 'bg-grad-selected text-white border-selected-bright/50 shadow-[0_0_0_1px_rgb(124_143_209_/_0.25),0_4px_12px_-2px_rgb(91_110_174_/_0.4),inset_0_1px_0_0_rgb(255_255_255_/_0.15)]',
      false:
        'bg-surface2 text-muted border-hairline shadow-depth-xs hover:text-ink hover:border-muted hover:bg-surface3 hover:-translate-y-0.5 hover:shadow-depth-sm',
    },
    size: {
      sm: 'px-3.5 py-1.5',
      xs: 'px-3 py-1',
    },
  },
  defaultVariants: { active: false, size: 'sm' },
})

export default function Chip({ active, size, className, ...props }) {
  return <button type="button" className={chip({ active, size, className })} {...props} />
}
