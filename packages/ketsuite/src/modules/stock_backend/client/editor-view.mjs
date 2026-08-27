// @ts-nocheck Progressive enhancement for Stock Picking operations.

const LABELS = {
  vi: {
    saving: 'Đang cập nhật dịch chuyển…',
    saved: 'Đã cập nhật dịch chuyển.',
    failed: 'Không thể cập nhật dịch chuyển. Vui lòng kiểm tra lại.',
  },
  en: {
    saving: 'Updating transfer…',
    saved: 'Transfer updated.',
    failed: 'The transfer could not be updated. Please review the form.',
  },
}

const LOT_LABELS = {
  vi: {
    saving: 'Đang lưu lô hoặc sê-ri…',
    saved: 'Đã lưu lô hoặc sê-ri.',
    failed: 'Không thể lưu lô hoặc sê-ri. Vui lòng kiểm tra lại.',
  },
  en: {
    saving: 'Saving lot or serial…',
    saved: 'Lot or serial saved.',
    failed: 'The lot or serial could not be saved. Please review the form.',
  },
}

const labelsOf = (props) => {
  const source = props.lotId ? LOT_LABELS : LABELS
  return source[String(props.lang ?? '').toLowerCase()] ?? source.vi
}

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

const replaceRecordParts = (markup, props) => {
  const parsed = new DOMParser().parseFromString(markup, 'text/html')
  const prefix = props.lotId ? 'stock.lot' : 'stock.transfer'
  const envelope = parsed.querySelector('ket-fragments')
  const nextHeader = parsed.querySelector(`template[data-ket-slot="${prefix}-header"]`)
  const nextBody = parsed.querySelector(`template[data-ket-slot="${prefix}-body"]`)
  const currentHeader = document.querySelector(`[data-ket-slot="${prefix}-header"]`)
  const currentBody = document.querySelector(`[data-ket-slot="${prefix}-body"]`)
  if (!nextHeader || !nextBody || !currentHeader || !currentBody)
    throw new Error('The refreshed stock fragment is incomplete.')

  currentHeader.replaceChildren(document.importNode(nextHeader.content, true))
  currentBody.replaceChildren(document.importNode(nextBody.content, true))
  if (envelope?.getAttribute('data-title') !== null) document.title = envelope.getAttribute('data-title')
}

const editorHostFor = (props) => {
  if (typeof document === 'undefined') return null
  return Array.from(document.querySelectorAll('ket-island[data-island="stock.editor"]')).find((element) => {
    try {
      const hostProps = JSON.parse(element.getAttribute('data-props') ?? '{}')
      return props.lotId ? hostProps.lotId === props.lotId : hostProps.pickingId === props.pickingId
    } catch {
      return false
    }
  })
}

export function createStockEditorView(runtime, props) {
  const { html, signal } = runtime
  const labels = labelsOf(props)
  const state = signal('idle')
  const message = signal('')
  const host = editorHostFor(props)
  const scope = props.lotId ? 'stock-lot' : 'stock-transfer'
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
      const response = await fetch(form.getAttribute('action') || window.location.href, {
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
      replaceRecordParts(await response.text(), props)
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
