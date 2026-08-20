// @ts-nocheck Progressive enhancement for sale.order operations.

const LABELS = {
  vi: {
    saving: 'Đang cập nhật đơn bán…',
    saved: 'Đã cập nhật đơn bán.',
    failed: 'Không thể cập nhật đơn bán. Vui lòng kiểm tra lại.',
  },
  en: {
    saving: 'Updating sales order…',
    saved: 'Sales order updated.',
    failed: 'The sales order could not be updated. Please review the form.',
  },
}

const labelsOf = (props) => LABELS[String(props.lang ?? '').toLowerCase()] ?? LABELS.vi

const errorText = async (response, fallback) => {
  try {
    const payload = await response.json()
    const details = Array.isArray(payload.errors)
      ? payload.errors
          .map((error) => String(typeof error === 'string' ? error : (error?.message ?? '')))
          .filter(Boolean)
      : []
    return [String(payload.message ?? fallback), ...details].join(' · ')
  } catch {
    return fallback
  }
}

const replaceSaleOrderParts = (markup) => {
  const parsed = new DOMParser().parseFromString(markup, 'text/html')
  const envelope = parsed.querySelector('ket-fragments')
  const nextHeader = parsed.querySelector('template[data-ket-slot="sale.order-header"]')
  const nextBody = parsed.querySelector('template[data-ket-slot="sale.order-body"]')
  const currentHeader = document.querySelector('[data-ket-slot="sale.order-header"]')
  const currentBody = document.querySelector('[data-ket-slot="sale.order-body"]')
  if (!nextHeader || !nextBody || !currentHeader || !currentBody)
    throw new Error('The refreshed sales order fragment is incomplete.')
  currentHeader.replaceChildren(document.importNode(nextHeader.content, true))
  currentBody.replaceChildren(document.importNode(nextBody.content, true))
  if (envelope?.getAttribute('data-title') !== null) document.title = envelope.getAttribute('data-title')
}

const editorHostFor = (props) => {
  if (typeof document === 'undefined') return null
  return Array.from(document.querySelectorAll('ket-island[data-island="sale.editor"]')).find((element) => {
    try {
      return JSON.parse(element.getAttribute('data-props') ?? '{}').orderId === props.orderId
    } catch {
      return false
    }
  })
}

export function createSaleEditorView(runtime, props) {
  const { html, signal } = runtime
  const labels = labelsOf(props)
  const state = signal('idle')
  const message = signal('')
  const host = editorHostFor(props)
  let activeRequest = null
  let disposed = false
  if (host) host.hidden = true

  const showState = (nextState, nextMessage) => {
    if (host) host.hidden = false
    state.set(nextState)
    message.set(nextMessage)
  }

  const submit = async (event) => {
    const form = event.target
    if (!(form instanceof HTMLFormElement) || form.dataset.scope !== 'sale-order') return
    event.preventDefault()
    if (state() === 'saving') return
    const submitters = Array.from(form.querySelectorAll('button[type="submit"], input[type="submit"]'))
    showState('saving', labels.saving)
    form.setAttribute('aria-busy', 'true')
    for (const submitter of submitters) submitter.disabled = true
    try {
      activeRequest?.abort()
      activeRequest = new AbortController()
      const body = new URLSearchParams()
      for (const [name, value] of new FormData(form)) if (typeof value === 'string') body.append(name, value)
      const response = await fetch(form.getAttribute('action') || window.location.href, {
        method: String(form.method || 'post').toUpperCase(),
        credentials: 'same-origin',
        headers: {
          accept: 'text/html',
          'content-type': 'application/x-www-form-urlencoded;charset=UTF-8',
          'x-ket-partial': 'sale-order',
        },
        body,
        signal: activeRequest.signal,
      })
      if (!response.ok) throw new Error(await errorText(response, labels.failed))
      const markup = await response.text()
      if (globalThis.__ketNavigation?.applyFragments) await globalThis.__ketNavigation.applyFragments(markup)
      else replaceSaleOrderParts(markup)
      const location = response.headers.get('x-ket-location')
      if (location && location !== `${window.location.pathname}${window.location.search}`)
        history.replaceState(history.state, '', location)
      if (disposed) return
      showState('saved', labels.saved)
    } catch (caught) {
      if (disposed || caught?.name === 'AbortError') return
      showState('error', caught instanceof Error ? caught.message : labels.failed)
    } finally {
      activeRequest = null
      form.removeAttribute('aria-busy')
      for (const submitter of submitters) submitter.disabled = false
    }
  }
  if (typeof document !== 'undefined') document.addEventListener('submit', submit)

  return {
    view: () => html`<aside
    data-ui="notice"
    data-tone=${state() === 'saved' ? 'positive' : state() === 'error' ? 'danger' : 'info'}
    role=${state() === 'error' ? 'alert' : 'status'}
    aria-live="polite"
    hidden=${state() === 'idle'}
  ><div data-ui="notice-copy"><p data-ui="notice-title">${message()}</p></div></aside>`,
    dispose: () => {
      disposed = true
      activeRequest?.abort()
      if (typeof document !== 'undefined') document.removeEventListener('submit', submit)
    },
  }
}
