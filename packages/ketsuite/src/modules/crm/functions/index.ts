// The CRM function registry, assembled from one file per capability.
import type { FnSpec } from '@ketvietlab/ketjs'
import { accessFunctions } from './access.ts'
import { reportingFunctions } from './reporting.ts'
import { caseFunctions } from './cases.ts'
import { activityFunctions } from './activities.ts'
import { gamificationFunctions } from './gamification.ts'
import { configurationFunctions } from './configuration.ts'
import { modalContextFunctions } from './modal-context.ts'
import { caseModalContextFunctions } from './case-modal-context.ts'
import { previewFunctions } from './previews.ts'

const groups: Record<string, Record<string, FnSpec>> = {
  accessFunctions,
  caseFunctions,
  reportingFunctions,
  activityFunctions,
  gamificationFunctions,
  configurationFunctions,
  modalContextFunctions,
  caseModalContextFunctions,
  previewFunctions,
}

/** Merge the groups, refusing a key two groups both define. */
const assemble = (sources: Record<string, Record<string, FnSpec>>): Record<string, FnSpec> => {
  const merged: Record<string, FnSpec> = {}
  const owner = new Map<string, string>()
  for (const [group, specs] of Object.entries(sources))
    for (const [key, spec] of Object.entries(specs)) {
      const previous = owner.get(key)
      if (previous) throw new Error(`crm function "${key}" is defined by both ${previous} and ${group}`)
      owner.set(key, group)
      merged[key] = spec
    }
  return merged
}

export const functions: Record<string, FnSpec> = assemble(groups)

export { caseFormSchema, caseWriteEffects, createCaseId } from './shared.ts'
