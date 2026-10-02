import type { Ctx } from '@ketvietlab/ketjs'
import { actorRequired, commandKey, invalid, issue } from './command.ts'

export const command = (ctx: Ctx, key: unknown) => {
  if (!actorRequired(ctx)) return invalid(issue('actor', 'flow.error.actorRequired'))
  if (!commandKey(key)) return invalid(issue('idempotencyKey', 'flow.error.idempotencyRequired'))
  return null
}
