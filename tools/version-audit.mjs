import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ROOT, materializeVersion, producers, readJson, readVersion } from './version.mjs'
import { auditDocuments } from './version-documents.mjs'

export const requiredChecks = [
  'producer-build',
  'docs-install',
  'docs-audit',
  'docs-tests',
  'docs-check',
  'docs-build',
  'api-install',
  'api-check',
  'api-tests',
  'view-install',
  'view-check',
  'view-build',
  'download-api-install',
  'download-api-check',
  'download-api-tests',
  'download-view-install',
  'download-view-check',
  'download-view-build',
]
const sha = /^[a-f0-9]{40}$/
const hash = /^[a-f0-9]{64}$/
export function git(root, args) {
  const result = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8' })
  if (result.status !== 0) throw new Error(`git ${args.join(' ')}: ${result.stderr}`)
  return result.stdout.trim()
}

export function sourceDigest(root = ROOT) {
  const paths = git(root, ['ls-files', '-z'])
    .split('\0')
    .filter((path) => path && path !== 'CHANGE_LOG')
    .sort()
  const digest = createHash('sha256')
  for (const path of paths) {
    digest
      .update(path)
      .update('\0')
      .update(readFileSync(join(root, path)))
      .update('\0')
  }
  return digest.digest('hex')
}

export function versionCommit(root = ROOT) {
  const commit = git(root, ['log', '--no-merges', '-1', '--format=%H', '--', 'VERSION'])
  if (!sha.test(commit)) throw new Error('Commit VERSION before recording its audit')
  const message = git(root, ['show', '-s', '--format=%B', commit])
  const reasons = [...message.matchAll(/^Version-Reason: (.+)$/gm)]
  if (
    reasons.length !== 1 ||
    reasons[0][1].trim().length < 20 ||
    /^(?:todo|tbd|bump|test|placeholder)\b/i.test(reasons[0][1])
  ) {
    throw new Error(`${commit}: one meaningful Version-Reason trailer (at least 20 characters) is required`)
  }
  return { commit, reason: reasons[0][1].trim() }
}

export function checkAudit(root = ROOT) {
  const version = materializeVersion({ root, check: true })
  if (!existsSync(join(root, 'CHANGE_LOG')))
    throw new Error('Missing CHANGE_LOG; run npm run version:record after committing VERSION')
  const ledger = readJson(join(root, 'CHANGE_LOG'))
  if (ledger.schema !== 1 || !Array.isArray(ledger.releases)) throw new Error('Invalid CHANGE_LOG schema')
  if (new Set(ledger.releases.map((entry) => entry.version)).size !== ledger.releases.length)
    throw new Error('Duplicate CHANGE_LOG version')
  const entry = ledger.releases.find((item) => item.version === version)
  if (!entry) throw new Error(`Missing CHANGE_LOG entry for ${version}`)
  const expected = versionCommit(root)
  if (entry.versionCommit !== expected.commit || entry.reason !== expected.reason)
    throw new Error('CHANGE_LOG commit/reason does not match the VERSION commit')
  for (const commit of git(root, ['log', '--no-merges', '--format=%H', '--', 'VERSION']).split('\n')) {
    const previousVersion = git(root, ['show', `${commit}:VERSION`])
    const recorded = ledger.releases.find(
      (item) => item.version === previousVersion && item.versionCommit === commit,
    )
    const reason = git(root, ['show', '-s', '--format=%B', commit])
      .match(/^Version-Reason: (.+)$/m)?.[1]
      ?.trim()
    if (!recorded || recorded.reason !== reason)
      throw new Error(`Missing historical VERSION commit/reason in CHANGE_LOG: ${previousVersion} ${commit}`)
  }
  if (git(root, ['show', `${entry.versionCommit}:VERSION`]) !== version)
    throw new Error('CHANGE_LOG commit records a different VERSION')
  if (!sha.test(entry.auditedCommit)) throw new Error('Missing audited source commit')
  git(root, ['merge-base', '--is-ancestor', entry.auditedCommit, 'HEAD'])
  git(root, ['merge-base', '--is-ancestor', entry.versionCommit, entry.auditedCommit])
  if (!hash.test(entry.sourceDigest) || entry.sourceDigest !== sourceDigest(root))
    throw new Error('Stale CHANGE_LOG evidence: source changed after the audit; rerun version:record')
  git(root, ['diff', '--quiet', entry.auditedCommit, '--', '.', ':(exclude)CHANGE_LOG'])
  if (entry.evidence?.version !== version || entry.evidence?.mode !== 'candidate')
    throw new Error('CHANGE_LOG must record candidate consumer verification')
  if (!entry.evidence.environment?.node || !entry.evidence.environment?.platform)
    throw new Error('Missing audit execution environment')
  const evidence = new Map((entry.evidence?.checks ?? []).map((check) => [check.id, check]))
  for (const id of requiredChecks) {
    const check = evidence.get(id)
    if (check?.exitCode !== 0 || !hash.test(check.logSha256) || !check.command)
      throw new Error(`Missing passing CHANGE_LOG evidence: ${id}`)
  }
  for (const { name } of producers) {
    const packed = entry.evidence.packages?.[name]
    if (
      packed?.version !== version ||
      !sha.test(packed.shasum ?? '') ||
      !/^sha512-[A-Za-z0-9+/]{86}==$/.test(packed.integrity ?? '')
    )
      throw new Error(`Missing candidate tarball evidence for ${name}`)
  }
  if (JSON.stringify(entry.evidence.documents) !== JSON.stringify(auditDocuments(root)))
    throw new Error('CHANGE_LOG document audit coverage is stale')
  return entry
}

