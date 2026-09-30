import { tr } from './i18n.mjs'
import { extensionErrors } from './extensions.mjs'
export class FlowApiError extends Error {
  constructor(message, code = 'request', fields = {}) {
    super(message)
    this.name = 'FlowApiError'
    this.code = code
    this.fields = fields
  }
}
// The product and Atlas use this exact HTTP transport and response normalization.
export function createFnClient({ fetch: send = globalThis.fetch, headers = {} } = {}) {
  return async (name, input = {}, options = {}) => {
    const response = await send(`/_ket/fn/${encodeURIComponent(name)}`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'content-type': 'application/json',
        ...headers,
        ...(options.key ? { 'idempotency-key': options.key } : {}),
      },
      body: JSON.stringify(input),
      signal: options.signal,
    })
    let payload
    try {
      payload = await response.json()
    } catch {
      throw new FlowApiError(tr('flow.ui.invalid.response.please.try.again'), 'response')
    }
    const value = payload.value
    if (!response.ok || payload.ok === false || value?.ok === false) {
      const first = value?.errors?.[0]
      const messageKey = extensionErrors[first?.code]
      throw new FlowApiError(
        (messageKey ? tr(messageKey) : null) ??
          first?.message ??
          payload.message ??
          tr('flow.ui.unable.to.process.the.request'),
        first?.code ?? payload.code ?? `http.${response.status}`,
        value?.fields ?? {},
      )
    }
    return value
  }
}
// File bytes go up first; the returned uploadId is then referenced by `flow.entity.save`.
export function createFileUploader({ fetch: send = globalThis.fetch, headers = {} } = {}) {
  return async (file, options = {}) => {
    const response = await send('/_ket/upload', {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'content-type': file.type || 'application/octet-stream',
        'x-file-name': encodeURIComponent(file.name),
        ...headers,
      },
      body: file,
      signal: options.signal,
    })
    let payload
    try {
      payload = await response.json()
    } catch {
      throw new FlowApiError(tr('flow.ui.invalid.response.please.try.again'), 'response')
    }
    if (!response.ok || payload.ok === false || typeof payload.uploadId !== 'string')
      throw new FlowApiError(
        payload.message ?? tr('flow.ui.unable.to.process.the.request'),
        payload.code ?? `http.${response.status}`,
      )
    return payload
  }
}
