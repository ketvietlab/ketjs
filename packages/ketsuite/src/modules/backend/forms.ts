import { text, withHeaders } from '@ketvietlab/ketjs'
import type { Route } from '@ketvietlab/ketjs'

type Req = Parameters<Route>[1]

export const readForm = async (req: Req): Promise<Record<string, string>> => {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(chunk as Buffer)
  const raw = Buffer.concat(chunks).toString('utf8')
  if (!raw) return {}
  const type = String(req.headers['content-type'] ?? '')
  if (type.includes('form-urlencoded')) return Object.fromEntries(new URLSearchParams(raw))
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>
    return Object.fromEntries(Object.entries(parsed).map(([key, value]) => [key, String(value ?? '')]))
  } catch {
    return {}
  }
}

export const seeOther = (path: string) => withHeaders(text('', { status: 303 }), { location: path })

export const errorsOf = (result: unknown): string[] => {
  const errors = (result as { errors?: Array<{ field?: string; message?: string }> } | null)?.errors ?? []
  return errors.map((error) => `${error.field ? `${error.field}: ` : ''}${error.message ?? 'invalid value'}`)
}
