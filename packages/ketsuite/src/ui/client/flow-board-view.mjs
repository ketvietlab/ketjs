// @ts-nocheck Dependency-free shared browser/SSR view.
// Direct port of crm_backend/client/crm-kanban-view.mjs's shape: server
// resolves columns + issues into one JSON prop, this renders it and drags
// cards with native HTML5 DnD, calling flow.issue.move directly on drop —
// same conflict-reload-on-mismatch behavior, same no-JS <form> fallback.
const LABELS = {
  vi: {
    empty: 'Không có issue ở cột này.',
    move: 'Chuyển cột',
    moving: 'Đang chuyển…',
    conflict: 'Issue vừa thay đổi. Board sẽ tải lại để lấy phiên bản mới nhất.',
    unassigned: 'Chưa gán',
    loadMore: 'Tải thêm',
    moveShort: 'Chuyển',
  },
  en: {
    empty: 'No issues in this column.',
    move: 'Move column',
    moving: 'Moving…',
    conflict: 'The issue changed elsewhere. The board will reload the latest version.',
    unassigned: 'Unassigned',
    loadMore: 'Load more',
    moveShort: 'Move',
  },
}

const dataOf = (props) => {
  const fallback = LABELS[String(props.lang).toLowerCase().startsWith('en') ? 'en' : 'vi']
  try {
    const value = JSON.parse(String(props.data ?? '{}'))
    return {
      rows: Array.isArray(value.rows) ? value.rows : [],
      columns: Array.isArray(value.columns) ? value.columns : [],
      labels: {
        ...fallback,
        ...(value.labels && typeof value.labels === 'object' ? value.labels : {}),
        errors: value.labels?.errors || {},
      },
    }
  } catch {
    return { rows: [], columns: [], labels: fallback }
  }
}

export const boardMovePayload = (id, columnId, expectedVersion, idempotencyKey) => ({
  id,
  columnId,
  expectedVersion,
  idempotencyKey,
})

const callMove = async (payload) => {
  const response = await fetch('/_ket/fn/flow.issue.move', {
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

export function createFlowBoardView(runtime, props, seed = {}) {
  const { each, html, signal } = runtime
  const initial = dataOf(props)
  const labels = initial.labels
  const rows = signal(seed.rows ?? initial.rows)
  const busy = signal('')
  const error = signal('')
  const dragId = signal('')

  const move = async (entry, columnId) => {
    if (!columnId || columnId === entry.columnId || busy()) return
    busy.set(entry.id)
    error.set('')
    try {
      const result = await callMove(
        boardMovePayload(entry.id, columnId, Number(entry.version), crypto.randomUUID()),
      )
      rows.set(
        rows().map((row) => (row.id === entry.id ? { ...row, columnId, version: result.version } : row)),
      )
    } catch (caught) {
      // `issue.move` refuses more than a stale version: dropping a card into
      // a terminal column while a `blocks` dependency is unfinished answers
      // `flow.error.blocked`. Reporting every refusal as a conflict told the
      // user to reload and showed them the same card in the same place with
      // no reason given, while the real message sat translated in the
      // catalogue. Only a genuine version clash is worth a reload — the rest
      // leave the board as it is and say what happened.
      const code = String(caught?.message ?? '')
      const known = labels.errors?.[code]
      error.set(known ?? labels.conflict)
      if (!known && typeof window !== 'undefined') setTimeout(() => window.location.reload(), 900)
    } finally {
      busy.set('')
    }
  }

  const boardColumn = (column) => {
    const columnRows = rows().filter((row) => row.columnId === column.id)
    return html`<section data-ui="flow-board-column" data-column=${column.id}
      on:dragover=${(event) => event.preventDefault()}
      on:drop=${() => {
        const entry = rows().find((row) => row.id === dragId())
        if (entry) move(entry, column.id)
      }}>
      <header data-ui="flow-board-heading">
        <h2>${column.name}</h2>
        <span>${columnRows.length} / ${column.total ?? columnRows.length}</span>
      </header>
      <div data-ui="flow-board-cards">
        ${columnRows.length === 0 ? html`<p data-ui="flow-board-empty">${labels.empty}</p>` : ''}
        ${each(
          columnRows,
          (entry) => entry.id,
          (entry) => html`<article data-ui="flow-board-card" draggable="true"
          on:dragstart=${() => dragId.set(entry.id)} data-priority=${String(entry.priority ?? 'normal')} data-busy=${busy() === entry.id}>
          <h3><a href=${`/admin/flow/issues/${entry.id}`}>${entry.title}</a></h3>
          <p data-ui="flow-board-figures">
            <small>${entry.assigneeName ?? labels.unassigned}</small>
            ${entry.dueDate ? html`<small>${entry.dueDate}</small>` : ''}
          </p>
          <form data-ui="flow-board-move" method="post" action=${`/admin/flow/projects/${entry.projectId}/board/move`}>
            <input type="hidden" name="id" value=${entry.id} autocomplete="off">
            <input type="hidden" name="expectedVersion" value=${String(entry.version)} autocomplete="off">
            <input type="hidden" name="idempotencyKey" value=${`board:${entry.id}:${entry.version}`} autocomplete="off">
            <select data-ui="form-control" name="columnId" aria-label=${labels.move} on:change=${(event) => move(entry, event.target.value)} disabled=${busy() === entry.id}>
              ${each(
                initial.columns,
                (option) => option.id,
                (option) =>
                  html`<option value=${option.id} selected=${option.id === entry.columnId}>${option.name}</option>`,
              )}
            </select>
            <button type="submit" data-ui="action" data-variant="tertiary" data-size="compact" title=${labels.move} disabled=${busy() === entry.id}>${busy() === entry.id ? labels.moving : labels.moveShort}</button>
          </form>
        </article>`,
        )}
      </div>
      ${column.loadMoreHref ? html`<a data-ui="action" data-variant="secondary" data-size="compact" href=${column.loadMoreHref}>${labels.loadMore}</a>` : ''}
    </section>`
  }

  return () => html`<section data-ui="flow-board" aria-live="polite">
    ${error() ? html`<div data-ui="flow-board-error" role="alert">${error()}</div>` : ''}
    <div data-ui="flow-board-columns">${each(initial.columns, (column) => column.id, boardColumn)}</div>
  </section>`
}
