// @ts-nocheck Dependency-free shared browser/SSR view.
const LABELS = {
  vi: {
    empty: 'Không có hồ sơ ở giai đoạn này.',
    move: 'Chuyển giai đoạn',
    moving: 'Đang chuyển…',
    conflict: 'Hồ sơ vừa thay đổi. Pipeline sẽ tải lại để lấy phiên bản mới nhất.',
    open: 'Mở hồ sơ',
    unassigned: 'Chưa phân công',
    loadMore: 'Tải thêm',
    moveShort: 'Chuyển',
  },
  en: {
    empty: 'No cases in this stage.',
    move: 'Move stage',
    moving: 'Moving…',
    conflict: 'The case changed elsewhere. The pipeline will reload the latest version.',
    open: 'Open case',
    unassigned: 'Unassigned',
    loadMore: 'Load more',
    moveShort: 'Move',
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

  const stageColumn = (stage) => {
    const stageRows = rows().filter((row) => row.stageId === stage.id)
    return html`<section data-ui="crm-kanban-column" data-stage=${stage.id}
      on:dragover=${(event) => event.preventDefault()}
      on:drop=${() => {
        const entry = rows().find((row) => row.id === dragId())
        if (entry) move(entry, stage.id)
      }}>
      <header data-ui="crm-kanban-stage">
        <h2>${stage.name}</h2>
        <span>${stageRows.length} / ${stage.total ?? stageRows.length}</span>
      </header>
      <div data-ui="crm-kanban-cards">
        ${stageRows.length === 0 ? html`<p data-ui="crm-kanban-empty">${labels.empty}</p>` : ''}
        ${each(
          stageRows,
          (entry) => entry.id,
          (entry) => html`<article data-ui="crm-kanban-card" draggable="true"
          on:dragstart=${() => dragId.set(entry.id)} data-kind=${entry.kind} data-priority=${String(entry.priority ?? '1')} data-busy=${busy() === entry.id}>
          <h3><a href=${`/admin/crm/cases/${entry.id}`}>${entry.name}</a></h3>
          <p data-ui="crm-kanban-party">${entry.partnerName ?? entry.contactName ?? entry.email ?? '—'}</p>
          <p data-ui="crm-kanban-figures">
            <strong>${entry.revenue ?? '—'}</strong>
            <small>${entry.assigneeName ?? labels.unassigned}</small>
          </p>
          <form data-ui="crm-kanban-move" method="post" action="/admin/crm/pipeline/move">
            <input type="hidden" name="id" value=${entry.id}>
            <input type="hidden" name="expectedVersion" value=${String(entry.version)}>
            <input type="hidden" name="idempotencyKey" value=${`pipeline:${entry.id}:${entry.version}`}>
            <select data-ui="form-control" name="stageId" aria-label=${labels.move} on:change=${(event) => move(entry, event.target.value)} disabled=${busy() === entry.id}>
              ${each(
                initial.stages,
                (option) => option.id,
                (option) =>
                  html`<option value=${option.id} selected=${option.id === entry.stageId}>${option.name}</option>`,
              )}
            </select>
            <button type="submit" data-ui="action" data-variant="tertiary" data-size="compact" title=${labels.move} disabled=${busy() === entry.id}>${busy() === entry.id ? labels.moving : labels.moveShort}</button>
          </form>
        </article>`,
        )}
      </div>
      ${stage.loadMoreHref ? html`<a data-ui="action" data-variant="secondary" data-size="compact" href=${stage.loadMoreHref}>${labels.loadMore}</a>` : ''}
    </section>`
  }

  return () => html`<section data-ui="crm-kanban" aria-live="polite">
    ${error() ? html`<div data-ui="crm-kanban-error" role="alert">${error()}</div>` : ''}
    <div data-ui="crm-kanban-board">${each(initial.stages, (stage) => stage.id, stageColumn)}</div>
  </section>`
}
