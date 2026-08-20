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

const replaceRecordParts = (markup) => {
  const parsed = new DOMParser().parseFromString(markup, 'text/html')
  const nextHeader = parsed.querySelector('[data-ui="record-header"]')
  const nextBody = parsed.querySelector('[data-ui="record-body"]')
  const currentHeader = document.querySelector('[data-ui="record-header"]')
  const currentBody = document.querySelector('[data-ui="record-body"]')
  if (!nextHeader || !nextBody || !currentHeader || !currentBody)
    throw new Error('The refreshed Transfer fragment is incomplete.')

  currentHeader.replaceWith(document.importNode(nextHeader, true))
  currentBody.replaceWith(document.importNode(nextBody, true))
  if (parsed.title) document.title = parsed.title
}

const editorHostFor = (props) => {
  if (typeof document === 'undefined') return null
  return Array.from(document.querySelectorAll('ket-island[data-island="stock.editor"]')).find((element) => {
    try {
      return JSON.parse(element.getAttribute('data-props') ?? '{}').pickingId === props.pickingId
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
  if (host) host.hidden = true

  const showState = (nextState, nextMessage) => {
    if (host) host.hidden = false
    state.set(nextState)
    message.set(nextMessage)
  }

  if (typeof document !== 'undefined') {
    document.addEventListener('submit', async (event) => {
      const form = event.target
      if (!(form instanceof HTMLFormElement) || form.dataset.scope !== 'stock-transfer') return
      event.preventDefault()
      if (state() === 'saving') return

      const submitters = Array.from(form.querySelectorAll('button[type="submit"], input[type="submit"]'))
      showState('saving', labels.saving)
      form.setAttribute('aria-busy', 'true')
      for (const submitter of submitters) submitter.disabled = true

      try {
        const body = new URLSearchParams()
        for (const [name, value] of new FormData(form))
          if (typeof value === 'string') body.append(name, value)
        const response = await fetch(form.getAttribute('action') || window.location.href, {
          method: String(form.method || 'post').toUpperCase(),
          credentials: 'same-origin',
          headers: {
            accept: 'text/html',
            'content-type': 'application/x-www-form-urlencoded;charset=UTF-8',
            'x-ket-partial': 'stock-transfer',
          },
          body,
        })
        if (!response.ok) throw new Error(await errorText(response, labels.failed))
        replaceRecordParts(await response.text())
        showState('saved', labels.saved)
      } catch (caught) {
        showState('error', caught instanceof Error ? caught.message : labels.failed)
      } finally {
        form.removeAttribute('aria-busy')
        for (const submitter of submitters) submitter.disabled = false
      }
    })
  }

  return () => html`<aside
    data-ui="notice"
    data-tone=${state() === 'saved' ? 'positive' : state() === 'error' ? 'danger' : 'info'}
    role=${state() === 'error' ? 'alert' : 'status'}
    aria-live="polite"
    hidden=${state() === 'idle'}
  ><div data-ui="notice-copy"><p data-ui="notice-title">${message()}</p></div></aside>`
}
