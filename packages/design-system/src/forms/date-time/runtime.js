// @ts-check
import {
  addDays,
  formatRange,
  monthEnd,
  monthStart,
  moveMonth,
  orderedRange,
  parseDate,
  presetRange,
  withinBounds,
} from './date-math.js'

/** An already validated calendar day. @param {string} value */
const civil = (value) => {
  const date = parseDate(value)
  if (!date) throw new RangeError(`Invalid civil date: ${value}`)
  return date
}
/** @param {HTMLInputElement} input @param {string} value */
const allowed = (input, value) => {
  if (!withinBounds(value, input.min, input.max)) return false
  const step = Number(input.step || 1)
  if (input.step === 'any' || !Number.isFinite(step) || step <= 0) return true
  const base = parseDate(input.min) ?? parseDate(input.getAttribute('value') ?? '') ?? civil('1970-01-01')
  return Math.abs(((civil(value).getTime() - base.getTime()) / 86400000 / step) % 1) < 0.000001
}
/** @type {WeakMap<HTMLElement, { users: number, prior: boolean }>} */
const inertLayers = new WeakMap()
let scrollLocks = 0
let priorOverflow = ''
let priorOverflowPriority = ''
/** Make the fullscreen calendar modal while preserving any outer dialog's locks.
 * @param {HTMLElement} popup */
const lockBackground = (popup) => {
  /** @type {HTMLElement[]} */
  const siblings = []
  let branch = popup
  while (branch.parentElement) {
    const parent = branch.parentElement
    for (const sibling of parent.children) {
      if (!(sibling instanceof HTMLElement) || sibling === branch) continue
      const state = inertLayers.get(sibling) ?? { users: 0, prior: sibling.inert }
      state.users++
      inertLayers.set(sibling, state)
      sibling.inert = true
      siblings.push(sibling)
    }
    if (parent === document.body) break
    branch = parent
  }
  const style = document.documentElement.style
  if (scrollLocks++ === 0) {
    priorOverflow = style.overflow
    priorOverflowPriority = style.getPropertyPriority('overflow')
    style.setProperty('overflow', 'hidden')
  }
  return () => {
    for (const sibling of siblings) {
      const state = inertLayers.get(sibling)
      if (state && --state.users === 0) {
        sibling.inert = state.prior
        inertLayers.delete(sibling)
      }
    }
    if (--scrollLocks === 0) {
      if (priorOverflow) style.setProperty('overflow', priorOverflow, priorOverflowPriority)
      else style.removeProperty('overflow')
    }
  }
}
/** Progressive compound date/time: one canonical submitted wall-time value.
 * @param {HTMLElement} picker */
