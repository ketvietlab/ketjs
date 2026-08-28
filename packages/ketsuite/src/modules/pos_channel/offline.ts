import type { Row, Route, ServeContext } from '@ketvietlab/ketjs'
import { stableHash, type PosIdentity } from '../channel_api/core.ts'

type Req = Parameters<Route>[1]

export type PosOfflineCommandEvidence = {
  commandId: string
  sequence: number
  dependencyIds: string[]
  aggregateType: 'order'
  aggregateId: string
  aggregateRevision: number
  operation: string
  capturedAt: string
  idempotencyKey: string
  payload: Row
  signature: string
}

export type PosOfflineLeaseClaims = {
  leaseId: string
  companyId: string
  posConfigId: string
  deviceId: string
  grantId: string
  operatorId: string
  sessionId: string
  deviceSecurityVersion: number
  grantSecurityVersion: number
  shiftId: string
  priceBookRevision: string
  issuedAt: string
  expiresAt: string
  minSequence: number
  maxSequence: number
  allowedOperationIds: string[]
  ceilings: Row
}

export type PosOfflineLease = {
  token: string
  claims: PosOfflineLeaseClaims
}

export type PosOfflineLeaseProvider = {
  issue: (
    ctx: ServeContext,
    url: URL,
    req: Req,
    input: {
      identity: PosIdentity
      shiftId: string
      priceBookRevision: string
      minSequence: number
      allowedOperationIds: readonly string[]
    },
  ) => Promise<PosOfflineLease | null>
  verify: (
    ctx: ServeContext,
    url: URL,
    req: Req,
    input: {
      identity: PosIdentity
      token: string
      commands: PosOfflineCommandEvidence[]
    },
  ) => Promise<{ ok: true; claims: PosOfflineLeaseClaims } | { ok: false; code: string; retryable?: boolean }>
}

let provider: PosOfflineLeaseProvider | null = null
let providerOwner: string | null = null

export const registerPosOfflineLeaseProvider = (
  value: PosOfflineLeaseProvider,
  owner = 'pos_offline_lease_provider',
): void => {
  if (provider && providerOwner !== owner)
    throw new Error(`POS offline lease provider already registered by ${providerOwner}`)
  provider = value
  providerOwner = owner
}

export const posOfflineLeaseProvider = (): PosOfflineLeaseProvider | null => provider

/** Canonical digest signed by the enrolled device key for one leased command. */
export const posOfflineCommandDigest = (
  command: Omit<PosOfflineCommandEvidence, 'signature'> | PosOfflineCommandEvidence,
): string => {
  const { signature: _signature, ...unsigned } = command as PosOfflineCommandEvidence
  return stableHash(unsigned)
}
