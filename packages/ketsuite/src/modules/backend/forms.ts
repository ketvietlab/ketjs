import { text, withHeaders } from '@ketvietlab/ketjs'
import { validateForm } from '@ketvietlab/ketjs-view'
import type { Route, Translator } from '@ketvietlab/ketjs'
import type { FormSchema, FormValues, ValidationIssue } from '@ketvietlab/ketjs-view'

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

/**
 * What a route holds after a submit it turned down.
 *
 * Three things have to agree, and until now every route that tried wrote all
 * three out by hand: the dialog stays open, what was typed comes back, and each
 * complaint lands on the control that caused it. The usual `errors.length` test
 * gets the first one wrong the moment every complaint is a field mark, because
 * then there is no form-level sentence to count.
 *
 * The words come from `backend.validation.*`. A schema names a message key for
 * each code it can raise, so the sentences belong to whoever ships the codes,
 * not to each module that adopts a schema.
 */
export type FormRefusal = {
  /**
   * Check a submit against its shape rules. Returns the normalized values when
   * they pass and null when they do not, keeping the marks for the render.
   *
   * Not every submit is an edit. A row's own archive or restore control posts
   * its identity and nothing else, so it has no form to satisfy — do not put it
   * through here, or it is refused for fields it never carried.
   */
  check<TValues extends FormValues>(schema: FormSchema<TValues>, form: Readonly<FormValues>): TValues | null
  /** Record a refusal the shape rules did not raise — a command that said no. */
  add(sentences: readonly string[]): void
  /** Whether this submit was turned down, by a form-level sentence or a field mark. */
  refused(): boolean
  /** The complaint about one control, as a sentence, or null when it is fine. */
  error(field: string): string | null
  /** The complaints that concern the whole form rather than one of its controls. */
  sentences(): string[]
}

export const formRefusal = (t: Translator): FormRefusal => {
  let issues: ValidationIssue[] = []
  let said: string[] = []
  // An unknown key would render as itself, which is worse on screen than the
  // code: at least the code is something to search for.
  const say = (issue: ValidationIssue): string => {
    const key = `backend.${issue.messageKey}`
    return t.resolves(key) ? t(key, issue.params as Record<string, unknown>) : issue.code
  }
  return {
    check(schema, form) {
      const checked = validateForm(schema, form)
      if (checked.valid) return checked.values
      issues = checked.issues
      return null
    },
    add(sentences) {
      said = [...said, ...sentences]
    },
    refused: () => issues.length > 0 || said.length > 0,
    error: (field) => {
      const held = issues.find((issue) => issue.field === field)
      return held ? say(held) : null
    },
    sentences: () => [...issues.filter((issue) => issue.field === null).map(say), ...said],
  }
}