const enhanceDateTime = (picker) => {
  const input = picker.querySelector('input[type="datetime-local"]')
  const day = picker.querySelector('input[type="date"]')
  const time = picker.querySelector('input[type="time"]')
  const parts = picker.querySelector('[data-ui="date-time-parts"]')
  if (
    !(input instanceof HTMLInputElement) ||
    !(day instanceof HTMLInputElement) ||
    !(time instanceof HTMLInputElement) ||
    !(parts instanceof HTMLElement)
  )
    return () => {}
  const validator = /** @type {HTMLInputElement} */ (input.cloneNode())
  const label = picker.querySelector('label')
  const originalFor = label?.getAttribute('for')
  const innerLabel = parts.querySelector('label')
  const innerFor = innerLabel?.getAttribute('for')
  const form = input.form
  input.type = 'hidden'
  parts.hidden = false
  label?.setAttribute('for', day.id)
  innerLabel?.removeAttribute('for')
  for (const node of parts.querySelectorAll('input,button')) {
    if (node instanceof HTMLInputElement || node instanceof HTMLButtonElement)
      node.disabled = input.disabled || (node instanceof HTMLButtonElement && input.readOnly)
  }
  for (const part of [day, time]) {
    const description = input.getAttribute('aria-describedby')
    if (description) part.setAttribute('aria-describedby', description)
  }
  const sync = () => {
    // Partial drafts survive record view-state re-renders; native child validation
    // prevents submission until both pieces are present.
    const value = day.value || time.value ? `${day.value}T${time.value}` : ''
    validator.value = day.value && time.value ? value : ''
    const partial = Boolean(day.value) !== Boolean(time.value)
    time.setCustomValidity(
      partial
        ? picker.dataset.dateLocale === 'en'
          ? 'Choose date and time.'
          : 'Chọn đủ ngày và giờ.'
        : validator.validationMessage,
    )
    if (input.value === value) return
    input.value = value
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new Event('change', { bubbles: true }))
  }
  /** @param {Event} event */
  const change = (event) => {
    if (event.target === day || event.target === time) sync()
  }
  let active = true
  const reset = () =>
    queueMicrotask(() => {
      if (!active) return
      const [date = '', clock = ''] = input.value.split('T')
      day.value = date
      time.value = clock
      sync()
    })
  picker.addEventListener('input', change)
  picker.addEventListener('change', change)
  form?.addEventListener('reset', reset)
  sync()
  return () => {
    active = false
    picker.removeEventListener('input', change)
    picker.removeEventListener('change', change)
    form?.removeEventListener('reset', reset)
    input.type = 'datetime-local'
    parts.hidden = true
    if (originalFor) label?.setAttribute('for', originalFor)
    if (innerFor) innerLabel?.setAttribute('for', innerFor)
    for (const node of parts.querySelectorAll('input,button'))
      if (node instanceof HTMLInputElement || node instanceof HTMLButtonElement) node.disabled = true
  }
}
/** @param {HTMLElement} picker */
const enhance = (picker) => {
  if (picker.dataset.dateMode === 'datetime') return enhanceDateTime(picker)
  const panel = picker.querySelector('[data-ui="date-calendar"]')
  const trigger = picker.querySelector('[name="kv-date-open"]')
  const inputs = /** @type {HTMLInputElement[]} */ ([
    ...picker.querySelectorAll('[data-ui="date-inputs"] input[type="date"], [data-ui="date-boundary"]'),
  ])
  if (
    !(panel instanceof HTMLElement) ||
    !(trigger instanceof HTMLButtonElement) ||
    !inputs.length ||
    !('showPopover' in panel)
  )
    return () => {}
  const popup = panel
  const opener = trigger
  const range = picker.dataset.dateMode === 'range'
  const locale = picker.dataset.dateLocale === 'en' ? 'en-GB' : 'vi-VN'
  const weekStart = Number(picker.dataset.dateWeekStart ?? 1)
  const labels = /** @type {import('./index.tsx').DatePickerLabels} */ (
    JSON.parse(picker.dataset.dateLabels ?? '{}')
  )
  const months = /** @type {HTMLElement} */ (popup.querySelector('[data-ui="date-calendar-months"]'))
  const status = /** @type {HTMLElement} */ (popup.querySelector('[data-ui="date-calendar-status"]'))
  const apply = /** @type {HTMLButtonElement} */ (popup.querySelector('[value="apply"]'))
  const message = picker.querySelector('[data-ui="date-range-error"]')
  const end = inputs[1]
  const defaults = inputs.map((input) => input.value)
  const display = picker.querySelector('input[type="text"]')
  const preset = picker.querySelector('select')
  const field = display instanceof HTMLInputElement ? display : end
  const originalInvalid = field?.getAttribute('aria-invalid')
  const originalDescription = field?.getAttribute('aria-describedby')
  let returnFocus = /** @type {HTMLElement} */ (opener)
  const readToday = () => {
    const local = new Date()
    const fallback = `${local.getFullYear()}-${String(local.getMonth() + 1).padStart(2, '0')}-${String(local.getDate()).padStart(2, '0')}`
    return parseDate(picker.dataset.dateToday ?? '') ? (picker.dataset.dateToday ?? fallback) : fallback
  }
  const formatter = new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  })
  const short = new Intl.DateTimeFormat(locale, {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: 'UTC',
  })
  const monthFormat = new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric', timeZone: 'UTC' })
  const weekdayFormat = new Intl.DateTimeFormat(locale, { weekday: 'short', timeZone: 'UTC' })
  let today = readToday()
  let month = ''
  let focusDate = ''
  let preferredPreset = ''
  /** @type {string[]} */
  let draft = []
  const isOpen = () => popup.matches(':popover-open')
  const isMobile = () => window.innerWidth < 768
  /** @type {(() => void) | null} */
  let unlock = null
  const syncPresentation = () => {
    if (isOpen() && isMobile()) {
      unlock ??= lockBackground(popup)
      popup.setAttribute('aria-modal', 'true')
    } else {
      unlock?.()
      unlock = null
      popup.removeAttribute('aria-modal')
    }
  }
  const monthCount = () => (range ? (isMobile() ? 12 : 2) : 1)
  /** @param {string} value */
  const calendarStart = (value) => {
    const start = monthStart(value)
    return range && isMobile() ? moveMonth(start, -2) || start : start
  }
  const visibleMonth = () => {
    const top = months.getBoundingClientRect().top
    const section = [...months.children].find((child) => child.getBoundingClientRect().bottom > top + 1)
    return section instanceof HTMLElement ? (section.dataset.dateMonth ?? month) : month
  }
  const revealMonth = () => {
    if (!range || !isMobile()) return
    const section = months.querySelector(`[data-date-month="${monthStart(focusDate)}"]`)
    if (section instanceof HTMLElement) {
      months.scrollTop +=
        section.getBoundingClientRect().top -
        months.getBoundingClientRect().top -
        parseFloat(getComputedStyle(months).paddingTop)
    }
  }
  /** @param {HTMLElement} day */
  const revealDay = (day) => {
    if (!isMobile()) return
    const box = day.getBoundingClientRect()
    const viewport = months.getBoundingClientRect()
    if (box.top < viewport.top) months.scrollTop += box.top - viewport.top
    else if (box.bottom > viewport.bottom) months.scrollTop += box.bottom - viewport.bottom
  }
  const enabled = () => inputs.every((input) => !input.disabled && !input.readOnly)
  const valid = () =>
    !!draft[0] &&
    allowed(inputs[0], draft[0]) &&
    (!range || (!!draft[1] && draft[0] <= draft[1] && allowed(end, draft[1])))
  const validate = () => {
    if (!end || !field) return true
    const startValue = inputs[0].value
    const endValue = end.value
    const empty = !startValue && !endValue
    const invalid =
      !inputs[0].disabled &&
      !end.disabled &&
      (empty
        ? inputs.some((input) => input.required)
        : !allowed(inputs[0], startValue) || !allowed(end, endValue) || startValue > endValue)
    if (display instanceof HTMLInputElement) display.value = formatRange(startValue, endValue)
    if (message instanceof HTMLElement) {
      message.hidden = !invalid
      field.setAttribute(
        'aria-describedby',
        [originalDescription, invalid ? message.id : ''].filter(Boolean).join(' '),
      )
    }
    if (invalid) field.setAttribute('aria-invalid', 'true')
    else if (originalInvalid) field.setAttribute('aria-invalid', originalInvalid)
    else field.removeAttribute('aria-invalid')
    if (preset instanceof HTMLSelectElement) {
      preset.disabled = !enabled()
      const matching = [...preset.options].filter((option) => {
        const period = presetRange(option.value, today)
        option.disabled = !!period && (!allowed(inputs[0], period[0]) || !allowed(end, period[1]))
        return period && period[0] === startValue && period[1] === endValue
      })
      preset.value =
        (matching.find((option) => option.value === preferredPreset) ?? matching[0])?.value ?? 'custom'
    }
    return !invalid
  }
  /** @param {string[]} values */
  const commit = (values) => {
    const changed = inputs.filter((input, index) => input.value !== values[index])
    inputs.forEach((input, index) => {
      input.value = values[index]
    })
    validate()
    for (const input of [
      ...changed,
      ...(changed.length && display instanceof HTMLInputElement ? [display] : []),
    ]) {
      input.dispatchEvent(new Event('input', { bubbles: true }))
      input.dispatchEvent(new Event('change', { bubbles: true }))
    }
  }
  /** @param {string} [preview] */
  const paint = (preview = '') => {
    const [from, to] =
      range && draft[0] && !draft[1] && preview
        ? orderedRange(draft[0], preview)
        : [draft[0], draft[1] ?? draft[0]]
    for (const node of months.querySelectorAll('button[data-date]')) {
      const button = /** @type {HTMLButtonElement} */ (node)
      const day = button.dataset.date ?? ''
      const cell = button.parentElement
      const selected = day === draft[0] || day === draft[1]
      button.dataset.selected = String(selected)
      if (cell) {
        cell.dataset.inRange = String(range && !!from && !!to && day >= from && day <= to)
        cell.setAttribute(
          'aria-selected',
          String(selected || (range && !!from && !!to && day >= from && day <= to)),
        )
      }
    }
  }
  const position = () => {
    if (!isOpen() || isMobile()) return
    const anchor = picker.querySelector('[data-ui="date-field-control"]') ?? opener
    const rect = anchor.getBoundingClientRect()
    const inset = parseFloat(getComputedStyle(popup).scrollMarginTop)
    const gap = inset
    popup.style.setProperty('--kv-date-max-height', `${Math.max(0, window.innerHeight - inset * 2)}px`)
    const box = popup.getBoundingClientRect()
    const left = Math.max(
      inset,
      Math.min(
        rect.left + box.width <= window.innerWidth - inset ? rect.left : rect.right - box.width,
        window.innerWidth - box.width - inset,
      ),
    )
    const below = rect.bottom + gap
    const top =
      below + box.height <= window.innerHeight - inset ? below : Math.max(inset, rect.top - box.height - gap)
    popup.style.setProperty('--kv-date-left', `${left}px`)
    popup.style.setProperty('--kv-date-top', `${top}px`)
  }
  /** @param {boolean} [focus] */
  const render = (focus = false) => {
    const scrollTop = months.scrollTop
    months.replaceChildren()
    popup.dataset.months = String(monthCount())
    for (let index = 0; index < monthCount(); index++) {
      const current = moveMonth(month, index)
      if (!current) continue
      const section = document.createElement('section')
      section.dataset.ui = 'date-month'
      section.dataset.dateMonth = current
      const title = document.createElement('h4')
      title.dataset.ui = 'date-month-title'
      title.id = `${popup.id}-month-${index}`
      title.textContent = monthFormat.format(civil(current))
      if (!isMobile()) title.setAttribute('aria-live', 'polite')
      section.append(title)
      const table = document.createElement('table')
      table.dataset.ui = 'date-grid'
      table.setAttribute('role', 'grid')
      table.setAttribute('aria-labelledby', title.id)
      if (range) table.setAttribute('aria-multiselectable', 'true')
      const head = table.createTHead().insertRow()
      for (let column = 0; column < 7; column++) {
        const th = document.createElement('th')
        th.dataset.ui = 'date-weekday'
        th.scope = 'col'
        th.textContent = weekdayFormat.format(civil(addDays('2026-09-06', (column + weekStart) % 7)))
        head.append(th)
      }
      const body = table.createTBody()
      const offset = (civil(current).getUTCDay() - weekStart + 7) % 7
      const days = civil(monthEnd(current)).getUTCDate()
      const weeks = isMobile() ? Math.ceil((offset + days) / 7) : 6
      for (let row = 0; row < weeks; row++) {
        const tr = body.insertRow()
        for (let column = 0; column < 7; column++) {
          const cell = tr.insertCell()
          cell.dataset.ui = 'date-cell'
          const number = row * 7 + column - offset + 1
          if (number < 1 || number > days) {
            cell.setAttribute('aria-hidden', 'true')
            continue
          }
          const value = addDays(current, number - 1)
          const button = document.createElement('button')
          button.type = 'button'
          button.dataset.ui = 'date-day'
          button.dataset.date = value
          button.textContent = String(number)
          button.setAttribute('aria-label', formatter.format(civil(value)))
          if (value === today) button.setAttribute('aria-current', 'date')
          if (range && draft[0] && !draft[1]) {
            const [start, finish] = orderedRange(draft[0], value)
            button.disabled = !allowed(inputs[0], start) || !allowed(end, finish)
          } else button.disabled = !allowed(inputs[0], value)
          button.tabIndex = value === focusDate && !button.disabled ? 0 : -1
          cell.append(button)
        }
      }
      section.append(table)
      months.append(section)
    }
    months.scrollTop = scrollTop
    const focusable =
      months.querySelector('button[tabindex="0"]') ?? months.querySelector('button:not(:disabled)')
    if (focusable instanceof HTMLButtonElement) {
      focusable.tabIndex = 0
      focusDate = focusable.dataset.date ?? focusDate
      if (focus) {
        focusable.focus({ preventScroll: true })
        revealDay(focusable)
      }
    }
    for (const command of ['previous', 'next']) {
      const button = /** @type {HTMLButtonElement} */ (popup.querySelector(`[value="${command}"]`))
      button.disabled = !moveMonth(
        range && isMobile() ? monthStart(focusDate) : month,
        command === 'previous' ? -1 : range && isMobile() ? 1 : monthCount(),
      )
    }
    if (apply) apply.disabled = !valid()
    status.textContent = draft[0]
      ? range && !draft[1]
        ? `${short.format(civil(draft[0]))} · ${labels.chooseEnd}`
        : `${short.format(civil(draft[0]))}${range ? ` — ${short.format(civil(draft[1]))}` : ''}`
      : range
        ? labels.chooseStart
        : labels.chooseDate
    paint(focus && range && draft[0] && !draft[1] ? focusDate : '')
    position()
  }
  /** @param {HTMLElement} [source] */
  const open = (source = opener) => {
    if (!enabled()) return
    returnFocus = source
    today = readToday()
    draft = inputs.map((input) => (parseDate(input.value) ? input.value : ''))
    focusDate = draft[0] || today
    if (parseDate(inputs[0].min) && focusDate < inputs[0].min) focusDate = inputs[0].min
    if (parseDate(inputs[0].max) && focusDate > inputs[0].max) focusDate = inputs[0].max
    month = calendarStart(focusDate)
    render()
    popup.showPopover()
    syncPresentation()
    opener.setAttribute('aria-expanded', 'true')
    position()
    revealMonth()
    const first = months.querySelector('button[tabindex="0"]')
    if (first instanceof HTMLElement) {
      first.focus({ preventScroll: true })
      revealDay(first)
    } else {
      const cancel = popup.querySelector('[value="cancel"]')
      if (cancel instanceof HTMLElement) cancel.focus()
    }
  }
  /** @param {boolean} [restore] */
  const close = (restore = false) => {
    if (isOpen()) popup.hidePopover()
    syncPresentation()
    opener.setAttribute('aria-expanded', 'false')
    if (restore && returnFocus.isConnected) returnFocus.focus({ preventScroll: true })
  }
  /** @param {Event} event */
  const click = (event) => {
    if (event.target === display && display instanceof HTMLElement) {
      isOpen() ? close(true) : open(display)
      return
    }
    const target = event.target instanceof Element ? event.target.closest('button') : null
    if (!(target instanceof HTMLButtonElement) || target.disabled) return
    if (target === opener) {
      isOpen() ? close(true) : open()
      return
    }
    if (!popup.contains(target) || !enabled()) return
    if (target.dataset.date) {
      const value = target.dataset.date
      preferredPreset = ''
      draft = range ? (draft[0] && !draft[1] ? orderedRange(draft[0], value) : [value, '']) : [value]
      focusDate = value
      render(true)
    } else if (target.name === 'kv-date-command') {
      if (target.value === 'cancel' || target.value === 'close') close(true)
      else if (target.value === 'apply' && valid()) {
        const values = [...draft]
        close(true)
        commit(values)
      } else if (target.value === 'previous' || target.value === 'next') {
        const next = moveMonth(
          range && isMobile() ? visibleMonth() : month,
          target.value === 'previous' ? -1 : 1,
        )
        if (!next) return
        focusDate = next
        month = range && isMobile() ? calendarStart(next) : next
        render()
        revealMonth()
      }
    }
  }
  /** @param {KeyboardEvent} event */
  const keydown = (event) => {
    if (
      !isOpen() &&
      event.target === display &&
      display instanceof HTMLElement &&
      ['Enter', ' ', 'ArrowDown'].includes(event.key)
    ) {
      event.preventDefault()
      open(display)
      return
    }
    if (!isOpen()) return
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopImmediatePropagation()
      close(true)
      return
    }
    if (event.key === 'Tab' && isMobile()) {
      const items = [
        ...popup.querySelectorAll('button:not(:disabled):not([tabindex="-1"]), select:not(:disabled)'),
      ]
      const first = items[0]
      const last = items.at(-1)
      if (event.shiftKey && document.activeElement === first && last instanceof HTMLElement) {
        event.preventDefault()
        last.focus()
        return
      }
      if (!event.shiftKey && document.activeElement === last && first instanceof HTMLElement) {
        event.preventDefault()
        first.focus()
        return
      }
    }
    const target = event.target
    if (!(target instanceof HTMLButtonElement) || !target.dataset.date) return
    const value = target.dataset.date
    const weekday = (civil(value).getUTCDay() - weekStart + 7) % 7
    const offsets = {
      ArrowLeft: -1,
      ArrowRight: 1,
      ArrowUp: -7,
      ArrowDown: 7,
      Home: -weekday,
      End: 6 - weekday,
    }
    let next =
      event.key in offsets
        ? addDays(value, offsets[/** @type {keyof typeof offsets} */ (event.key)])
        : event.key === 'PageUp' || event.key === 'PageDown'
          ? moveMonth(value, (event.key === 'PageUp' ? -1 : 1) * (event.shiftKey ? 12 : 1))
          : ''
    if (!next) return
    event.preventDefault()
    for (let attempt = 0; attempt < 366 && next; attempt++) {
      const period = range && draft[0] && !draft[1] ? orderedRange(draft[0], next) : [next]
      if (allowed(inputs[0], period[0]) && (!period[1] || allowed(end, period[1]))) break
      next = addDays(next, next < value ? -1 : 1)
    }
    const period = range && draft[0] && !draft[1] ? orderedRange(draft[0], next) : [next]
    if (!next || !allowed(inputs[0], period[0]) || (period[1] && !allowed(end, period[1]))) return
    focusDate = next
    if (next < month || next > monthEnd(moveMonth(month, monthCount() - 1))) month = monthStart(next)
    render(true)
  }
  /** @param {PointerEvent} event */
  const hover = (event) => {
    const target = event.target
    if (range && draft[0] && !draft[1] && target instanceof HTMLButtonElement && !target.disabled)
      paint(target.dataset.date)
  }
  const leave = () => paint()
  let disposing = false
  const autoApply = picker.dataset.dateApplyOnClose === 'true'
  const toggle = () => {
    syncPresentation()
    opener.setAttribute('aria-expanded', String(isOpen()))
    if (!isOpen()) {
      if (autoApply && !disposing && draft.length) {
        const changed = valid() && inputs.some((input, index) => input.value !== draft[index])
        if (changed) {
          commit([...draft])
          const form = inputs[0].form
          if (form?.method.toLowerCase() === 'get') form.requestSubmit()
        } else validate()
      }
      draft = []
    }
  }
  /** @param {FocusEvent} event */
  const focusout = (event) => {
    if (isOpen() && event.target instanceof Node && !popup.contains(event.target) && event.target !== opener)
      close()
  }
  let mobileLayout = isMobile()
  const resize = () => {
    if (isOpen()) {
      const changed = mobileLayout !== isMobile()
      if (changed) month = calendarStart(focusDate)
      syncPresentation()
      render(months.contains(document.activeElement))
      if (changed) revealMonth()
    }
    mobileLayout = isMobile()
  }
  /** @param {Event} event */
  const change = (event) => {
    if (event.target === preset && preset instanceof HTMLSelectElement && enabled()) {
      today = readToday()
      const period = presetRange(preset.value, today)
      if (period && allowed(inputs[0], period[0]) && allowed(end, period[1])) {
        preferredPreset = preset.value
        if (autoApply) {
          draft = [...period]
          close(true)
        } else {
          close(true)
          commit(period)
        }
      } else {
        validate()
        open(preset)
      }
    } else validate()
  }
  /** @param {SubmitEvent} event */
  const submit = (event) => {
    if (
      !validate() &&
      !inputs[0].form?.noValidate &&
      !(event.submitter instanceof HTMLButtonElement && event.submitter.formNoValidate)
    ) {
      event.preventDefault()
      field?.focus()
    }
  }
  const reset = () => {
    draft = []
    close()
    setTimeout(() => {
      if (range)
        inputs.forEach((input, index) => {
          input.value = defaults[index]
        })
      preferredPreset = ''
      validate()
    })
  }
  picker.dataset.dateEnhanced = 'true'
  validate()
  picker.addEventListener('click', click)
  picker.addEventListener('keydown', keydown)
  picker.addEventListener('change', change)
  popup.addEventListener('toggle', toggle)
  months.addEventListener('pointerover', hover)
  months.addEventListener('pointerleave', leave)
  document.addEventListener('focusin', focusout)
  window.addEventListener('resize', resize)
  window.addEventListener('scroll', position, true)
  inputs[0].form?.addEventListener('reset', reset)
  inputs[0].form?.addEventListener('submit', submit)
  return () => {
    disposing = true
    close()
    delete picker.dataset.dateEnhanced
    picker.removeEventListener('click', click)
    picker.removeEventListener('keydown', keydown)
    picker.removeEventListener('change', change)
    popup.removeEventListener('toggle', toggle)
    months.removeEventListener('pointerover', hover)
    months.removeEventListener('pointerleave', leave)
    document.removeEventListener('focusin', focusout)
    window.removeEventListener('resize', resize)
    window.removeEventListener('scroll', position, true)
    inputs[0].form?.removeEventListener('reset', reset)
    inputs[0].form?.removeEventListener('submit', submit)
    if (preset instanceof HTMLSelectElement) preset.disabled = true
  }
}
/** Shared ownership prevents duplicate listeners when document and island roots overlap.
 * @type {WeakMap<HTMLElement, { users: number, cleanup: () => void }>} */
