import {
  bootRuntime,
  callFn,
  createAppRegistry,
  migrateOne,
  restrictManifest,
  sqliteStore,
} from '@ketvietlab/ketjs'
import type { AppSpec } from '@ketvietlab/ketjs'
import { ketsuite } from './app.ts'

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
  spec: AppSpec = ketsuite,
  env: Record<string, string | undefined> = process.env,
): Promise<'created' | 'exists'> {
  if (!spec.serve) throw new Error(`app "${spec.name}" declares no serve block`)
  const runtime = await bootRuntime(spec, { env })
  const adapter = await (spec.serve.openStore ?? sqliteStore)(runtime.config)
  try {
    await migrateOne(adapter, runtime.manifest)
    const registry = await createAppRegistry(runtime.manifest, adapter, {
      autoInstall: runtime.config.autoInstall,
    })
    const bootstrap = runtime.config.bootstrapApps ?? spec.serve.bootstrap ?? []
    if ((await registry.enabled()).size === 0) for (const name of bootstrap) await registry.install(name)
    const manifest = restrictManifest(runtime.manifest, await registry.enabled())
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
        manifest,
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
