// @ts-nocheck Shared dependency-free browser/SSR activity view.
const LABELS = {
  vi: {
    title: 'Hoạt động đã lên kế hoạch',
    type: 'Loại hoạt động',
    summary: 'Nội dung cần làm',
    note: 'Ghi chú',
    due: 'Hạn xử lý',
    attachment: 'Tệp đính kèm',
    schedule: 'Lên lịch',
    scheduling: 'Đang lưu…',
    newActivity: 'Hoạt động',
    close: 'Đóng',
    loading: 'Đang tải hoạt động…',
    empty: 'Chưa có hoạt động nào.',
    assignee: 'Phụ trách',
    complete: 'Hoàn tất',
    completing: 'Đang hoàn tất…',
    feedback: 'Phản hồi hoàn tất',
    reschedule: 'Đổi hạn',
    newDue: 'Hạn mới',
    cancel: 'Hủy',
    retry: 'Thử lại',
    overdue: 'Quá hạn',
    today: 'Hôm nay',
    planned: 'Đã lên kế hoạch',
    done: 'Hoàn tất',
    canceled: 'Đã hủy',
    myActivities: 'Hoạt động của tôi',
  },
  en: {
    title: 'Planned activities',
    type: 'Activity type',
    summary: 'What needs to be done',
    note: 'Note',
    due: 'Due date',
    attachment: 'Attachment',
    schedule: 'Schedule',
    scheduling: 'Saving…',
    newActivity: 'Activity',
    close: 'Close',
    loading: 'Loading activities…',
    empty: 'No activities yet.',
    assignee: 'Assigned to',
    complete: 'Complete',
    completing: 'Completing…',
    feedback: 'Completion feedback',
    reschedule: 'Reschedule',
    newDue: 'New due date',
    cancel: 'Cancel',
    retry: 'Retry',
    overdue: 'Overdue',
    today: 'Today',
    planned: 'Planned',
    done: 'Done',
    canceled: 'Canceled',
    myActivities: 'My activities',
  },
}

const labelsOf = (props) => LABELS[String(props.lang).toLowerCase().startsWith('en') ? 'en' : 'vi']
const apiFor = (resModel) => {
  if (resModel === 'product.Template') return 'product_activity_backend'
  if (resModel === 'product.Product') return 'product_variant_activity_backend'
  if (resModel === 'stock.Picking') return 'stock_activity_backend'
  if (resModel === 'stock.Lot') return 'stock_lot_activity_backend'
  if (resModel === 'sale.Order') return 'sale_activity_backend'
  if (resModel === 'account.Move') return 'account_activity_backend'
  return null
}
const localDate = () => {
  const now = new Date()
  const offset = now.getTimezoneOffset() * 60_000
  return new Date(now.getTime() - offset).toISOString().slice(0, 10)
}
const errorText = (error) =>
  error && typeof error === 'object' && 'message' in error ? String(error.message) : 'Activity request failed'

const requestScope = () => {
  const pending = new Set()
  let disposed = false
  return {
    fetch: async (url, options = {}) => {
      if (disposed) throw new DOMException('Island disposed', 'AbortError')
      const controller = new AbortController()
      pending.add(controller)
      try {
        return await fetch(url, { ...options, signal: controller.signal })
      } finally {
        pending.delete(controller)
      }
    },
    disposed: () => disposed,
    dispose: () => {
      disposed = true
      for (const controller of pending) controller.abort()
      pending.clear()
    },
  }
}

const callApi = async (request, name, input) => {
  const response = await request(`/_ket/fn/${encodeURIComponent(name)}`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  })
  const payload = await response.json()
  if (!response.ok || payload.ok === false) {
    const error = new Error(String(payload.message ?? `HTTP ${response.status}`))
    error.code = payload.code
    throw error
  }
  return payload.value
}

