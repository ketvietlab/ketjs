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
  },
  en: {
    empty: 'No cases in this stage.',
    move: 'Move stage',
    moving: 'Moving…',
    conflict: 'The case changed elsewhere. The pipeline will reload the latest version.',
    open: 'Open case',
    unassigned: 'Unassigned',
    loadMore: 'Load more',
  },
}

const labelsOf = (props) => LABELS[String(props.lang).toLowerCase().startsWith('en') ? 'en' : 'vi']
const dataOf = (props) => {
  try {
    const value = JSON.parse(String(props.data ?? '{}'))
    return {
      rows: Array.isArray(value.rows) ? value.rows : [],
      stages: Array.isArray(value.stages) ? value.stages : [],
    }
  } catch {
    return { rows: [], stages: [] }
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
  const labels = labelsOf(props)
  const initial = dataOf(props)
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
      <header data-ui="crm-kanban-stage"><h2>${stage.name}</h2><span>${stageRows.length} / ${stage.total ?? stageRows.length}</span></header>
      <div data-ui="crm-kanban-cards">
        ${stageRows.length === 0 ? html`<p data-ui="crm-kanban-empty">${labels.empty}</p>` : ''}
        ${each(
          stageRows,
          (entry) => entry.id,
          (entry) => html`<article data-ui="crm-kanban-card" draggable="true"
          on:dragstart=${() => dragId.set(entry.id)} data-kind=${entry.kind} data-busy=${busy() === entry.id}>
          <h3><a href=${`/admin/crm/cases/${entry.id}`}>${entry.name}</a></h3>
          <p>${entry.partnerName ?? entry.contactName ?? '—'}</p>
          <small>${entry.assigneeName ?? labels.unassigned}</small>
          <form method="post" action="/admin/crm/pipeline/move">
            <input type="hidden" name="id" value=${entry.id}>
            <input type="hidden" name="expectedVersion" value=${String(entry.version)}>
            <input type="hidden" name="idempotencyKey" value=${`pipeline:${entry.id}:${entry.version}`}>
            <label>${labels.move}<select name="stageId" on:change=${(event) => move(entry, event.target.value)} disabled=${busy() === entry.id}>
              ${each(
                initial.stages,
                (option) => option.id,
                (option) =>
                  html`<option value=${option.id} selected=${option.id === entry.stageId}>${option.name}</option>`,
              )}
            </select></label>
            <button type="submit" data-ui="action" data-variant="secondary" data-size="compact" disabled=${busy() === entry.id}>${busy() === entry.id ? labels.moving : labels.move}</button>
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
