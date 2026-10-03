import type { FnSpec } from '@ketvietlab/ketjs'
import { roleFunctions } from '../roles.ts'
import { roleModalContextFunctions } from '../role-modal-context.ts'
import { userModalContextFunctions } from '../user-modal-context.ts'
import { profileFunctions } from './profile.ts'
import { authenticationFunctions } from './authentication.ts'
import { provisioningFunctions } from './provisioning.ts'
import { workplacesFunctions } from './workplaces.ts'
import { contextFunctions } from './context.ts'
export const functions: Record<string, FnSpec> = {}
for (const group of [
  roleFunctions,
  roleModalContextFunctions,
  userModalContextFunctions,
  profileFunctions,
  authenticationFunctions,
  provisioningFunctions,
  workplacesFunctions,
  contextFunctions,
]) {
  for (const [key, spec] of Object.entries(group)) {
    if (Object.hasOwn(functions, key)) throw new Error(`Duplicate user function: ${key}`)
    functions[key] = spec
  }
}
