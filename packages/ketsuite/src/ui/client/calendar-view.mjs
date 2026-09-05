// @ts-nocheck Shared dependency-free browser/SSR calendar view.
const LABELS = {
  vi: {
    title: 'Lịch làm việc',
    agenda: 'Lịch biểu',
    week: 'Tuần',
    month: 'Tháng',
    today: 'Hôm nay',
    previous: 'Trước',
    next: 'Sau',
    loading: 'Đang tải lịch…',
    empty: 'Không có sự kiện trong khoảng này.',
    retry: 'Thử lại',
    create: 'Tạo sự kiện',
    name: 'Tên sự kiện',
    start: 'Bắt đầu',
    stop: 'Kết thúc',
    location: 'Địa điểm',
    save: 'Lưu sự kiện',
    saving: 'Đang lưu…',
    allDay: 'Cả ngày',
    organizer: 'Người tổ chức',
  },
  en: {
    title: 'Work calendar',
    agenda: 'Agenda',
    week: 'Week',
    month: 'Month',
    today: 'Today',
    previous: 'Previous',
    next: 'Next',
    loading: 'Loading calendar…',
    empty: 'No events in this range.',
    retry: 'Retry',
    create: 'Create event',
    name: 'Event name',
    start: 'Starts',
    stop: 'Ends',
    location: 'Location',
    save: 'Save event',
    saving: 'Saving…',
    allDay: 'All day',
    organizer: 'Organizer',
  },
}
const labelsOf = (props) => LABELS[String(props.lang).toLowerCase().startsWith('en') ? 'en' : 'vi']
const localDate = (date = new Date()) => {
  const offset = date.getTimezoneOffset() * 60_000
  return new Date(date.getTime() - offset).toISOString().slice(0, 10)
}
const addDays = (date, days) => {
  const value = new Date(`${date}T00:00:00.000Z`)
  value.setUTCDate(value.getUTCDate() + days)
  return value.toISOString().slice(0, 10)
}
const monday = (date) => {
  const value = new Date(`${date}T00:00:00.000Z`)
  const offset = (value.getUTCDay() + 6) % 7
  return addDays(date, -offset)
}
const monthStart = (date) => `${date.slice(0, 7)}-01`
const addMonths = (date, amount) => {
  const value = new Date(`${monthStart(date)}T00:00:00.000Z`)
  value.setUTCMonth(value.getUTCMonth() + amount)
  return value.toISOString().slice(0, 10)
}
const timezone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
const errorText = (error) =>
  error && typeof error === 'object' && 'message' in error ? String(error.message) : 'Calendar request failed'
const callApi = async (name, input, signal) => {
  const response = await fetch(`/_ket/fn/${encodeURIComponent(name)}`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
    signal,
  })
  const payload = await response.json()
  if (!response.ok || payload.ok === false)
    throw new Error(String(payload.message ?? `HTTP ${response.status}`))
  return payload.value
}

const rangeOf = (view, cursor) => {
  if (view === 'week') {
    const start = monday(cursor)
    return {
      start,
      stop: addDays(start, 7),
      days: Array.from({ length: 7 }, (_, index) => addDays(start, index)),
    }
  }
  if (view === 'month') {
    const first = monthStart(cursor)
    const start = monday(first)
    return {
      start,
      stop: addDays(start, 42),
      days: Array.from({ length: 42 }, (_, index) => addDays(start, index)),
    }
  }
  return { start: cursor, stop: addDays(cursor, 30), days: [] }
}

