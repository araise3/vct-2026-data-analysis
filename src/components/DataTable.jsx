import { useMemo } from 'react'
import { Empty, Table } from 'antd'

const WORD_JOINER = '⁠'
function noBreakSlash(label) {
  return typeof label === 'string' ? label.replace(/\//g, `${WORD_JOINER}/${WORD_JOINER}`) : label
}

function compareValues(key) {
  return (a, b, sortOrder) => {
    const av = a[key]
    const bv = b[key]
    const aMissing = av === null || av === undefined
    const bMissing = bv === null || bv === undefined
    if (aMissing && bMissing) return 0
    // Ant reverses the comparator for descending order. Account for that
    // here so missing values stay at the bottom in both directions.
    if (aMissing) return sortOrder === 'ascend' ? 1 : -1
    if (bMissing) return sortOrder === 'ascend' ? -1 : 1
    if (typeof av === 'string') return av.localeCompare(bv)
    return av - bv
  }
}

/**
 * Compatibility adapter from the portal's compact column schema to Ant
 * Design Table. Ant now owns sorting, keyboard interaction, expansion,
 * sticky headers and empty states; domain-specific formatting and heatmap
 * colouring remain local.
 */
export default function DataTable({
  columns, rows, defaultSortKey, defaultSortDir = 'desc', summaryRow, renderExpanded, expandKey,
}) {
  const rowKeys = useMemo(() => new Map(rows.map((row, index) => [row, index])), [rows])

  const antColumns = useMemo(() => columns.map((column) => ({
    key: column.key,
    dataIndex: column.key,
    title: noBreakSlash(column.label),
    align: column.align || 'left',
    width: column.width,
    sorter: compareValues(column.key),
    defaultSortOrder: defaultSortKey === column.key
      ? (defaultSortDir === 'asc' ? 'ascend' : 'descend')
      : undefined,
    render: (value, row) => (
      <span className={column.key === columns[0].key ? 'text-ink' : 'text-ink/90'}>
        {column.format ? column.format(value, row) : value ?? '—'}
      </span>
    ),
    onCell: () => {
      return {
        style: {
          padding: column.noPadding ? 0 : undefined,
          fontVariantNumeric: 'tabular-nums',
          fontSize: 12,
        },
      }
    },
  })), [columns, defaultSortDir, defaultSortKey])

  const summary = summaryRow
    ? () => (
        <Table.Summary.Row>
          {columns.map((column, index) => (
            <Table.Summary.Cell
              key={column.key}
              index={index}
              align={column.align || 'left'}
              className="bg-surface2 font-semibold"
            >
              {column.format
                ? column.format(summaryRow[column.key], summaryRow)
                : summaryRow[column.key] ?? '—'}
            </Table.Summary.Cell>
          ))}
        </Table.Summary.Row>
      )
    : undefined

  return (
    <Table
      className="portal-data-table"
      size="small"
      sticky={{ offsetHeader: 56 }}
      pagination={rows.length > 50 ? { defaultPageSize: 50, showSizeChanger: true, pageSizeOptions: [25, 50, 100], hideOnSinglePage: false, showTotal: (total, range) => `${range[0]}–${range[1]} of ${total}` } : false}
      columns={antColumns}
      dataSource={rows}
      rowKey={(row) => expandKey ? expandKey(row) : rowKeys.get(row)}
      scroll={{ x: 'max-content' }}
      summary={summary}
      showSorterTooltip={{ target: 'sorter-icon' }}
      locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No data in this scope" /> }}
      expandable={renderExpanded ? {
        expandedRowRender: renderExpanded,
        columnWidth: 34,
      } : undefined}
    />
  )
}
