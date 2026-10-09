export interface VersionMirror {
  version?: string
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  optionalDependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
}

export interface Manifest extends VersionMirror {
  name: string
  version: string
  overrides?: Record<string, string | Record<string, string>>
}

export interface LockEntry extends VersionMirror {
  resolved?: string
  integrity?: string
}

export interface PackageLock {
  name?: string
  version?: string
  packages: Record<string, LockEntry>
}

export interface Tarball {
  path: string
  version: string
  integrity: string
  shasum: string
}

export interface Check {
  id: string
  command: string
  exitCode: number | null
  logSha256: string
}

export type Runner = (id: string, executable: string, args: string[], cwd?: string) => string

export interface DocumentAudit {
  files: string[]
  fences: number
  contract: string
}

export interface ConsumerReport {
  version: string
  mode: 'candidate' | 'published'
  environment: { node: string; platform: string }
  packages: Record<string, Omit<Tarball, 'path'>>
  documents: DocumentAudit
  checks: Check[]
}

export interface AuditEntry {
  version: string
  versionCommit: string
  reason: string
  auditedCommit: string
  sourceDigest: string
  evidence: ConsumerReport
}

export interface AuditLedger {
  schema: 1
  releases: AuditEntry[]
}
