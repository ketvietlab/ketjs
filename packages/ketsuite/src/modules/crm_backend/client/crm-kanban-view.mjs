// @ts-nocheck Dependency-free shared browser/SSR view.
const LABELS = {
  vi: {
    empty: 'Không có hồ sơ ở giai đoạn này.',
    move: 'Chuyển giai đoạn',
    moving: 'Đang chuyển…',
    conflict: 'Hồ sơ vừa thay đổi. Pipeline sẽ tải lại để lấy phiên bản mới nhất.',
    open: 'Mở hồ sơ',
    unassigned: 'Chưa phân công',
    loadMore: 'Xem tất cả',
    moveShort: 'Chuyển',
    create: 'Thêm lead',
    weight: 'Tỷ trọng dự báo của giai đoạn',
    columnMenu: 'Thao tác giai đoạn',
    overdue: 'Quá hạn',
  },
  en: {
    empty: 'No cases in this stage.',
    move: 'Move stage',
    moving: 'Moving…',
    conflict: 'The case changed elsewhere. The pipeline will reload the latest version.',
    open: 'Open case',
    unassigned: 'Unassigned',
    loadMore: 'See all',
    moveShort: 'Move',
    create: 'New lead',
    weight: "The stage's share of forecast value",
    columnMenu: 'Stage actions',
    overdue: 'Overdue',
  },
}

// The board is rendered on the server and rehydrated in the browser, so its
// wording travels with its data: the route resolves every string through the
// module catalogue and the map below is only the floor a payload without labels
// lands on. It used to be the only source, which put a second, untranslatable
// vocabulary in the module.
const dataOf = (props) => {
  const fallback = LABELS[String(props.lang).toLowerCase().startsWith('en') ? 'en' : 'vi']
  try {
    const value = JSON.parse(String(props.data ?? '{}'))
    return {
      rows: Array.isArray(value.rows) ? value.rows : [],
      stages: Array.isArray(value.stages) ? value.stages : [],
      labels: { ...fallback, ...(value.labels && typeof value.labels === 'object' ? value.labels : {}) },
    }
  } catch {
    return { rows: [], stages: [], labels: fallback }
  }
}

export const kanbanMovePayload = (id, stageId, expectedVersion, idempotencyKey) => ({
  id,
  stageId,
  expectedVersion,
  idempotencyKey,
})