export function createCalendarView(runtime, props, seed = {}) {
  const { each, html, signal } = runtime
  const labels = labelsOf(props)
  const eventTimeFormatter = new Intl.DateTimeFormat([], { hour: '2-digit', minute: '2-digit' })
  const view = signal(seed.view ?? props.view ?? 'agenda')
  const cursor = signal(seed.cursor ?? localDate())
  const status = signal(seed.status ?? 'loading')
  const busy = signal(false)
  const error = signal(seed.error ?? '')
  const events = signal(seed.events ?? [])
  let activeRequest = null
  let disposed = false

  const load = async ({ quiet = false } = {}) => {
    if (!quiet) status.set('loading')
    try {
      activeRequest?.abort()
      activeRequest = new AbortController()
      const range = rangeOf(view(), cursor())
      const result = await callApi(
        'calendar.listAgenda',
        {
          rangeStart: range.start,
          rangeStop: range.stop,
          timezone: timezone(),
          limit: 1000,
        },
        activeRequest.signal,
      )
      events.set(result.events ?? [])
      error.set('')
      status.set('ready')
    } catch (cause) {
      if (disposed || cause?.name === 'AbortError') return
      error.set(errorText(cause))
      status.set('error')
    }
  }
  const chooseView = async (next) => {
    view.set(next)
    await load()
  }
  const move = async (direction) => {
    cursor.set(
      view() === 'month'
        ? addMonths(cursor(), direction)
        : addDays(cursor(), direction * (view() === 'week' ? 7 : 30)),
    )
    await load()
  }
  const create = async (event) => {
    event.preventDefault()
    if (busy()) return
    const form = event.target
    const values = new FormData(form)
    busy.set(true)
    try {
      const allDay = values.get('allDay') === 'on'
      const start = String(values.get('start') ?? '')
      const stop = String(values.get('stop') ?? '')
      await callApi(
        'calendar.saveEvent',
        {
          id: crypto.randomUUID(),
          name: String(values.get('name') ?? ''),
          location: String(values.get('location') ?? ''),
          allDay,
          ...(allDay
            ? { startDate: start.slice(0, 10), stopDate: addDays(stop.slice(0, 10), 1) }
            : { startAt: new Date(start).toISOString(), stopAt: new Date(stop).toISOString() }),
          timezone: timezone(),
          privacy: 'public',
          showAs: 'busy',
          attendees: [],
          reminders: [],
        },
        activeRequest?.signal,
      )
      form.reset()
      await load({ quiet: true })
    } catch (cause) {
      if (disposed || cause?.name === 'AbortError') return
      error.set(errorText(cause))
      status.set('error')
    } finally {
      busy.set(false)
    }
  }
  if (typeof window !== 'undefined') queueMicrotask(load)

  const eventCard = (entry) => html`<article data-ui="calendar-event" data-all-day=${entry.allDay}>
    <strong data-ui="calendar-event-title">${entry.name}</strong>
    <span data-ui="calendar-event-time">${entry.allDay ? labels.allDay : `${eventTimeFormatter.format(new Date(entry.startAt))}–${eventTimeFormatter.format(new Date(entry.stopAt))}`}</span>
    ${entry.location ? html`<span data-ui="calendar-event-location">${entry.location}</span>` : ''}
    <span data-ui="calendar-event-organizer">${labels.organizer}: ${entry.organizerName}</span>
  </article>`

  const render = () => {
    const range = rangeOf(view(), cursor())
    return html`<section data-ui="calendar-board" data-state=${status()} data-view=${view()} aria-label=${labels.title}>
      <header data-ui="calendar-head">
        <div data-ui="calendar-heading"><h2 data-ui="calendar-title">${labels.title}</h2><time data-ui="calendar-range">${range.start} — ${addDays(range.stop, -1)}</time></div>
        <div data-ui="calendar-navigation">
          <button data-ui="action" data-variant="secondary" data-size="compact" type="button" on:click=${() => move(-1)}>${labels.previous}</button>
          <button data-ui="action" data-variant="secondary" data-size="compact" type="button" on:click=${async () => {
            cursor.set(localDate())
            await load()
          }}>${labels.today}</button>
          <button data-ui="action" data-variant="secondary" data-size="compact" type="button" on:click=${() => move(1)}>${labels.next}</button>
        </div>
        <div data-ui="calendar-views" role="group" aria-label=${labels.title}>
          ${each(
            ['agenda', 'week', 'month'],
            (name) => name,
            (name) =>
              html`<button data-ui="action" data-variant="tertiary" data-size="compact" type="button" data-active=${view() === name} on:click=${() => chooseView(name)}>${labels[name]}</button>`,
          )}
        </div>
      </header>
      <form data-ui="calendar-create" on:submit=${create}>
        <h3 data-ui="calendar-create-title">${labels.create}</h3>
        <label data-ui="calendar-field">${labels.name}<input data-ui="form-control" name="name" autocomplete="off" required maxlength="500" disabled=${busy()}></label>
        <label data-ui="calendar-field">${labels.start}<input data-ui="form-control" type="datetime-local" name="start" autocomplete="off" required disabled=${busy()}></label>
        <label data-ui="calendar-field">${labels.stop}<input data-ui="form-control" type="datetime-local" name="stop" autocomplete="off" required disabled=${busy()}></label>
        <label data-ui="calendar-field">${labels.location}<input data-ui="form-control" name="location" autocomplete="off" disabled=${busy()}></label>
        <label data-ui="calendar-all-day"><input data-ui="form-control" type="checkbox" name="allDay" autocomplete="off" disabled=${busy()}>${labels.allDay}</label>
        <button data-ui="calendar-submit" data-control="action" data-variant="primary" data-size="compact" type="submit" disabled=${busy()}>${busy() ? labels.saving : labels.save}</button>
      </form>
      ${error() ? html`<div data-ui="calendar-error" role="alert">${error()} <button data-ui="action" data-variant="secondary" data-size="compact" type="button" on:click=${() => load()}>${labels.retry}</button></div>` : ''}
      ${status() === 'loading' ? html`<p data-ui="calendar-loading">${labels.loading}</p>` : ''}
      ${status() === 'ready' && events().length === 0 ? html`<p data-ui="calendar-empty">${labels.empty}</p>` : ''}
      ${
        view() === 'agenda'
          ? html`<div data-ui="calendar-agenda">${each(
              events(),
              (entry) => entry.occurrenceId,
              (entry) => eventCard(entry),
            )}</div>`
          : html`<div data-ui=${view() === 'week' ? 'calendar-week' : 'calendar-month'}>${each(
              range.days,
              (day) => day,
              (
                day,
              ) => html`<section data-ui="calendar-day" data-today=${day === localDate()} data-outside=${view() === 'month' && day.slice(0, 7) !== cursor().slice(0, 7)}>
                <time data-ui="calendar-day-label" datetime=${day}>${day}</time>
                <div data-ui="calendar-day-events">${each(
                  events().filter((entry) => entry.occurrenceDate === day),
                  (entry) => entry.occurrenceId,
                  (entry) => eventCard(entry),
                )}</div>
              </section>`,
            )}</div>`
      }
    </section>`
  }
  return {
    view: render,
    dispose: () => {
      disposed = true
      activeRequest?.abort()
    },
  }
}
