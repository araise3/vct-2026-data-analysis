import { forwardRef } from 'react'
import { cx } from '../../lib/cx'

/**
 * Shared text/date input chrome. `shadow-depth-xs` gives it the same faint
 * recessed-vs-raised distinction as Button/Chip/Card get, and the focus
 * state swaps the border for the selected-color focus-ring shadow (box-shadow, not
 * `ring-*`, so it doesn't add layout-shifting extra width the way an
 * `outline`/`ring` utility would stack with the existing border).
 */
const Input = forwardRef(function Input({ className, ...props }, ref) {
  return (
    <input
      ref={ref}
      className={cx(
        'bg-surface2 border border-hairline rounded-lg px-3 py-1.5 text-xs text-ink shadow-depth-xs transition-shadow duration-150',
        'focus:outline-none focus:border-selected/50 focus:shadow-focus-ring',
        className
      )}
      {...props}
    />
  )
})

export default Input
