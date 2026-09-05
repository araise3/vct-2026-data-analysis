import { useMemo } from 'react'
import { Select as AntSelect } from 'antd'
import { cx } from '../../lib/cx'

/**
 * Project select backed by Ant Design. Keeping this adapter lets existing
 * pages retain their simple string/object option API while Ant owns popup
 * placement, focus management, keyboard navigation and visual states.
 */
export default function Select({
  value, onChange, options, placeholder = 'Select…', renderIcon, searchable,
  className, disabled, variant = 'default', allowClear = false,
}) {
  const normalized = useMemo(
    () => options.map((option) => (
      typeof option === 'object' && option !== null
        ? option
        : { value: option, label: option }
    )),
    [options]
  )

  const antOptions = useMemo(
    () => normalized.map((option) => ({
      value: option.value,
      searchLabel: String(option.label),
      label: (
        <span className="flex min-w-0 items-center gap-2">
          {renderIcon?.(option.value)}
          <span className="truncate">{option.label}</span>
        </span>
      ),
    })),
    [normalized, renderIcon]
  )

  const showSearch = searchable ?? normalized.length > 8

  return (
    <AntSelect
      value={value === '' && !normalized.some((option) => option.value === '') ? undefined : value}
      onChange={(next) => onChange(next ?? '')}
      allowClear={allowClear}
      options={antOptions}
      placeholder={placeholder}
      disabled={disabled}
      showSearch={showSearch}
      optionFilterProp="searchLabel"
      popupMatchSelectWidth={false}
      variant={variant === 'ghost' ? 'borderless' : 'outlined'}
      className={cx(
        'portal-select min-w-[120px] text-xs',
        variant === 'ghost' && 'w-fit font-semibold',
        className
      )}
    />
  )
}
