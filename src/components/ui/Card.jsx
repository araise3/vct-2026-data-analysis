import { Card as AntCard } from 'antd'
import { cx } from '../../lib/cx'

/**
 * The one raised-surface panel every card/table/filter-panel wrapper uses.
 * Previously every one of those hand-rolled its own `bg-surface border
 * border-hairline rounded-2xl` string with no depth at all — a bordered
 * rectangle the exact same flatness as the page behind it. `shadow-depth-sm`
 * (cast shadow + inset top highlight, see tailwind.config.js) is what makes
 * it actually read as sitting above the base background instead of just
 * being outlined.
 */
export default function Card({ className, ...props }) {
  return (
    <AntCard
      size="small"
      className={cx('portal-card shadow-depth-xs', className)}
      {...props}
    />
  )
}
