// Everything a running app needs to know, read once, in one place.
//
// Configuration is deliberately a value rather than scattered process.env lookups:
// a misspelt variable is then a visible default rather than an undefined that
// surfaces three layers down as something else.
//
// Note what is NOT here: which driver to open. The framework knows the Adapter
// contract and ships SQLite, which it owns. Postgres lives in its own package, and
// a package the framework depended on would be a cycle — so a deployment that wants it
// hands `openStore` in. The fence is the reason, and the fence is checked.

import { sqliteAdapter } from '../data/sqlite.ts'
import { isTimezone } from '../data/time.ts'
import { KetError } from '../kernel/errors.ts'
import type { Adapter } from '../types.ts'

export type PublicStorageConfig =
  | { kind: 'local'; dir: string; baseUrl?: string | null }
  | {
      kind: 's3'
      bucket: string
      accessKeyId: string
      secretAccessKey: string
      endpoint?: string | null
      region?: string
      pathStyle?: boolean
      baseUrl?: string | null
    }

export type RuntimeConfig = {
  port: number
  host: string
  /** Non-null means "not SQLite"; the deployment's openStore decides what it means. */
  databaseUrl: string | null
  sqliteFile: string
  /** Applied on boot unless told otherwise; a production deploy migrates separately. */
  migrateOnBoot: boolean
  defaultLocale: string
  fallbackLocale: string
  /** IANA timezone used when the authenticated user has not chosen one. */
  defaultTimezone: string
  /** Until there is authentication, the company a request acts as comes from here. */
  defaultCompany: string
  /**
   * Signing key for session cookies. It MUST be the same on every pod — a cookie
   * signed by one and rejected by another is a login that works until the load
   * balancer sends you elsewhere.
   */
  secret: string | null
  /** Dedicated HMAC key for anonymous provider callbacks; never reuse a session cookie key. */
  webhookSecret: string | null
  /** LISTEN/NOTIFY is only an accelerator; polling remains the guarantee. */
  queueNotify: boolean
  storageKind: 'local' | 's3'
  storageDir: string
  uploadMax: number
  s3Endpoint: string | null
  s3Region: string
  s3Bucket: string | null
  s3AccessKeyId: string | null
  s3SecretAccessKey: string | null
  s3PathStyle: boolean
  /** Optional second backend; the legacy storage configuration remains private/default. */
  publicStorage?: PublicStorageConfig
}

