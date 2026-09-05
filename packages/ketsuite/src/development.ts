import { bootRuntime, callFn, migrateOne, sqliteStore } from '@ketvietlab/ketjs'
import type { DeploymentSpec } from '@ketvietlab/ketjs'
import { ketsuite } from './deployment.ts'

type ProvisionResult = {
  ok: boolean
  errors?: Array<{ code?: string }>
}

/**
 * Seed the intentionally insecure local scaffold account. This is reachable
 * only from the explicit `ketsuite serve --dev-admin` process path; normal
 * provisioning keeps the production password policy.
 */
export async function ensureDevelopmentAdmin(
  spec: DeploymentSpec = ketsuite,
  env: Record<string, string | undefined> = process.env,
): Promise<'created' | 'exists'> {
  if (!spec.serve) throw new Error(`app "${spec.name}" declares no serve block`)
  const runtime = await bootRuntime(spec, { env })
  const adapter = await (spec.serve.openStore ?? sqliteStore)(runtime.config)
  try {
    await migrateOne(adapter, runtime.manifest)
    const result = await callFn(
      'user.provisionAdmin',
      {
        companyName: 'KetSuite Development',
        companyCode: 'DEV',
        currency: 'VND',
        adminLogin: 'admin',
        adminName: 'Administrator',
        adminEmail: null,
        adminPassword: 'admin',
      },
      {
        adapter,
        manifest: runtime.manifest,
        actor: 'system:scaffold',
        scope: { company: null, branch: null },
      },
    )
    const value = result.value as ProvisionResult
    if (value.ok === true) return 'created'
    if (value.errors?.some((error) => error.code === 'user.error.provisionExists')) return 'exists'
    throw new Error(`could not create development admin: ${JSON.stringify(value.errors ?? value)}`)
  } finally {
    await adapter.close()
  }
}
