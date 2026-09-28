import type { Ctx } from '@ketvietlab/ketjs'

/** Resolve business labels and safe field refusals in every user record surface. */
export const userModalMessages = (ctx: Pick<Ctx, 'manifest'>, lang: string): Record<string, string> => {
  const out: Record<string, string> = {}
  for (const [key, message] of Object.entries(ctx.manifest.messages?.[lang] ?? {})) {
    if (!key.startsWith('user_backend.') && !key.startsWith('user.')) continue
    const text =
      typeof message === 'string' ? message : String(message.other ?? Object.values(message)[0] ?? key)
    out[key] = text
    if (key.startsWith('user_backend.error.E_')) out[key.slice('user_backend.error.'.length)] = text
  }
  return out
}
