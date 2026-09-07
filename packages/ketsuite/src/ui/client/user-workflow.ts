let installed = false
export function installUserWorkflow() {
  if (installed) return
  installed = true
  let abort: AbortController | undefined,
    timer: ReturnType<typeof setTimeout> | undefined,
    sequence = 0
  async function check(form: HTMLFormElement) {
    const input = form.querySelector<HTMLInputElement>('input[type=email]'),
      status = form.querySelector<HTMLElement>('[data-email-status]')
    if (!input || !status) return
    abort?.abort()
    clearTimeout(timer)
    const request = ++sequence
    const value = input.value.trim(),
      next = form.querySelector<HTMLButtonElement>('button[type="submit"][name="step"]'),
      retry = form.querySelector<HTMLElement>('[data-email-retry]')
    const paint = (message: string, valid: boolean) => {
      status.textContent = message
      if (next) next.disabled = !valid
      input.setAttribute('aria-invalid', String(!valid))
      form.dataset.emailAvailable = valid ? 'true' : 'false'
    }
    if (retry) retry.hidden = true
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
      paint(value ? 'Email chưa đúng định dạng.' : 'Nhập email để kiểm tra.', false)
      return
    }
    paint('Đang kiểm tra email…', false)
    timer = setTimeout(async () => {
      abort = new AbortController()
      try {
        const response = await fetch(form.dataset.emailCheck!, {
          method: 'POST',
          cache: 'no-store',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ email: value }),
          signal: AbortSignal.any([abort.signal, AbortSignal.timeout(10000)]),
        })
        if (!response.ok) throw new Error('email-check-failed')
        const result = (await response.json()) as { available: boolean; ok: boolean }
        if (request !== sequence || !form.isConnected) return
        if (!result.ok) throw new Error('email-check-failed')
        paint(
          result.available ? 'Email có thể sử dụng.' : 'Email đã được sử dụng. Nhập email khác.',
          result.available,
        )
      } catch {
        if (request !== sequence || !form.isConnected) return
        paint('Chưa kiểm tra được email. Vui lòng thử lại.', false)
        if (retry) retry.hidden = false
      }
    }, 400)
  }
  function scope(form: HTMLFormElement, changed = false) {
    const company = form.querySelector<HTMLSelectElement>('select[name="companyId"]'),
      branch = form.querySelector<HTMLSelectElement>('select[name="branchId"]'),
      kind = form.querySelector<HTMLSelectElement>('select[name="scopeKind"]')?.value
    if (branch && company) {
      if (changed) branch.value = ''
      for (const option of branch.options) {
        if (option.value) {
          option.hidden = option.dataset.companyId !== company.value
          option.disabled = option.hidden
        }
      }
    }
    const key =
      kind === 'tenant'
        ? 'tenant'
        : kind === 'branch'
          ? `branch:${company?.value}:${branch?.value}`
          : `company:${company?.value}`
    for (const input of form.querySelectorAll<HTMLInputElement>('[data-assigned-scopes]')) {
      const scopes = JSON.parse(input.dataset.assignedScopes ?? '[]') as string[]
      const assigned = scopes.includes(key)
      input.disabled = input.dataset.roleDisabled === 'true' || assigned
      const row = input.closest('[data-role-option]')
      const assignedLabel = row?.querySelector<HTMLElement>('[data-role-assigned]')
      const description = row?.querySelector<HTMLElement>('[data-role-description]')
      if (assignedLabel) assignedLabel.hidden = !assigned
      if (description) description.hidden = assigned
      if (input.disabled) input.checked = false
    }
    const companyField = company?.closest<HTMLElement>('[data-ui="form-field"]')
    const branchField = branch?.closest<HTMLElement>('[data-ui="form-field"]')
    if (companyField) companyField.hidden = kind === 'tenant'
    if (branchField) branchField.hidden = kind === 'tenant' || kind === 'company'
  }
  function scan() {
    for (const form of document.querySelectorAll<HTMLFormElement>('form[data-user-workflow]'))
      if (!form.dataset.initialized) {
        form.dataset.initialized = 'true'
        scope(form)
        void check(form)
      }
  }
  document.addEventListener('input', (event) => {
    const input = event.target as HTMLInputElement,
      form = input.closest<HTMLFormElement>('form[data-user-workflow]')
    if (!form) return
    if (input.type === 'email') void check(form)
    if (input.matches('[data-role-search]')) {
      let n = 0
      for (const row of form.querySelectorAll<HTMLElement>('[data-role-option]')) {
        row.hidden = !row.textContent?.toLocaleLowerCase('vi').includes(input.value.toLocaleLowerCase('vi'))
        if (!row.hidden) n++
      }
      const empty = form.querySelector<HTMLElement>('[data-role-empty]')
      if (empty) empty.hidden = n > 0
    }
  })
  document.addEventListener('change', (event) => {
    const input = event.target as HTMLElement,
      form = input.closest<HTMLFormElement>('form[data-user-workflow]')
    if (form && input.matches('select[name="companyId"],select[name="branchId"],select[name="scopeKind"]'))
      scope(form, input.matches('select[name="companyId"]'))
  })
  document.addEventListener('click', (event) => {
    const target = event.target as HTMLElement
    const retry = target.closest<HTMLElement>('[data-email-retry]')
    if (retry) void check(retry.closest('form')!)
  })
  document.addEventListener('submit', (event) => {
    const form = event.target as HTMLFormElement
    if (
      form.matches('form[data-user-workflow]') &&
      form.querySelector('input[type=email]') &&
      form.dataset.emailAvailable !== 'true'
    )
      event.preventDefault()
  })
  new MutationObserver(scan).observe(document.documentElement, { childList: true, subtree: true })
  scan()
}
