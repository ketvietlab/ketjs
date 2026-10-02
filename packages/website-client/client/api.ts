// The one HTTP transport for `/_ket/fn`. Product and Atlas use it unchanged; Atlas only answers
// the requests with fixture data.
import { tr } from './i18n.ts'
import { extensionErrors } from './extensions.ts'
import type { Call, CallOptions } from './types.ts'

/** A refused request: its code, and the field messages a form shows beside its inputs. */
export class WebsiteApiError extends Error {
  code: string
  fields: Record<string, string>
  constructor(message: string, code = 'request', fields: Record<string, string> = {}) {
    super(message)
    this.name = 'WebsiteApiError'
    this.code = code
    this.fields = fields
  }
}

type FnError = { code?: string; message?: string; fields?: Record<string, string> }
type FnPayload = {
  ok?: boolean
  code?: string
  message?: string
  value?: { ok?: boolean; errors?: FnError[] } | null
}

export function createFnClient({
  fetch: send = globalThis.fetch,
  headers = {},
}: {
  fetch?: typeof globalThis.fetch
  headers?: Record<string, string>
} = {}): Call {
  return async <T>(name: string, input: object = {}, options: CallOptions = {}): Promise<T> => {
    let response: Response
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
      if ((error as Error | null)?.name === 'AbortError') throw error
      // Unknown is not failed: the caller keeps its request key and checks before retrying.
      throw new WebsiteApiError(tr('website.error.network'), 'unknown')
    }
    let payload: FnPayload
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
    return value as T
  }
}
