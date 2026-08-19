// Templates as files.
//
// They used to be string literals inside .ts, which cost a theme author every tool
// they have: no highlighting, no formatter, no way for an error to name a place. It
// also made the fourth pillar untrue in practice — Shopify and WordPress hand a
// theme author *files*, and someone who must open TypeScript to change markup is
// not a theme author any more.
//
// The file name is the template name: `website.hero.ktl` provides `website.hero`,
// which keeps one source of truth and makes an error message locatable without
// carrying a second map around.

import { readdirSync, readFileSync } from 'node:fs'
import { KetError } from '../kernel/errors.ts'

const EXT = '.ktl'

export function loadTemplates(dir: URL | string): Record<string, string> {
  const base = typeof dir === 'string' ? new URL(`file://${dir}`) : dir
  let names: string[]
  try {
    names = readdirSync(base).filter(n => n.endsWith(EXT))
  } catch {
    throw new KetError({
      code: 'E_TEMPLATE_DIR_MISSING',
      message: `no template directory at ${base.pathname}`,
      hint: 'loadTemplates takes a directory of .ktl files, usually new URL("./templates/", import.meta.url)',
    })
  }
  if (!names.length) {
    throw new KetError({
      code: 'E_NO_TEMPLATES',
      message: `${base.pathname} contains no ${EXT} files`,
      hint: 'a theme with no templates renders nothing; delete the call or add a template',
    })
  }
  const out: Record<string, string> = {}
  for (const file of names.sort()) out[file.slice(0, -EXT.length)] = readFileSync(new URL(file, base), 'utf8')
  return out
}
