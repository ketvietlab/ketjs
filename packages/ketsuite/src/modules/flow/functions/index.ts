import type { FnSpec } from '@ketvietlab/ketjs'
import { projectFunctions } from './project.ts'
import { columnFunctions } from './column.ts'
import { issueTypeFunctions } from './issueType.ts'
import { boardFunctions } from './board.ts'
import { fieldFunctions } from './field.ts'
import { epicFunctions } from './epic.ts'
import { pageFunctions } from './page.ts'
import { sprintFunctions } from './sprint.ts'
import { tagFunctions } from './tag.ts'
import { issueReadFunctions } from './issue-read.ts'
import { issueWriteFunctions } from './issue-write.ts'
import { issueBatchFunctions } from './issue-batch.ts'
import { issueDiscussionFunctions } from './issue-discussion.ts'
import { issueDependencyFunctions } from './issue-dependency.ts'

/** Check before assignment: object spread would silently replace a capability. */
export function assembleFunctions(groups: readonly Record<string, FnSpec>[]): Record<string, FnSpec> {
  const result: Record<string, FnSpec> = {}
  for (const group of groups)
    for (const [key, spec] of Object.entries(group)) {
      if (Object.hasOwn(result, key)) throw new Error('Duplicate Flow function: ' + key)
      result[key] = spec
    }
  return result
}

export const functions = assembleFunctions([
  projectFunctions,
  columnFunctions,
  issueTypeFunctions,
  boardFunctions,
  fieldFunctions,
  epicFunctions,
  pageFunctions,
  sprintFunctions,
  tagFunctions,
  issueReadFunctions,
  issueWriteFunctions,
  issueBatchFunctions,
  issueDiscussionFunctions,
  issueDependencyFunctions,
])
