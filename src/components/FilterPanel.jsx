import { useId, useState } from 'react'
import { Button, Input, Select } from 'antd'
import { unscopeValue } from '../lib/entityBuckets'
import { eventLabel } from '../lib/format'
import { HIDDEN_BY_DEFAULT_EVENTS } from '../lib/useFacetedFilter'

export const FACETS = ['year', 'competition', 'region', 'split', 'event', 'eventPhase', 'eventWeek']
export const FACET_LABELS = {
  year: 'Year', competition: 'Competition', region: 'Region', split: 'Split',
  event: 'Event', eventPhase: 'Phase', eventWeek: 'Week / Round',
}
const bareWeek = (value) => value.includes(': ') ? value.split(': ').slice(1).join(': ') : value
const scopedLabel = (format) => (scoped) => {
  const { event, value } = unscopeValue(scoped)
  return `${eventLabel(event)} — ${format(value)}`
}
export const FACET_RENDERERS = {
  event: eventLabel,
  eventPhase: scopedLabel((value) => value),
  eventWeek: scopedLabel(bareWeek),
}

export default function FilterPanel({
  selections, setFacet, clearAll, options, activeCount, children, summary,
  dateRange, setDateRange, dateBounds, includeHiddenEvents, setIncludeHiddenEvents,
  defaultOpen = false, additionalSummary,
}) {
  const [open, setOpen] = useState(defaultOpen)
  const panelId = useId()
  const advancedCount = (selections.eventPhase?.length || 0) + (selections.eventWeek?.length || 0)
    + Number(!!dateRange?.from) + Number(!!dateRange?.to) + Number(!!includeHiddenEvents)

  function facetControl(facet, event) {
    const scoped = !!event
    const choices = (options[facet] || []).filter((option) => !scoped || unscopeValue(option.value).event === event)
    if (!choices.length) return null
    const selected = (selections[facet] || []).filter((value) => !scoped || unscopeValue(value).event === event)
    return (
      <div className="min-w-0" key={`${facet}-${event || ''}`}>
        <label className="filter-label" htmlFor={`${panelId}-${facet}-${event || ''}`}>{FACET_LABELS[facet]}</label>
        <Select
          id={`${panelId}-${facet}-${event || ''}`}
          mode="multiple"
          allowClear
          showSearch
          optionFilterProp="label"
          maxTagCount="responsive"
          className="w-full"
          placeholder="All"
          value={selected}
          options={choices.map(({ value }) => ({
            value,
            label: scoped ? (facet === 'eventWeek' ? bareWeek(unscopeValue(value).value) : unscopeValue(value).value)
              : String(FACET_RENDERERS[facet]?.(value) ?? value),
          }))}
          onChange={(values) => setFacet(facet, scoped
            ? [...(selections[facet] || []).filter((value) => unscopeValue(value).event !== event), ...values]
            : values)}
        />
      </div>
    )
  }

  return (
    <section className="portal-filters" aria-label="Filter statistics">
      <div className="filter-primary">
        {['year', 'competition', 'region', 'split', 'event'].map((facet) => facetControl(facet))}
      </div>
      <div className="flex flex-wrap items-center gap-3 py-3">
        <Button size="small" aria-expanded={open} aria-controls={panelId} onClick={() => setOpen(!open)}>
          {open ? 'Fewer filters' : 'More filters'}{advancedCount > 0 ? ` (${advancedCount})` : ''}
        </Button>
        {activeCount > 0 && <Button type="text" size="small" onClick={clearAll}>Reset filters</Button>}
        {summary && <span className="ml-auto text-xs text-muted">{summary}</span>}
      </div>
      {open && (
        <div id={panelId} className="flex flex-col gap-4 border-t border-hairline py-4">
          {setDateRange && (
            <div className="flex flex-wrap items-end gap-3">
              <div><label className="filter-label" htmlFor={`${panelId}-from`}>From</label><Input id={`${panelId}-from`} type="date" value={dateRange?.from || ''} min={dateBounds?.min} max={dateBounds?.max} onChange={(event) => setDateRange({ from: event.target.value })} /></div>
              <div><label className="filter-label" htmlFor={`${panelId}-to`}>To</label><Input id={`${panelId}-to`} type="date" value={dateRange?.to || ''} min={dateBounds?.min} max={dateBounds?.max} onChange={(event) => setDateRange({ to: event.target.value })} /></div>
              {(dateRange?.from || dateRange?.to) && <Button type="text" onClick={() => setDateRange({ from: '', to: '' })}>Clear dates</Button>}
            </div>
          )}
          {(selections.event || []).map((event) => (
            <div key={event}>
              <p className="mb-2 text-xs font-medium">{eventLabel(event)}</p>
              <div className="grid max-w-2xl gap-3 sm:grid-cols-2">{facetControl('eventPhase', event)}{facetControl('eventWeek', event)}</div>
            </div>
          ))}
          {!(selections.event || []).length && <p className="text-xs text-muted">Select an event to narrow by phase or week.</p>}
          {setIncludeHiddenEvents && <label className="flex items-start gap-2 text-xs text-muted"><input type="checkbox" className="accent-accent" checked={!!includeHiddenEvents} onChange={(event) => setIncludeHiddenEvents(event.target.checked)} />Include {[...HIDDEN_BY_DEFAULT_EVENTS].map(eventLabel).join(', ')} (excluded by default)</label>}
        </div>
      )}
      {!open && additionalSummary && <p className="pb-3 text-xs text-muted md:hidden">{additionalSummary}</p>}
      {children && <div className={`${open ? '' : 'hidden md:block'} border-t border-hairline py-3`}>{children}</div>}
    </section>
  )
}
