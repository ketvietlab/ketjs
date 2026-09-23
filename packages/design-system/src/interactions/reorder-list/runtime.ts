const rootOf = (event: Event): HTMLElement | null =>
  event.currentTarget instanceof HTMLElement ? event.currentTarget : null

const commit = (root: HTMLElement, ids: string[], focusId?: string): void => {
  const control = root.querySelector<HTMLInputElement>('[data-ui="reorder-list-value"]')
  if (!control || control.disabled) return
  control.value = JSON.stringify(ids)
  control.dispatchEvent(new Event('change', { bubbles: true }))
  requestAnimationFrame(() => {
    const refreshed = document.getElementById(root.id)
    const row = [...(refreshed?.querySelectorAll<HTMLElement>('[data-ui="reorder-list-row"]') ?? [])].find(
      (item) => item.dataset.reorderId === focusId,
    )
    const focus =
      row?.querySelector<HTMLElement>('input:not([type="hidden"]), button') ??
      refreshed?.querySelector<HTMLElement>('[data-reorder-action="add"] button')
    focus?.focus()
  })
}

export const reorderClick = (event: Event): void => {
  const root = rootOf(event)
  const target =
    event.target instanceof Element ? event.target.closest<HTMLElement>('[data-reorder-action]') : null
  if (!root || !target || target.querySelector('button:disabled')) return
  const control = root.querySelector<HTMLInputElement>('[data-ui="reorder-list-value"]')
  if (!control || control.disabled) return
  const ids = JSON.parse(control.value) as string[]
  const id = target.closest<HTMLElement>('[data-reorder-id]')?.dataset.reorderId
  const index = id ? ids.indexOf(id) : -1
  const action = target.dataset.reorderAction
  if (action === 'add') {
    const next = crypto.randomUUID()
    commit(root, [...ids, next], next)
  } else if (index >= 0 && action === 'remove') {
    ids.splice(index, 1)
    commit(root, ids, ids[Math.min(index, ids.length - 1)])
  } else if (index >= 0 && (action === 'up' || action === 'down')) {
    const next = index + (action === 'up' ? -1 : 1)
    if (next < 0 || next >= ids.length) return
    ;[ids[index], ids[next]] = [ids[next]!, ids[index]!]
    commit(root, ids, id)
  }
}

export const reorderDragStart = (event: DragEvent): void => {
  const handle =
    event.target instanceof Element ? event.target.closest<HTMLElement>('[data-reorder-handle]') : null
  if (!handle || handle.querySelector('button:disabled')) {
    event.preventDefault()
    return
  }
  const row = handle.closest<HTMLElement>('[data-reorder-id]')
  const root = rootOf(event)
  if (!row || !root || !event.dataTransfer) return
  event.dataTransfer.setData(
    'application/x-ket-reorder',
    JSON.stringify({ root: root.id, id: row.dataset.reorderId }),
  )
  event.dataTransfer.effectAllowed = 'move'
}
export const reorderDragOver = (event: DragEvent): void => {
  if (event.dataTransfer?.types.includes('application/x-ket-reorder')) event.preventDefault()
}
export const reorderDrop = (event: DragEvent): void => {
  const root = rootOf(event)
  const row = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-reorder-id]') : null
  const raw = event.dataTransfer?.getData('application/x-ket-reorder')
  if (!root || !row || !raw) return
  event.preventDefault()
  try {
    const source = JSON.parse(raw) as { root: string; id: string }
    if (source.root !== root.id) return
    const control = root.querySelector<HTMLInputElement>('[data-ui="reorder-list-value"]')
    const ids = JSON.parse(control?.value ?? '[]') as string[]
    const from = ids.indexOf(source.id),
      to = ids.indexOf(row.dataset.reorderId ?? '')
    if (from < 0 || to < 0 || from === to) return
    ids.splice(from, 1)
    ids.splice(to, 0, source.id)
    commit(root, ids, source.id)
  } catch {
    /* Ignore foreign or malformed drag payloads. */
  }
}
