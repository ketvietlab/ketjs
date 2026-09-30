import type { Ctx } from '@ketvietlab/ketjs'
import { createHash, randomUUID } from 'node:crypto'

export type FlowIssue = { field: string; code: string; params?: Record<string, unknown> }

export type FlowResult = { ok: boolean; id?: string; errors?: FlowIssue[]; [key: string]: unknown }

export const issue = (field: string, code: string, params?: Record<string, unknown>): FlowIssue => ({
  field,
  code,
  ...(params ? { params } : {}),
})

export const invalid = (...errors: FlowIssue[]): FlowResult => ({ ok: false, errors })

export const now = (): string => new Date().toISOString()

export const n = (value: unknown): number => Number(value ?? 0)

export const normalized = (value: unknown): string =>
  String(value ?? '')
    .normalize('NFKC')
    .trim()
    .toLowerCase()

export const actorRequired = (ctx: Ctx): string | null => ctx.actor || null

/**
 * The id of a record a command creates, derived from what the command is
 * deduplicated under.
 *
 * A form that is submitted twice — a double click, a back button, a retry from
 * a phone that lost its connection — sends the same idempotency key both
 * times. If the id is fresh on each attempt, the second attempt is a different
 * record and gets written as one: two issues from one intent. Deriving the id
 * from the key makes the replay byte-identical, so it lands on the record the
 * first attempt already made and updates it instead (FLW-033).
 */
export const commandRecordId = (namespace: string, key: string): string => {
  const hex = createHash('sha256').update(`${namespace}\n${key}`).digest('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`
}

export const commandKey = (value: unknown): string | null => {
  const key = String(value ?? '').trim()
  return key.length >= 8 && key.length <= 200 ? key : null
}

export const createFlowId = (): string => randomUUID()
