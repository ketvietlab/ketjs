// @ts-check

/** Progressive enhancement for primitives; server views stay render-pure.
 * @param {ParentNode} root
 */
export const attachPrimitives = (root) => {
  /** @type {Map<HTMLElement, string | null>} */
  const descriptions = new Map()
  const mixedDefaults = new WeakSet()
  const sync = () => {
    for (const input of root.querySelectorAll('input[data-indeterminate="true"]')) {
      if (input instanceof HTMLInputElement) {
        input.indeterminate = true
        mixedDefaults.add(input)
      }
    }
    for (const image of root.querySelectorAll('[data-ui="avatar-image"]')) {
      if (image instanceof HTMLImageElement && image.complete && image.naturalWidth === 0) image.hidden = true
    }
    // Older JSX triggers remain supported; new callback triggers are associated in SSR.
    for (const tooltip of root.querySelectorAll('[data-ui="tooltip"]')) {
      const content = tooltip.querySelector('[data-ui="tooltip-content"]')
      const trigger = tooltip.querySelector(
        '[data-ui="tooltip-trigger"] :is(button, a[href], input, select, textarea, [tabindex])',
      )
      if (!(trigger instanceof HTMLElement) || !content?.id) continue
      if (!descriptions.has(trigger)) descriptions.set(trigger, trigger.getAttribute('aria-describedby'))
      const ids = new Set((trigger.getAttribute('aria-describedby') ?? '').split(' ').filter(Boolean))
      ids.add(content.id)
      trigger.setAttribute('aria-describedby', [...ids].join(' '))
    }
  }
  sync()
  const observer = new MutationObserver(sync)
  observer.observe(root, { childList: true, subtree: true })

  /** @param {Event} event */
  const onError = (event) => {
    const image = event.target
    if (image instanceof HTMLImageElement && image.matches('[data-ui="avatar-image"]')) image.hidden = true
  }
  /** @param {Event} event */
  const onLoad = (event) => {
    const image = event.target
    if (image instanceof HTMLImageElement && image.matches('[data-ui="avatar-image"]')) image.hidden = false
  }
  /** @param {Event} event */
  const onChange = (event) => {
    const input = event.target
    if (input instanceof HTMLInputElement && input.hasAttribute('data-indeterminate')) {
      input.setAttribute('data-indeterminate', 'false')
      input.indeterminate = false
      input.setAttribute('aria-checked', String(input.checked))
    }
  }
  /** @param {Event} event */
  const onClick = (event) => {
    if (!(event.target instanceof Element)) return
    const clear = event.target.closest('[data-ui="field-clear"]')
    if (!(clear instanceof HTMLButtonElement) || clear.disabled) return
    const input = clear.closest('[data-ui="field-input"]')?.querySelector('input')
    if (!(input instanceof HTMLInputElement) || input.disabled || input.readOnly) return
    input.value = ''
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new Event('change', { bubbles: true }))
    input.focus()
  }
  /** @param {Event} event */
  const onEnter = (event) => {
    if (!(event.target instanceof Element)) return
    const tooltip = event.target.closest('[data-ui="tooltip"]')
    if (!tooltip) return
    const from = event instanceof FocusEvent || event instanceof MouseEvent ? event.relatedTarget : null
    if (!(from instanceof Node) || !tooltip.contains(from)) tooltip.removeAttribute('data-dismissed')
  }
  /** @param {Event} event */
  const onKeyDown = (event) => {
    if (!(event instanceof KeyboardEvent) || event.key !== 'Escape') return
    const open = [...root.querySelectorAll('[data-ui="tooltip"]:not([data-dismissed="true"])')].filter(
      (tooltip) => tooltip.matches(':hover, :focus-within'),
    )
    if (!open.length) return
    for (const tooltip of open) tooltip.setAttribute('data-dismissed', 'true')
    event.preventDefault()
    event.stopImmediatePropagation()
  }
  /** @param {Event} event */
  const onReset = (event) => {
    const form = event.target
    if (!(form instanceof HTMLFormElement)) return
    queueMicrotask(() => {
      if (event.defaultPrevented) return
      for (const input of form.elements) {
        if (!(input instanceof HTMLInputElement) || !mixedDefaults.has(input)) continue
        input.indeterminate = true
        input.setAttribute('data-indeterminate', 'true')
        input.setAttribute('aria-checked', 'mixed')
      }
    })
  }
  root.addEventListener('reset', onReset)
  root.addEventListener('error', onError, true)
  root.addEventListener('load', onLoad, true)
  root.addEventListener('change', onChange)
  root.addEventListener('click', onClick)
  root.addEventListener('mouseover', onEnter)
  root.addEventListener('focusin', onEnter)
  root.addEventListener('keydown', onKeyDown, true)
  return () => {
    observer.disconnect()
    root.removeEventListener('reset', onReset)
    root.removeEventListener('error', onError, true)
    root.removeEventListener('load', onLoad, true)
    root.removeEventListener('change', onChange)
    root.removeEventListener('click', onClick)
    root.removeEventListener('mouseover', onEnter)
    root.removeEventListener('focusin', onEnter)
    root.removeEventListener('keydown', onKeyDown, true)
    for (const [trigger, description] of descriptions) {
      if (description === null) trigger.removeAttribute('aria-describedby')
      else trigger.setAttribute('aria-describedby', description)
    }
  }
}
