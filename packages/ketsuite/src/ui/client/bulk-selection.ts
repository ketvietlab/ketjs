/**
 * External row checkboxes belong to their native form, even when the form is
 * hidden. Keep each legacy bulk form and the public ListPage action slot in sync
 * with that association instead of using selection anywhere in the app shell.
 */
export const installBulkSelection = (root: Document, signal: AbortSignal): (() => void) => {
  const hasContent = (node: Node): boolean => {
    if (node.nodeType === 3) return Boolean(node.textContent?.trim())
    if (!(node instanceof Element)) return false
    if (node.matches('[data-ui="bulk-form"]')) return !(node as HTMLFormElement).hidden
    if (node.matches('[data-ui="inline"], [data-ui="list-page-tools"]'))
      return [...node.childNodes].some(hasContent)
    return true
  }

  const sync = (): void => {
    if (signal.aborted) return
    const slots = new Set<HTMLElement>()
    for (const form of root.querySelectorAll<HTMLFormElement>('form[data-ui="bulk-form"]')) {
      const selected = [...form.elements].some(
        (control) =>
          control instanceof HTMLInputElement &&
          !control.disabled &&
          ((control.matches('[data-ui="row-select"], [data-ui="kt-row-select"]') && control.checked) ||
            (control.type === 'hidden' &&
              control.parentElement?.matches('[data-ui="kt-select-persisted"]') &&
              control.value === '1')),
      )
      form.hidden = !selected
      if (!selected)
        for (const menu of form.querySelectorAll<HTMLDetailsElement>('details[data-ui="bulk-actions"][open]'))
          menu.open = false
      const tools = form.closest<HTMLElement>('[data-ui="list-page-tools"]')
      if (tools) slots.add(tools)
      const slot = form.closest<HTMLElement>('[data-ui="list-page-actions"]')
      if (slot) slots.add(slot)
    }
    for (const slot of slots) slot.hidden = ![...slot.childNodes].some(hasContent)
  }

  let queued = false
  const schedule = (): void => {
    if (queued || signal.aborted) return
    queued = true
    queueMicrotask(() => {
      queued = false
      sync()
    })
  }
  root.addEventListener('change', schedule, { signal })
  root.addEventListener('reset', schedule, { signal })
  const observer = new MutationObserver(schedule)
  observer.observe(root, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['checked', 'disabled', 'form'],
  })
  const cleanup = (): void => observer.disconnect()
  signal.addEventListener('abort', cleanup, { once: true })
  sync()
  return cleanup
}
