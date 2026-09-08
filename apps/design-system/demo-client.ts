// Progressive enhancement belongs to this demo app, not to the component package.
const app = document.querySelector<HTMLElement>('[data-demo-app]')
if (app) {
  const rows = [...app.querySelectorAll<HTMLInputElement>('[data-ui="row-select"]')]
  const all = app.querySelector<HTMLInputElement>('[data-ui="select-all"]')
  const updateSelection = () => {
    const count = rows.filter((row) => row.checked).length
    const summary = document.getElementById('selection-summary')
    const bulk = app.querySelector<HTMLElement>('[data-ui="bulk-actions"]')
    if (summary) summary.textContent = `${count} đơn được chọn`
    if (bulk) {
      if (count > 0) bulk.setAttribute('data-has-selection', 'true')
      else bulk.removeAttribute('data-has-selection')
    }
    app.querySelectorAll<HTMLButtonElement>('[data-ui="bulk-actions"] button').forEach((button) => {
      button.disabled = count === 0
    })
    if (all) {
      all.checked = rows.length > 0 && count === rows.length
      all.indeterminate = count > 0 && count < rows.length
    }
  }
  all?.addEventListener('change', () => {
    rows.forEach((row) => {
      row.checked = all.checked
    })
    updateSelection()
  })
  rows.forEach((row) => {
    row.addEventListener('change', updateSelection)
  })
  updateSelection()

  const modal = app.querySelector<HTMLElement>('[data-ui="modal-sheet"]')
  if (modal) {
    const shell = app.querySelector<HTMLElement>('[data-ui="app-shell"]')!
    shell.inert = true
    document.body.style.overflow = 'hidden'
    const focusable = () => [
      ...modal.querySelectorAll<HTMLElement>(
        'a[href], button:not(:disabled), input:not([type="hidden"]):not(:disabled), select, textarea, [tabindex="0"]',
      ),
    ]
    ;(focusable().find((element) => element.matches('input, select, textarea')) ?? modal).focus()
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        modal.querySelector<HTMLAnchorElement>('[data-ui="modal-close"]')?.click()
      }
      if (event.key !== 'Tab') return
      const elements = focusable()
      const first = elements[0],
        last = elements.at(-1)
      if (event.shiftKey && (document.activeElement === first || document.activeElement === modal)) {
        event.preventDefault()
        last?.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first?.focus()
      }
    })
  }
  const form = app.querySelector<HTMLFormElement>('#order-form')
  let dirty = false
  form?.addEventListener('input', () => {
    dirty = true
  })
  form?.addEventListener('submit', () => {
    dirty = false
  })
  window.addEventListener('beforeunload', (event) => {
    if (dirty) {
      event.preventDefault()
      event.returnValue = ''
    }
  })
}
