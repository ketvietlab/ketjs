// @ts-nocheck Progressive enhancement for sale order forms.

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

export function createSaleEditorStatusView(runtime, props) {
  const labels = labelsOf(props)
  return () => runtime.html`<aside
    data-ui="notice"
    data-tone="info"
    data-record-save-status="sale-order"
    data-saving=${labels.saving}
    data-saved=${labels.saved}
    data-failed=${labels.failed}
    role="status"
    aria-live="polite"
    hidden
  ><div data-ui="notice-copy"><p data-ui="notice-title" data-record-save-message></p></div></aside>`
}

const showState = (status, state, message) => {
  status.hidden = false
  status.dataset.tone = state === 'saved' ? 'positive' : state === 'error' ? 'danger' : 'info'
  status.setAttribute('role', state === 'error' ? 'alert' : 'status')
  const copy = status.querySelector('[data-record-save-message]')
  if (copy) copy.textContent = message
}

export const saleEditorBehavior = ({ navigation, lifetime }) => {
  let activeRequest = null
  const submit = async (event) => {
    const form = event.target
    if (!(form instanceof HTMLFormElement) || form.dataset.scope !== 'sale-order') return
    const status = document.querySelector('[data-record-save-status="sale-order"]')
    if (!(status instanceof HTMLElement)) return
    event.preventDefault()

    const submitters = Array.from(form.querySelectorAll('button[type="submit"], input[type="submit"]'))
    showState(status, 'saving', status.dataset.saving)
    form.setAttribute('aria-busy', 'true')
    for (const submitter of submitters) submitter.disabled = true

    activeRequest?.abort()
    const request = new AbortController()
    activeRequest = request
    try {
      const body = new URLSearchParams()
      for (const [name, value] of new FormData(form)) if (typeof value === 'string') body.append(name, value)
      const response = await fetch(form.getAttribute('action') || window.location.href, {
        method: String(form.method || 'post').toUpperCase(),
        credentials: 'same-origin',
        headers: {
          accept: 'text/vnd.ket.fragments+html',
          'content-type': 'application/x-www-form-urlencoded;charset=UTF-8',
          'x-ket-partial': 'sale-order',
        },
        body,
        signal: request.signal,
      })
      const isFragment = response.headers
        .get('content-type')
        ?.toLowerCase()
        .startsWith('text/vnd.ket.fragments+html')
      if (!response.ok && !isFragment) throw new Error(await errorText(response, status.dataset.failed))
      await navigation.apply(response, { signal: request.signal })
      const nextStatus = document.querySelector('[data-record-save-status="sale-order"]')
      if (!lifetime.aborted && nextStatus instanceof HTMLElement)
        showState(
          nextStatus,
          response.ok ? 'saved' : 'error',
          response.ok ? nextStatus.dataset.saved : nextStatus.dataset.failed,
        )
    } catch (caught) {
      if (lifetime.aborted || caught?.name === 'AbortError') return
      showState(status, 'error', caught instanceof Error ? caught.message : status.dataset.failed)
    } finally {
      if (activeRequest === request) activeRequest = null
      form.removeAttribute('aria-busy')
      for (const submitter of submitters) submitter.disabled = false
    }
  }
  document.addEventListener('submit', submit, { signal: lifetime })
  return () => activeRequest?.abort()
}
