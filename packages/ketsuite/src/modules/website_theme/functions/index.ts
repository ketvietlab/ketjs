import type { FnSpec } from '@ketvietlab/ketjs'
import { catalogFunctions } from './catalog.ts'
import { readerFunctions } from './reader.ts'
import { registryFunctions } from './registry.ts'
import { selectFunctions } from './select.ts'

export const functions: Record<string, FnSpec> = {}
for (const group of [registryFunctions, catalogFunctions, selectFunctions, readerFunctions]) {
  for (const [key, spec] of Object.entries(group)) {
    if (Object.hasOwn(functions, key)) throw new Error(`Duplicate website_theme function: ${key}`)
    functions[key] = spec
  }
}