const upload = async (request, file, activityId) => {
  const form = new FormData()
  form.set('file', file)
  form.set('resModel', 'activity.Activity')
  form.set('resId', activityId)
  const response = await request('/files', { method: 'POST', credentials: 'same-origin', body: form })
  const payload = await response.json()
  if (!response.ok) throw new Error(String(payload.message ?? `HTTP ${response.status}`))
  return String(payload.id)
}

export function createRecordActivityView(runtime, props, seed = {}) {
  const { each, html, signal } = runtime
  const labels = labelsOf(props)
  const status = signal(seed.status ?? 'loading')
  const busy = signal(false)
  const scheduleOpen = signal(seed.scheduleOpen ?? false)
  const itemAction = signal(seed.itemAction ?? null)
  const error = signal(seed.error ?? '')
  const types = signal(seed.types ?? [])
  const activities = signal(seed.activities ?? [])
  const bridge = apiFor(String(props.resModel))
  const requests = requestScope()
  let pollCount = 0
  let pollTimer = null

  const load = async ({ quiet = false } = {}) => {
    if (!bridge) {
      status.set('error')
      error.set(`Unsupported activity target: ${String(props.resModel)}`)
      return
    }
    if (!quiet) status.set('loading')
    try {
      const [typeRows, result] = await Promise.all([
        callApi(requests.fetch, 'activity.listTypes', {}),
        callApi(requests.fetch, `${bridge}.list`, { targetId: props.resId, today: localDate() }),
      ])
      types.set(typeRows)
      activities.set(result.activities ?? [])
      error.set('')
      status.set('ready')
    } catch (cause) {
      if (requests.disposed()) return
      error.set(errorText(cause))
      status.set('error')
    }
  }

  const schedule = async (event) => {
    event.preventDefault()
    if (!bridge || busy()) return
    const form = event.target
    const values = new FormData(form)
    busy.set(true)
    error.set('')
    try {
      const id = crypto.randomUUID()
      const selected = values.get('attachment')
      const attachmentIds =
        selected instanceof File && selected.size > 0 ? [await upload(requests.fetch, selected, id)] : []
      await callApi(requests.fetch, `${bridge}.schedule`, {
        id,
        targetId: props.resId,
        typeId: String(values.get('typeId') ?? ''),
        summary: String(values.get('summary') ?? ''),
        note: String(values.get('note') ?? ''),
        dueDate: String(values.get('dueDate') ?? ''),
        attachmentIds,
      })
      form.reset()
      const date = form.querySelector('[name="dueDate"]')
      if (date) date.value = localDate()
      await load({ quiet: true })
      scheduleOpen.set(false)
    } catch (cause) {
      if (requests.disposed()) return
      error.set(errorText(cause))
      status.set('error')
    } finally {
      busy.set(false)
    }
  }

  const complete = async (event) => {
    event.preventDefault()
    if (busy()) return
    const form = event.target
    const values = new FormData(form)
    busy.set(true)
    try {
      await callApi(requests.fetch, 'activity.complete', {
        id: String(form.dataset.id),
        feedback: String(values.get('feedback') ?? ''),
        completedDate: localDate(),
      })
      await load({ quiet: true })
      itemAction.set(null)
    } catch (cause) {
      if (requests.disposed()) return
      error.set(errorText(cause))
      status.set('error')
    } finally {
      busy.set(false)
    }
  }

  const reschedule = async (event) => {
    event.preventDefault()
    if (busy()) return
    const form = event.target
    const values = new FormData(form)
    busy.set(true)
    try {
      await callApi(requests.fetch, 'activity.reschedule', {
        id: String(form.dataset.id),
        dueDate: String(values.get('dueDate') ?? ''),
      })
      await load({ quiet: true })
      itemAction.set(null)
    } catch (cause) {
      if (requests.disposed()) return
      error.set(errorText(cause))
      status.set('error')
    } finally {
      busy.set(false)
    }
  }

  const cancel = async (id) => {
    if (busy()) return
    busy.set(true)
    try {
      await callApi(requests.fetch, 'activity.cancel', { id })
      await load({ quiet: true })
      itemAction.set(null)
    } catch (cause) {
      if (requests.disposed()) return
      error.set(errorText(cause))
      status.set('error')
    } finally {
      busy.set(false)
    }
  }

  const schedulePoll = () => {
    if (requests.disposed() || pollCount >= 240) return
    pollCount++
    pollTimer = setTimeout(async () => {
      if (requests.disposed()) return
      if (document.visibilityState === 'visible' && !busy()) await load({ quiet: true })
      schedulePoll()
    }, 15_000)
  }
  if (typeof window !== 'undefined')
    queueMicrotask(async () => {
      if (requests.disposed()) return
      await load()
      schedulePoll()
    })

  return {
    view: () => html`<section data-ui="activity-record" data-state=${status()} aria-label=${labels.title}>
    <header data-ui="activity-head">
      <h2 data-ui="activity-title">${labels.title}</h2>
      <button data-ui="activity-schedule-trigger" data-active=${scheduleOpen()} data-control="action" data-variant="secondary" data-size="compact" type="button" aria-pressed=${scheduleOpen()} on:click=${() => scheduleOpen.set(!scheduleOpen())} disabled=${busy()}>${labels.newActivity}</button>
    </header>
    ${
      scheduleOpen()
        ? html`<form data-ui="activity-schedule" on:submit=${schedule}>
      <label data-ui="activity-field">${labels.type}<select data-ui="form-control" name="typeId" required disabled=${busy()}>${each(
        types(),
        (type) => type.id,
        (type) => html`<option value=${type.id}>${type.name}</option>`,
      )}</select></label>
      <label data-ui="activity-field">${labels.summary}<input data-ui="form-control" name="summary" required maxlength="500" disabled=${busy()}></label>
      <label data-ui="activity-field">${labels.note}<textarea data-ui="form-control" name="note" disabled=${busy()}></textarea></label>
      <label data-ui="activity-field">${labels.due}<input data-ui="form-control" type="date" name="dueDate" value=${localDate()} required disabled=${busy()}></label>
      <div data-ui="activity-schedule-actions">
        <label data-ui="activity-attachment">${labels.attachment}<input data-ui="form-control" type="file" name="attachment" disabled=${busy()}></label>
        <div>
          <button data-ui="activity-schedule-close" data-control="action" data-variant="tertiary" data-size="compact" type="button" on:click=${() => scheduleOpen.set(false)} disabled=${busy()}>${labels.close}</button>
          <button data-ui="activity-submit" data-control="action" data-variant="primary" data-size="compact" type="submit" disabled=${busy() || types().length === 0}>${busy() ? labels.scheduling : labels.schedule}</button>
        </div>
      </div>
    </form>`
        : ''
    }
    ${error() ? html`<div data-ui="activity-error" role="alert">${error()} <button data-ui="action" data-variant="secondary" data-size="compact" type="button" on:click=${() => load()}>${labels.retry}</button></div>` : ''}
    <div data-ui="activity-list" aria-live="polite">
      ${status() === 'loading' ? html`<p data-ui="activity-loading">${labels.loading}</p>` : ''}
      ${status() === 'ready' && activities().length === 0 ? html`<p data-ui="activity-empty">${labels.empty}</p>` : ''}
      ${each(
        activities(),
        (activity) => activity.id,
        (activity) => html`<article data-ui="activity-item" data-state=${activity.state}>
          <header data-ui="activity-item-head">
            <div><strong data-ui="activity-item-title">${activity.summary}</strong><span data-ui="activity-type-name">${activity.typeName}</span></div>
            <span data-ui="activity-state">${labels[activity.state] ?? activity.state}</span>
          </header>
          ${activity.note ? html`<p data-ui="activity-item-note">${activity.note}</p>` : ''}
          <p data-ui="activity-meta">${labels.due}: <time datetime=${activity.dueDate}>${activity.dueDate}</time> · ${labels.assignee}: ${activity.assigneeName}</p>
          ${
            activity.attachments?.length
              ? html`<ul data-ui="activity-attachments">${each(
                  activity.attachments,
                  (attachment) => attachment.id,
                  (attachment) => html`<li><a href=${attachment.href}>${attachment.name}</a></li>`,
                )}</ul>`
              : ''
          }
          ${
            activity.active
              ? html`<div data-ui="activity-actions">
                <button data-ui="activity-action-trigger" data-action="complete" data-active=${itemAction() === `complete:${activity.id}`} data-control="action" data-variant="primary" data-size="compact" type="button" on:click=${() => itemAction.set(itemAction() === `complete:${activity.id}` ? null : `complete:${activity.id}`)} disabled=${busy()}>${labels.complete}</button>
                <button data-ui="activity-action-trigger" data-action="reschedule" data-active=${itemAction() === `reschedule:${activity.id}`} data-control="action" data-variant="secondary" data-size="compact" type="button" on:click=${() => itemAction.set(itemAction() === `reschedule:${activity.id}` ? null : `reschedule:${activity.id}`)} disabled=${busy()}>${labels.reschedule}</button>
                <button data-ui="activity-cancel" data-control="action" data-variant="destructive" data-size="compact" type="button" on:click=${() => cancel(activity.id)} disabled=${busy()}>${labels.cancel}</button>
              </div>
              ${
                itemAction() === `complete:${activity.id}`
                  ? html`<form data-ui="activity-complete" data-id=${activity.id} on:submit=${complete}>
                  <label data-ui="activity-action-field"><span data-ui="activity-action-label">${labels.feedback}</span><input data-ui="form-control" name="feedback" disabled=${busy()}></label>
                  <button data-ui="action" data-variant="primary" data-size="compact" type="submit" disabled=${busy()}>${busy() ? labels.completing : labels.complete}</button>
                </form>`
                  : ''
              }
              ${
                itemAction() === `reschedule:${activity.id}`
                  ? html`<form data-ui="activity-reschedule" data-id=${activity.id} on:submit=${reschedule}>
                  <label data-ui="activity-action-field"><span data-ui="activity-action-label">${labels.newDue}</span><input data-ui="form-control" type="date" name="dueDate" value=${activity.dueDate} required disabled=${busy()}></label>
                  <button data-ui="action" data-variant="secondary" data-size="compact" type="submit" disabled=${busy()}>${labels.reschedule}</button>
                </form>`
                  : ''
              }`
              : ''
          }
        </article>`,
      )}
    </div>
  </section>`,
    dispose: () => {
      if (pollTimer !== null) clearTimeout(pollTimer)
      requests.dispose()
    },
  }
}

export function createActivityIndicatorView(runtime, props, initial = { count: 0, overdue: 0 }) {
  const { html, signal } = runtime
  const labels = labelsOf(props)
  const count = signal(Number(initial.count ?? 0))
  const overdue = signal(Number(initial.overdue ?? 0))
  const requests = requestScope()
  const load = async () => {
    try {
      const result = await callApi(requests.fetch, 'activity.countDue', { today: localDate() })
      count.set(Number(result.count ?? 0))
      overdue.set(Number(result.overdue ?? 0))
    } catch {
      if (requests.disposed()) return
      count.set(0)
      overdue.set(0)
    }
  }
  if (typeof window !== 'undefined') queueMicrotask(load)
  return {
    view: () => html`<a data-ui="activity-indicator" data-overdue=${overdue() > 0} href="/admin/activities" title=${labels.myActivities} aria-label=${labels.myActivities}>
    <svg data-ui="activity-indicator-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
    ${count() > 0 ? html`<span data-ui="activity-indicator-count">${count()}</span>` : ''}
  </a>`,
    dispose: requests.dispose,
  }
}
