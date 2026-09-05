import { forwardRef } from 'react'
import { Button as AntButton } from 'antd'
import { cx } from '../../lib/cx'

const TYPE = {
  primary: 'primary',
  secondary: 'default',
  outline: 'default',
  ghost: 'text',
  link: 'link',
}

/**
 * Compatibility wrapper for the existing call sites. Ant Design now owns
 * interaction states, sizing and accessibility; polymorphic rendering is
 * retained for the handful of React Router/external-link buttons.
 */
const Button = forwardRef(function Button(
  { className, variant = 'secondary', size = 'sm', as: Comp, children, ...props },
  ref
) {
  const antSize = size === 'sm' || size === 'icon' ? 'small' : 'middle'
  const iconOnly = size === 'icon'
  const sharedClass = cx(
    'portal-button',
    variant === 'outline' && 'border-hairline bg-transparent',
    iconOnly && 'aspect-square px-0',
    className
  )

  if (Comp) {
    return (
      <Comp
        ref={ref}
        className={cx(
          'ant-btn ant-btn-sm inline-flex items-center justify-center gap-1.5 font-semibold',
          variant === 'primary' && 'ant-btn-primary bg-accent text-white',
          variant === 'ghost' && 'ant-btn-text border-transparent bg-transparent',
          variant === 'link' && 'ant-btn-link border-transparent bg-transparent text-accent',
          sharedClass
        )}
        {...props}
      >
        {children}
      </Comp>
    )
  }

  return (
    <AntButton
      ref={ref}
      type={TYPE[variant] || 'default'}
      size={antSize}
      className={sharedClass}
      {...props}
    >
      {children}
    </AntButton>
  )
})

export default Button
