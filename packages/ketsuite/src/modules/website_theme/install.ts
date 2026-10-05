import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  bootRuntime,
  callFn,
  migrateOne,
  namespacedStorage,
  sqliteStore,
  storageFromConfig,
} from '@ketvietlab/ketjs'
import type { DeploymentSpec, Row, Storage } from '@ketvietlab/ketjs'
import { checkThemePackage } from './package.ts'
import type { ThemeIssue } from './package.ts'

/**
 * Where an install writes: the tenant's storage, namespaced exactly as the server namespaces it, and a
 * way to run the registry's internal functions as the operator inside the owning company.
 */
export type ThemeInstallTarget = {
  storage: Storage
  call: (fn: string, input: Row) => Promise<Row>
}

export type ThemeInstallResult =
  | { ok: true; id: string; status: string; storagePrefix: string }
  | { ok: false; errors: Array<ThemeIssue | Row> }

const once = async function* (bytes: Uint8Array) {
  yield bytes
}

/**
 * Install one theme version: check the package, record it, write its files, mark it installed.
 *
 * The files go through the KetJS `Storage` abstraction, so the same install works on the `local` driver
 * of a self-hosted server and on S3-compatible Object Storage. Running it again with the same package
 * finishes an interrupted install and otherwise changes nothing.
 */
export async function installThemePackage(
  target: ThemeInstallTarget,
  files: Record<string, Uint8Array>,
  options: { available?: boolean } = {},
): Promise<ThemeInstallResult> {
  const checked = checkThemePackage(files)
  if (!checked.ok) return { ok: false, errors: checked.errors }
  const staged = await target.call('website_theme.stageThemeVersion', {
    manifest: checked.manifest,
    hash: checked.hash,
    files: checked.files,
  })
  if (staged.ok !== true) return { ok: false, errors: (staged.errors as Row[]) ?? [] }
  const id = String(staged.id)
  const prefix = String(staged.storagePrefix)
  let status = String(staged.status)
  if (status === 'staged') {
    for (const file of checked.files)
      await target.storage.put(`${prefix}${file.name}`, once(files[file.name]!), {
        type: file.type,
        size: file.size,
      })
    const completed = await target.call('website_theme.completeThemeVersion', { id })
    if (completed.ok !== true) return { ok: false, errors: (completed.errors as Row[]) ?? [] }
    status = String(completed.status)
  }
  if (options.available && status !== 'available') {
    const offered = await target.call('website_theme.setThemeVersionStatus', { id, status: 'available' })
    if (offered.ok !== true) return { ok: false, errors: (offered.errors as Row[]) ?? [] }
    status = 'available'
  }
  return { ok: true, id, status, storagePrefix: prefix }
}

/** A package directory, read flat: a subdirectory is not part of any theme and is refused. */
export async function readThemeDirectory(dir: string): Promise<Record<string, Uint8Array>> {
  const files: Record<string, Uint8Array> = {}
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (!entry.isFile()) throw new Error(`theme packages are flat; "${entry.name}" is not a file`)
    files[entry.name] = new Uint8Array(await readFile(join(dir, entry.name)))
  }
  return files
}

/**
 * The operator's install against a deployment's own database and storage, as `ketsuite theme install`
 * runs it. A deployment with tenant databases needs the tenant key the server uses for that host.
 */
export async function installWebsiteTheme(
  spec: DeploymentSpec,
  options: {
    dir: string
    company: string
    tenant?: string
    available?: boolean
    env?: Record<string, string | undefined>
  },
): Promise<ThemeInstallResult> {
  if (!spec.serve) throw new Error(`deployment "${spec.name}" declares no serve block`)
  if (spec.serve.tenants && !options.tenant)
    throw new Error(`deployment "${spec.name}" has tenant databases; pass --tenant NAME`)
  const files = await readThemeDirectory(options.dir)
  const runtime = await bootRuntime(spec, { env: options.env ?? process.env, role: 'cli' })
  const adapter = spec.serve.tenants
    ? await spec.serve.tenants.open(options.tenant as string, runtime.config)
    : await (spec.serve.openStore ?? sqliteStore)(runtime.config)
  if (spec.serve.tenants) await adapter.open()
  try {
    await migrateOne(adapter, runtime.manifest)
    const base = await (spec.serve.openStorage ?? storageFromConfig)(runtime.config)
    const storage = namespacedStorage(base, options.tenant || spec.name)
    return await installThemePackage(
      {
        storage,
        call: async (fn, input) =>
          (
            await callFn(fn, input, {
              adapter,
              manifest: runtime.manifest,
              actor: 'system:theme-install',
              scope: { company: options.company, branch: null },
            })
          ).value as Row,
      },
      files,
      { available: options.available ?? false },
    )
  } finally {
    await adapter.close()
  }
}
