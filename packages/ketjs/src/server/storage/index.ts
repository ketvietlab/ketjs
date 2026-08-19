import { KetError } from '../../kernel/errors.ts'
import type { RuntimeConfig } from '../config.ts'
import { localStorage } from './local.ts'
import { s3Storage } from './s3.ts'
import type { Storage } from './types.ts'

export function storageFromConfig(config: RuntimeConfig): Storage {
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
export { namespacedStorage, effectStorage } from './types.ts'
export type { Storage, Stored, OpenStorage, StorageEffect } from './types.ts'
export type { S3StorageOptions } from './s3.ts'
export { signRequest, presignUrl, sha256 } from './sigv4.ts'
export type { SigV4Credentials } from './sigv4.ts'