const instances = new WeakMap()
/** @param {HTMLElement} node */
const acquire = (node) => {
  let instance = instances.get(node)
  if (!instance) {
    instance = { users: 0, cleanup: enhance(node) }
    instances.set(node, instance)
  }
  const owned = instance
  owned.users++
  return () => {
    if (--owned.users === 0) {
      owned.cleanup()
      instances.delete(node)
    }
  }
}
/** Enhances current and subsequently inserted fields; cleanup also releases removed islands.
 * @param {ParentNode} root */
export const attachDatePickers = (root) => {
  if (typeof HTMLElement === 'undefined' || typeof Node === 'undefined') return () => {}
  /** @type {Map<HTMLElement, () => void>} */
  const attached = new Map()
  const sync = () => {
    for (const [element, cleanup] of attached)
      if (element !== root && !root.contains(element)) {
        cleanup()
        attached.delete(element)
      }
    const candidates = [...root.querySelectorAll('[data-date-mode]')]
    if (root instanceof HTMLElement && root.matches('[data-date-mode]')) candidates.unshift(root)
    for (const node of candidates)
      if (node instanceof HTMLElement && !attached.has(node)) attached.set(node, acquire(node))
  }
  sync()
  const observer = typeof MutationObserver === 'undefined' ? null : new MutationObserver(sync)
  if (root instanceof Node) observer?.observe(root, { childList: true, subtree: true })
  return () => {
    observer?.disconnect()
    for (const cleanup of attached.values()) cleanup()
    attached.clear()
  }
}