const callMove = async (payload) => {
  const response = await fetch('/_ket/fn/crm.case.move', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const envelope = await response.json()
  const value = envelope.value ?? envelope
  if (!response.ok || value.ok === false)
    throw new Error(value.errors?.[0]?.code ?? `HTTP ${response.status}`)
  return value
}

/** Two letters, taken the way a Vietnamese name is read: the given name last. */
const initials = (name) => {
  const parts = String(name ?? '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
  if (!parts.length) return '?'
  const given = parts.length > 1 ? parts[parts.length - 1] : parts[0]
  const middle = parts.length > 2 ? parts[parts.length - 2] : ''
  return (middle.slice(0, 1) + given.slice(0, 1)).toLocaleUpperCase('vi')
}

export function createCrmKanbanView(runtime, props, seed = {}) {
  const { each, html, signal } = runtime
  const initial = dataOf(props)
  const labels = initial.labels
  const rows = signal(seed.rows ?? initial.rows)
  const busy = signal('')
  const error = signal('')
  const dragId = signal('')

  const move = async (entry, stageId) => {
    if (!stageId || stageId === entry.stageId || busy()) return
    busy.set(entry.id)
    error.set('')
    try {
      const result = await callMove(
        kanbanMovePayload(entry.id, stageId, Number(entry.version), crypto.randomUUID()),
      )
      rows.set(
        rows().map((row) => (row.id === entry.id ? { ...row, stageId, version: result.version } : row)),
      )
    } catch {
      error.set(labels.conflict)
      if (typeof window !== 'undefined') setTimeout(() => window.location.reload(), 900)
    } finally {
      busy.set('')
    }
  }

  /**
   * The stage select, folded away behind a disclosure.
   *
   * Dragging is the fast path, and it is the only one the design shows. It is
   * also the one that does not exist for a keyboard, for a screen reader, or on
   * a page whose script failed — so the form stays, as a native `<details>` that
   * needs no JavaScript to open and posts to a real route when none is running.
   */
  const moveControl = (entry) => html`<details data-ui="crm-card-move">
    <summary data-ui="crm-card-move-open" title=${labels.move} aria-label=${labels.move}>
      <svg data-ui="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 3 4 7l4 4" /><path d="M4 7h16" /><path d="m16 21 4-4-4-4" /><path d="M20 17H4" /></svg>
    </summary>
    <form data-ui="crm-card-move-form" method="post" action="/admin/crm/pipeline/move">
      <input type="hidden" name="id" value=${entry.id} autocomplete="off">
      <input type="hidden" name="expectedVersion" value=${String(entry.version)} autocomplete="off">
      <input type="hidden" name="idempotencyKey" value=${`pipeline:${entry.id}:${entry.version}`} autocomplete="off">
      <select data-ui="form-control" name="stageId" aria-label=${labels.move} on:change=${(event) => move(entry, event.target.value)} disabled=${busy() === entry.id}>
        ${each(
          initial.stages,
          (option) => option.id,
          (option) =>
            html`<option value=${option.id} selected=${option.id === entry.stageId}>${option.name}</option>`,
        )}
      </select>
      <button type="submit" data-ui="action" data-variant="secondary" data-size="compact" disabled=${busy() === entry.id}>${busy() === entry.id ? labels.moving : labels.moveShort}</button>
    </form>
  </details>`

  const card = (entry) => html`<article data-ui="crm-kanban-card" draggable="true"
    on:dragstart=${() => dragId.set(entry.id)}
    data-kind=${entry.kind} data-priority=${String(entry.priority ?? '1')} data-busy=${busy() === entry.id}>
    <h3 data-ui="crm-card-title"><a href=${`/admin/crm/cases/${entry.id}`}>${entry.name}</a></h3>
    ${
      entry.party
        ? html`<p data-ui="crm-card-party">
            <span>${entry.party}</span>
            ${entry.contactName ? html`<span data-ui="crm-card-contact">${entry.contactName}</span>` : ''}
          </p>`
        : ''
    }
    ${
      (entry.tags ?? []).length
        ? html`<p data-ui="crm-card-tags">
            ${each(
              entry.tags,
              (tag) => tag,
              (tag) => html`<span data-ui="crm-card-tag">${tag}</span>`,
            )}
          </p>`
        : ''
    }
    <p data-ui="crm-card-figures">
      <strong data-ui="crm-card-amount">${entry.revenue ?? '—'}</strong>
      ${entry.probability ? html`<span data-ui="crm-card-odds">${entry.probability}</span>` : ''}
    </p>
    <footer data-ui="crm-card-foot">
      ${
        entry.activity
          ? html`<span data-ui="crm-card-activity" data-overdue=${String(entry.activity.overdue === true)}
              title=${entry.activity.overdue ? labels.overdue : ''}>
              <svg data-ui="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 2v4" /><path d="M16 2v4" /><rect width="18" height="18" x="3" y="4" rx="2" /><path d="M3 10h18" /></svg>
              <span data-ui="crm-card-activity-summary">${entry.activity.summary}</span>
              <time data-ui="crm-card-activity-due">${entry.activity.due}</time>
            </span>`
          : html`<span data-ui="crm-card-activity" data-empty="true"></span>`
      }
      ${moveControl(entry)}
      <span data-ui="crm-card-owner" data-assigned=${String(!!entry.assigneeName)}
        title=${entry.assigneeName ?? labels.unassigned}>${entry.assigneeName ? initials(entry.assigneeName) : '—'}</span>
    </footer>
  </article>`

  const stageColumn = (stage) => {
    const stageRows = rows().filter((row) => row.stageId === stage.id)
    return html`<section data-ui="crm-kanban-column" data-stage=${stage.id} data-tone=${String(stage.tone ?? '1')}
      on:dragover=${(event) => event.preventDefault()}
      on:drop=${() => {
        const entry = rows().find((row) => row.id === dragId())
        if (entry) move(entry, stage.id)
      }}>
      <header data-ui="crm-kanban-stage">
        <span data-ui="crm-stage-dot" aria-hidden="true"></span>
        <h2 data-ui="crm-stage-name">${stage.name}</h2>
        <span data-ui="crm-stage-count">${String(stage.total ?? stageRows.length)}</span>
        ${stage.weight ? html`<span data-ui="crm-stage-weight" title=${labels.weight}>${stage.weight}</span>` : ''}
        ${stage.value ? html`<span data-ui="crm-stage-value">${stage.value}</span>` : ''}
        <details data-ui="crm-stage-menu">
          <summary data-ui="crm-stage-menu-open" aria-label=${labels.columnMenu} title=${labels.columnMenu}>
            <svg data-ui="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="1" /><circle cx="12" cy="5" r="1" /><circle cx="12" cy="19" r="1" /></svg>
          </summary>
          <div data-ui="crm-stage-menu-content">
            <a data-ui="crm-stage-menu-item" href=${stage.createHref}>${stage.createLabel ?? labels.create}</a>
            <a data-ui="crm-stage-menu-item" href=${stage.loadMoreHref}>${labels.loadMore}</a>
          </div>
        </details>
      </header>
      <div data-ui="crm-kanban-cards">
        ${stageRows.length === 0 ? html`<p data-ui="crm-kanban-empty">${labels.empty}</p>` : ''}
        ${each(stageRows, (entry) => entry.id, card)}
        ${
          stageRows.length < Number(stage.total ?? 0)
            ? html`<a data-ui="crm-kanban-more" href=${stage.loadMoreHref}>${labels.loadMore}</a>`
            : ''
        }
      </div>
      <a data-ui="crm-kanban-add" href=${stage.createHref}>
        <svg data-ui="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14" /><path d="M12 5v14" /></svg>
        ${stage.createLabel ?? labels.create}
      </a>
    </section>`
  }

  return () => html`<section data-ui="crm-kanban" aria-live="polite">
    ${error() ? html`<div data-ui="crm-kanban-error" role="alert">${error()}</div>` : ''}
    <div data-ui="crm-kanban-board">${each(initial.stages, (stage) => stage.id, stageColumn)}</div>
  </section>`
}