export function readConfig(
  env: Record<string, string | undefined> = process.env,
  defaults: Partial<RuntimeConfig> = {},
): RuntimeConfig {
  const defaultTimezone = env.KET_TIMEZONE ?? defaults.defaultTimezone ?? 'UTC'
  if (!isTimezone(defaultTimezone)) {
    throw new KetError({
      code: 'E_TIMEZONE_CONFIG',
      message: `KET_TIMEZONE must be an IANA timezone, got "${defaultTimezone}"`,
    })
  }
  const storageKind = env.KET_STORAGE ?? defaults.storageKind ?? 'local'
  if (storageKind !== 'local' && storageKind !== 's3')
    throw new KetError({
      code: 'E_STORAGE_CONFIG',
      message: `KET_STORAGE must be local or s3, got "${storageKind}"`,
    })
  const uploadMax = Number(env.KET_UPLOAD_MAX ?? defaults.uploadMax ?? 25 * 1024 * 1024)
  if (!Number.isSafeInteger(uploadMax) || uploadMax < 1)
    throw new KetError({
      code: 'E_STORAGE_CONFIG',
      message: `KET_UPLOAD_MAX must be a positive integer, got "${env.KET_UPLOAD_MAX ?? uploadMax}"`,
    })
  let publicStorage = defaults.publicStorage
  const publicEnv = Object.keys(env).some(
    (key) =>
      (key.startsWith('KET_S3_PUBLIC_') ||
        key === 'KET_STORAGE_PUBLIC_DIR' ||
        key === 'KET_STORAGE_PUBLIC_URL') &&
      env[key] !== undefined,
  )
  if (publicEnv) {
    const baseUrl = env.KET_STORAGE_PUBLIC_URL ?? publicStorage?.baseUrl
    if (storageKind === 's3') {
      if (env.KET_STORAGE_PUBLIC_DIR !== undefined)
        throw new KetError({
          code: 'E_STORAGE_CONFIG',
          message: 'S3 storage cannot use KET_STORAGE_PUBLIC_DIR',
        })
      const held = publicStorage?.kind === 's3' ? publicStorage : undefined
      publicStorage = {
        kind: 's3',
        bucket: env.KET_S3_PUBLIC_BUCKET ?? held?.bucket ?? '',
        accessKeyId: env.KET_S3_PUBLIC_KEY ?? held?.accessKeyId ?? '',
        secretAccessKey: env.KET_S3_PUBLIC_SECRET ?? held?.secretAccessKey ?? '',
        endpoint: env.KET_S3_PUBLIC_ENDPOINT ?? held?.endpoint,
        region: env.KET_S3_PUBLIC_REGION ?? held?.region,
        pathStyle:
          env.KET_S3_PUBLIC_PATH_STYLE === undefined ? held?.pathStyle : env.KET_S3_PUBLIC_PATH_STYLE !== '0',
        baseUrl,
      }
    } else {
      if (Object.keys(env).some((key) => key.startsWith('KET_S3_PUBLIC_') && env[key] !== undefined))
        throw new KetError({ code: 'E_STORAGE_CONFIG', message: 'KET_S3_PUBLIC_* requires KET_STORAGE=s3' })
      publicStorage = {
        kind: 'local',
        dir: env.KET_STORAGE_PUBLIC_DIR ?? (publicStorage?.kind === 'local' ? publicStorage.dir : ''),
        baseUrl,
      }
    }
  }
  return {
    port: Number(env.PORT ?? defaults.port ?? 3000),
    host: env.HOST ?? defaults.host ?? '127.0.0.1',
    databaseUrl: env.DATABASE_URL ?? defaults.databaseUrl ?? null,
    sqliteFile: env.KET_SQLITE ?? defaults.sqliteFile ?? '.ket/deployment.db',
    migrateOnBoot: env.KET_MIGRATE === undefined ? (defaults.migrateOnBoot ?? true) : env.KET_MIGRATE !== '0',
    defaultLocale: env.KET_LOCALE ?? defaults.defaultLocale ?? 'en',
    fallbackLocale: env.KET_FALLBACK_LOCALE ?? defaults.fallbackLocale ?? defaults.defaultLocale ?? 'en',
    defaultTimezone,
    defaultCompany: env.KET_COMPANY ?? defaults.defaultCompany ?? 'default',
    secret: env.KET_SECRET ?? defaults.secret ?? null,
    webhookSecret: env.KET_WEBHOOK_SECRET ?? defaults.webhookSecret ?? null,
    queueNotify:
      env.KET_QUEUE_NOTIFY === undefined ? (defaults.queueNotify ?? true) : env.KET_QUEUE_NOTIFY !== '0',
    storageKind,
    storageDir: env.KET_STORAGE_DIR ?? defaults.storageDir ?? '.ket/storage',
    uploadMax,
    s3Endpoint: env.KET_S3_ENDPOINT ?? defaults.s3Endpoint ?? null,
    s3Region: env.KET_S3_REGION ?? defaults.s3Region ?? 'us-east-1',
    s3Bucket: env.KET_S3_BUCKET ?? defaults.s3Bucket ?? null,
    s3AccessKeyId: env.KET_S3_KEY ?? defaults.s3AccessKeyId ?? null,
    s3SecretAccessKey: env.KET_S3_SECRET ?? defaults.s3SecretAccessKey ?? null,
    s3PathStyle:
      env.KET_S3_PATH_STYLE === undefined ? (defaults.s3PathStyle ?? false) : env.KET_S3_PATH_STYLE !== '0',
    ...(publicStorage ? { publicStorage } : {}),
  }
}

/** How a deployment opens its datastore. SQLite is the default because it needs no driver. */
export type OpenStore = (config: RuntimeConfig) => Adapter | Promise<Adapter>

export const sqliteStore: OpenStore = async (config) => {
  if (config.databaseUrl) {
    throw new KetError({
      code: 'E_NO_DATASTORE_DRIVER',
      module: 'ketjs',
      message: `DATABASE_URL is set, but this deployment only knows how to open SQLite`,
      hint:
        'give the deployment a serve.openStore that imports a driver package (@ketvietlab/ketjs-postgres, say); ' +
        'the framework cannot depend on one without becoming a cycle',
    })
  }
  const adapter = sqliteAdapter(config.sqliteFile)
  await adapter.open()
  return adapter
}
