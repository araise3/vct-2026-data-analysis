import { forwardRef } from 'react'
import { Input as AntInput } from 'antd'
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
    <AntInput
      ref={ref}
      className={cx(
        'portal-input text-xs',
        className
      )}
      {...props}
    />
  )
})

export default Input