export function versionChanged(root, base) {
  const result = spawnSync('git', ['-C', root, 'show', `${base}:VERSION`], { encoding: 'utf8' })
  return result.status !== 0 || result.stdout.trim() !== readVersion(root)
}

export async function recordAudit(root = ROOT) {
  materializeVersion({ root, check: true })
  const dirty = git(root, ['status', '--porcelain', '--untracked-files=all'])
    .split('\n')
    .filter((line) => line && !line.endsWith(' CHANGE_LOG'))
  if (dirty.length)
    throw new Error(
      'Commit source, generated mirrors and documentation before version:record (only CHANGE_LOG may be dirty)',
    )
  const { commit, reason } = versionCommit(root)
  const auditedCommit = git(root, ['rev-parse', 'HEAD'])
  const before = sourceDigest(root)
  const { verifyConsumers } = await import('./version-consumers.mjs')
  const evidence = await verifyConsumers({ root })
  if (sourceDigest(root) !== before || git(root, ['rev-parse', 'HEAD']) !== auditedCommit)
    throw new Error('Source changed during version audit')
  const ledgerPath = join(root, 'CHANGE_LOG')
  const ledger = existsSync(ledgerPath) ? readJson(ledgerPath) : { schema: 1, releases: [] }
  if (ledger.schema !== 1 || !Array.isArray(ledger.releases))
    throw new Error('Invalid existing CHANGE_LOG schema')
  const entry = {
    version: readVersion(root),
    versionCommit: commit,
    reason,
    auditedCommit,
    sourceDigest: before,
    evidence,
  }
  const index = ledger.releases.findIndex((item) => item.version === entry.version)
  if (index < 0) ledger.releases.push(entry)
  else ledger.releases[index] = entry
  writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2) + '\n')
  checkAudit(root)
  console.log(`CHANGE_LOG: recorded verified ${entry.version} evidence for ${auditedCommit}`)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const command = process.argv[2] ?? 'check'
  if (command === 'record') await recordAudit()
  else if (command === 'check')
    console.log(`CHANGE_LOG ${checkAudit().version}: commit, reason and current evidence verified`)
  else if (command === 'gate') {
    const base = process.argv[3]
    if (!base || versionChanged(ROOT, base)) checkAudit()
    else console.log('VERSION unchanged: no release audit required for this pull request')
  } else throw new Error('Use version-audit.mjs check|record|gate [base-commit]')
}
