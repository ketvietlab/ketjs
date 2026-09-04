import { resolve, sep } from 'node:path'
import { KetError } from '../../kernel/errors.ts'
import type { RuntimeConfig } from '../config.ts'
import { localStorage } from './local.ts'
import { s3Storage } from './s3.ts'
import type { Storage } from './types.ts'
import { withPublicStorage } from './types.ts'

export function storageFromConfig(config: RuntimeConfig): Storage {
  const privateStorage = privateFromConfig(config)
  const publicConfig = config.publicStorage
  if (!publicConfig) return privateStorage
  let publicStorage: Storage
  if (publicConfig.kind === 'local') {
    if (!publicConfig.dir)
      throw new KetError({
        code: 'E_STORAGE_CONFIG',
        message: 'public storage is missing KET_STORAGE_PUBLIC_DIR',
      })
    if (config.storageKind === 'local') {
      const a = resolve(config.storageDir)
      const b = resolve(publicConfig.dir)
      const beneath = (parent: string, child: string) =>
        child.startsWith(parent.endsWith(sep) ? parent : parent + sep)
      if (a === b || beneath(a, b) || beneath(b, a))
        throw new KetError({
          code: 'E_STORAGE_CONFIG',
          message: 'private and public storage directories must not overlap',
        })
    }
    publicStorage = localStorage({ dir: publicConfig.dir })
  } else {
    const endpoint = publicConfig.endpoint ?? config.s3Endpoint
    const missing = [
      ['KET_S3_PUBLIC_ENDPOINT', endpoint],
      ['KET_S3_PUBLIC_BUCKET', publicConfig.bucket],
      ['KET_S3_PUBLIC_KEY', publicConfig.accessKeyId],
      ['KET_S3_PUBLIC_SECRET', publicConfig.secretAccessKey],
    ].filter(([, value]) => !value)
    if (missing.length)
      throw new KetError({
        code: 'E_STORAGE_CONFIG',
        message: `public S3 storage is missing ${missing.map(([name]) => name).join(', ')}`,
      })
    // The S3 adapter replaces the URL path when addressing objects, so paths,
    // fragments and query strings cannot make two buckets distinct.
    const endpointId = (value: string) => new URL(value).origin
    if (
      config.storageKind === 's3' &&
      publicConfig.bucket === config.s3Bucket &&
      endpointId(endpoint!) === endpointId(config.s3Endpoint!)
    )
      throw new KetError({
        code: 'E_STORAGE_CONFIG',
        message: 'private and public S3 buckets must be distinct',
      })
    publicStorage = s3Storage({
      endpoint: endpoint!,
      bucket: publicConfig.bucket,
      accessKeyId: publicConfig.accessKeyId,
      secretAccessKey: publicConfig.secretAccessKey,
      region: publicConfig.region ?? config.s3Region,
      pathStyle: publicConfig.pathStyle ?? config.s3PathStyle,
    })
  }
  return withPublicStorage(privateStorage, publicStorage, { baseUrl: publicConfig.baseUrl })
}

function privateFromConfig(config: RuntimeConfig): Storage {
  if (config.storageKind === 'local') return localStorage({ dir: config.storageDir })
  const missing = [
    ['KET_S3_ENDPOINT', config.s3Endpoint],
    ['KET_S3_BUCKET', config.s3Bucket],
    ['KET_S3_KEY', config.s3AccessKeyId],
    ['KET_S3_SECRET', config.s3SecretAccessKey],
  ].filter(([, value]) => !value)
  if (missing.length)
    throw new KetError({
      code: 'E_STORAGE_CONFIG',
      message: `S3 storage is missing ${missing.map(([name]) => name).join(', ')}`,
    })
  return s3Storage({
    endpoint: config.s3Endpoint as string,
    region: config.s3Region,
    bucket: config.s3Bucket as string,
    accessKeyId: config.s3AccessKeyId as string,
    secretAccessKey: config.s3SecretAccessKey as string,
    pathStyle: config.s3PathStyle,
  })
}

export { localStorage } from './local.ts'
export { s3Storage } from './s3.ts'
export { namespacedStorage, effectStorage, withPublicStorage } from './types.ts'
export type { Storage, Stored, OpenStorage, StorageEffect } from './types.ts'
export type { S3StorageOptions } from './s3.ts'
export { signRequest, presignUrl, sha256 } from './sigv4.ts'
export type { SigV4Credentials } from './sigv4.ts'
