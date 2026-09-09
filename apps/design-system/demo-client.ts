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

  const submenu = app.querySelector<HTMLElement>('[data-demo-submenu]')
  const submenuTrigger = submenu?.querySelector<HTMLButtonElement>('[data-demo-submenu-trigger]')
  const submenuPanel = submenu?.querySelector<HTMLElement>('[data-demo-submenu-children]')
  const setSubmenuOpen = (open: boolean) => {
    if (!submenuTrigger || !submenuPanel) return
    submenuTrigger.setAttribute('aria-expanded', String(open))
    submenuPanel.hidden = !open
  }
  submenuTrigger?.addEventListener('click', () => {
    setSubmenuOpen(submenuTrigger.getAttribute('aria-expanded') !== 'true')
  })
  document.addEventListener('click', (event) => {
    if (event.target instanceof Node && submenu && !submenu.contains(event.target)) setSubmenuOpen(false)
  })
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || submenuTrigger?.getAttribute('aria-expanded') !== 'true') return
    setSubmenuOpen(false)
    submenuTrigger.focus()
  })

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
