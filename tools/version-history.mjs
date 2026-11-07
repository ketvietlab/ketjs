import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

/**
 * Preserve the original ledger after a metadata-only Git history rewrite.
 * This proves source identity, not a new test run; current evidence must still
 * name the exact current VERSION commit and pass every check in checkAudit.
 * @param {string} root
 * @param {import('./version-types.d.ts').AuditEntry} entry
 * @param {string} commit
 */
export function matchesHistoricalCommit(root, entry, commit) {
  const path = join(root, 'tools/version-history.json')
  if (!existsSync(path)) return false
  /** @type {{schema: number, commits: Record<string, string>}} */
  const proofs = JSON.parse(readFileSync(path, 'utf8'))
  if (proofs.schema !== 1 || !proofs.commits || typeof proofs.commits !== 'object')
    throw new Error('Invalid VERSION history proof schema')
  const raw = proofs.commits[entry.versionCommit]
  if (raw === undefined) return false
  if (typeof raw !== 'string') throw new Error('Invalid VERSION history commit object')
  const objectId = createHash('sha1')
    .update(`commit ${Buffer.byteLength(raw)}\0`)
    .update(raw)
    .digest('hex')
  if (objectId !== entry.versionCommit) throw new Error('VERSION history commit object hash mismatch')
  const tree = raw.match(/^tree ([a-f0-9]{40})\n/)?.[1]
  const separator = raw.indexOf('\n\n')
  const reasons = [...raw.slice(separator + 2).matchAll(/^Version-Reason: (.+)$/gm)]
  const rewritten = spawnSync('git', ['-C', root, 'rev-parse', `${commit}^{tree}`], { encoding: 'utf8' })
  if (rewritten.status !== 0) throw new Error(`Cannot read historical VERSION tree: ${commit}`)
  return (
    separator >= 0 &&
    tree === rewritten.stdout.trim() &&
    reasons.length === 1 &&
    reasons[0][1].trim() === entry.reason
  )
}
