import { Tag } from 'antd'
import { cx } from '../../lib/cx'

const { CheckableTag } = Tag

export default function Chip({ active, size = 'sm', className, onClick, children, ...props }) {
  return (
    <CheckableTag
      checked={!!active}
      onChange={() => onClick?.()}
      className={cx(
        'portal-chip m-0 cursor-pointer select-none border border-hairline px-3 text-[11px] font-medium leading-7',
        size === 'xs' && 'px-2 leading-6',
        active ? 'border-accent/30' : 'bg-surface text-muted hover:text-ink',
        className
      )}
      {...props}
    >
      {children}
    </CheckableTag>
  )
}
