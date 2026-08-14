import { forwardRef } from 'react'
import { tv } from 'tailwind-variants'

/**
 * Shared button primitive. Depth comes from a shadow pair, not a border
 * alone: `shadow-button` (cast shadow + top inset highlight) reads as a
 * raised key at rest, `hover:shadow-button-hover` brightens both into an
 * accent-tinted glow, and `active:shadow-button-active` flips to an inset
 * shadow so the press itself looks like the surface being pushed in rather
 * than just a color change. `-translate-y-px` on hover / `translate-y-0` on
 * active reinforces the same lift-then-press motion.
 *
 * `variant="link"` opts out of all of that deliberately — small inline
 * actions ("Clear all", "clear" on a date range) read as buttons-that-look-
 * like-buttons when given the same shadow treatment as a real CTA; those
 * stay flat text with just a color/underline transition.
 */
const button = tv({
  base: 'inline-flex items-center justify-center gap-1.5 font-semibold transition-all duration-150 ease-out disabled:opacity-40 disabled:pointer-events-none focus-visible:outline-none focus-visible:shadow-focus-ring',
  variants: {
    variant: {
      primary:
        'bg-grad-accent text-white rounded-xl shadow-button hover:bg-grad-accent-hover hover:shadow-button-hover hover:-translate-y-0.5 active:shadow-button-active active:translate-y-0 active:bg-accent-dim',
      secondary:
        'bg-grad-surface2 text-ink rounded-xl shadow-button hover:shadow-button-hover hover:-translate-y-0.5 active:shadow-button-active active:translate-y-0 border border-hairline',
      outline:
        'bg-surface text-muted rounded-xl border border-hairline shadow-depth-xs hover:text-ink hover:border-accent/40 hover:-translate-y-0.5 hover:shadow-depth-sm active:translate-y-0 active:shadow-none',
      ghost:
        'bg-transparent text-muted rounded-xl hover:text-ink hover:bg-surface2',
      link:
        'bg-transparent text-accent-bright rounded p-0 hover:underline',
    },
    size: {
      sm: 'text-xs px-3 py-1.5',
      md: 'text-sm px-5 py-2.5',
      icon: 'p-1.5',
    },
  },
  compoundVariants: [{ variant: 'link', class: 'px-0 py-0' }],
  defaultVariants: { variant: 'secondary', size: 'sm' },
})

const Button = forwardRef(function Button(
  { className, variant, size, as: Comp = 'button', ...props },
  ref
) {
  return <Comp ref={ref} className={button({ variant, size, className })} {...props} />
})

export default Button
