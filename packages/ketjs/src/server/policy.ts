import { KetError } from '../kernel/errors.ts'

export type PolicyDenialEvidence = {
  policy: string
  code: string
  actor: string | null
  targetDigest?: string
}

export type PolicyDecision = {
  policy: string
  allowed: boolean
  actor?: string | null
  /** A stable domain code; record data must not be embedded in it. */
  denialCode?: string
  /** Hash or opaque identifier only, never the protected record payload. */
  targetDigest?: string
  audit?: (evidence: PolicyDenialEvidence) => Promise<void>
}

/** Enforce one bounded domain policy after the function capability check. */
export async function enforcePolicy(decision: PolicyDecision): Promise<void> {
  if (!/^[a-z][a-z0-9_-]*(?:\.[a-z][a-z0-9_-]*)+$/.test(decision.policy))
    throw new KetError({
      code: 'E_POLICY_CONTRACT_INVALID',
      message: 'domain policy keys must be stable qualified identifiers',
    })
  if (decision.allowed) return
  const code = decision.denialCode?.trim() || 'E_POLICY_DENIED'
  await decision.audit?.({
    policy: decision.policy,
    code,
    actor: decision.actor ?? null,
    ...(decision.targetDigest ? { targetDigest: decision.targetDigest } : {}),
  })
  throw new KetError({
    code,
    message: `domain policy "${decision.policy}" denied this operation`,
    hint: 'the caller may hold the function capability and still fail record-level policy',
  })
}
