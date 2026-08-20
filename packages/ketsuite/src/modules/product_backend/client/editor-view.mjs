// @ts-nocheck Dependency-free progressive enhancement for the Product form.
//
// The native form remains the fallback. In a hydrated admin page we submit it
// in place and replace only the server-rendered Product header/body. Chatter,
// Activity and the sidebar are separate islands and keep their DOM identity and
// local state throughout the save.

const LABELS = {
  vi: {
    saving: 'Đang lưu sản phẩm…',
    saved: 'Đã lưu sản phẩm.',
    failed: 'Không thể lưu sản phẩm. Vui lòng kiểm tra lại.',
  },
  en: {
    saving: 'Saving product…',
    saved: 'Product saved.',
    failed: 'The product could not be saved. Please review the form.',
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

const replaceProductParts = (markup) => {
  const parsed = new DOMParser().parseFromString(markup, 'text/html')
  const envelope = parsed.querySelector('ket-fragments')
  const nextHeader = parsed.querySelector('template[data-ket-slot="product.record-header"]')
  const nextBody = parsed.querySelector('template[data-ket-slot="product.record-body"]')
  const currentHeader = document.querySelector('[data-ket-slot="product.record-header"]')
  const currentBody = document.querySelector('[data-ket-slot="product.record-body"]')
  if (!nextHeader || !nextBody || !currentHeader || !currentBody)
    throw new Error('The refreshed Product fragment is incomplete.')

  currentHeader.replaceChildren(document.importNode(nextHeader.content, true))
  currentBody.replaceChildren(document.importNode(nextBody.content, true))
  if (envelope?.getAttribute('data-title') !== null) document.title = envelope.getAttribute('data-title')
}

const editorHostFor = (props) => {
  if (typeof document === 'undefined') return null
  return Array.from(document.querySelectorAll('ket-island[data-island="product.editor"]')).find((element) => {
    try {
      const hostProps = JSON.parse(element.getAttribute('data-props') ?? '{}')
      return props.productId
        ? hostProps.productId === props.productId
        : hostProps.templateId === props.templateId
    } catch {
      return false
    }
  })
}

export function createProductEditorView(runtime, props) {
  const { html, signal } = runtime
  const labels = labelsOf(props)
  const state = signal('idle')
  const message = signal('')
  const host = editorHostFor(props)
  const scope = props.productId ? 'product-variant' : 'product-detail'
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
    if (!(form instanceof HTMLFormElement) || form.dataset.scope !== scope) return
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
      const response = await fetch(form.action, {
        method: String(form.method || 'post').toUpperCase(),
        credentials: 'same-origin',
        headers: {
          accept: 'text/html',
          'content-type': 'application/x-www-form-urlencoded;charset=UTF-8',
          'x-ket-partial': scope,
        },
        body,
        signal: activeRequest.signal,
      })
      if (!response.ok) throw new Error(await errorText(response, labels.failed))
      const markup = await response.text()
      if (globalThis.__ketNavigation?.applyFragments) await globalThis.__ketNavigation.applyFragments(markup)
      else replaceProductParts(markup)
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
