import assert from 'node:assert/strict'
import { test } from 'node:test'
import { compose } from '@ketvietlab/ketjs'
import { ketsuitePermissionModuleNames, ketsuitePermissionModules } from '@ketvietlab/ketsuite'
import { createKetsuiteDeployment } from '../packages/ketsuite/src/deployment.ts'

test('public production permission catalogue covers every function owned by its modules', () => {
  const deployment = createKetsuiteDeployment()
  const modules = [
    ...deployment.modules,
    ...(deployment.theme ? [deployment.theme] : []),
    ...(deployment.themes ?? []),
  ]
  const manifest = compose(modules, {
    modulePermissionDeclarations: ketsuitePermissionModules,
  })

  assert.equal(ketsuitePermissionModuleNames.length, 59)
  assert.equal(Object.keys(manifest.permissions.modules).length, 59)
  assert.equal(Object.keys(manifest.permissions.bundles).length, 127)
  assert.equal(Object.keys(manifest.permissions.functions).length, 698)
  assert.equal(Object.keys(manifest.permissions.exemptions).length, 70)

  const coveredModules = new Set(ketsuitePermissionModuleNames)
  const missing = Object.entries(manifest.functions)
    .filter(([, fn]) => coveredModules.has(fn.by))
    .map(([key]) => key)
    .filter((key) => !manifest.permissions.functions[key] && !manifest.permissions.exemptions[key])
  assert.deepEqual(missing, [])
})

test('public catalogue separates identity administration from sensitive inspection', () => {
  const declaration = ketsuitePermissionModules.user
  assert.deepEqual(declaration?.functions['user.cloneManagedRole'], {
    risk: 'security',
    bundles: ['user.security'],
    owner: 'user',
    policy: 'user.security-audit',
  })
  assert.deepEqual(declaration?.functions['user.effectiveAccess'], {
    risk: 'sensitive',
    bundles: ['user.sensitive'],
    owner: 'user',
    policy: 'user.sensitive-data',
  })
})
