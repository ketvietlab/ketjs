// The one HTTP transport for `/_ket/fn`. Product and Atlas use it unchanged; Atlas only answers
// the requests with fixture data.
import { tr } from './i18n.mjs'
import { extensionErrors } from './extensions.mjs'

export class WebsiteApiError extends Error {
  constructor(message, code = 'request', fields = {}) {
    super(message)
    this.name = 'WebsiteApiError'
    this.code = code
    this.fields = fields
  }
}

export function createFnClient({ fetch: send = globalThis.fetch, headers = {} } = {}) {
  return async (name, input = {}, options = {}) => {
    let response
    try {
      response = await send(`/_ket/fn/${encodeURIComponent(name)}`, {
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
    } catch (error) {
      if (error?.name === 'AbortError') throw error
      // Unknown is not failed: the caller keeps its request key and checks before retrying.
      throw new WebsiteApiError(tr('website.error.network'), 'unknown')
    }
    let payload
    try {
      payload = await response.json()
    } catch {
      throw new WebsiteApiError(tr('website.error.response'), 'response')
    }
    const value = payload.value
    if (!response.ok || payload.ok === false || value?.ok === false) {
      const first = value?.errors?.[0]
      const code = first?.code ?? payload.code ?? `http.${response.status}`
      const key = extensionErrors[code]
      throw new WebsiteApiError(
        (key ? tr(key) : null) ?? first?.message ?? payload.message ?? tr('website.error.request'),
        code,
        first?.fields ?? {},
      )
    }
    return value
  }
}
