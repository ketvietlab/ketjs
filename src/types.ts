// The vocabulary of the whole framework. Everything else is derived from these.

export type Scalar = 'id' | 'text' | 'int' | 'float' | 'bool' | 'json' | 'datetime'
export type FieldBase = Scalar | 'ref'

export type ParsedType = { base: FieldBase; optional: boolean; target?: string }
export type TypeParse = ({ ok: true } & ParsedType) | { ok: false; reason: string }

export type Field = ParsedType & { by: string }
export type ComposedModel = { owner: string; fields: Record<string, Field> }

export type ModelDef = { fields: Record<string, string> }
export type JointDef = { props?: Record<string, string>; multiple?: boolean }
export type ViewDef = { of: string; fields: string[] }

export type FnSpec = {
  input?: Record<string, string>
  output?: Record<string, string>
  effects?: string[]
  idempotent?: boolean
  dryRun?: boolean
  agent?: boolean
  handler: (ctx: Ctx, args: Record<string, unknown>) => unknown
}

export type FnMeta = {
  by: string
  input: Record<string, string>
  output: Record<string, string>
  effects: string[]
  idempotent: boolean
  dryRun: boolean
  agent: boolean
}

export type ModuleSpec = {
  kind?: 'module' | 'theme'
  name: string
  version?: string
  depends?: string[]
  models?: Record<string, ModelDef>
  extend?: Record<string, Record<string, string>>
  joints?: Record<string, JointDef>
  fills?: Record<string, string>
  functions?: Record<string, FnSpec>
  views?: Record<string, ViewDef>
  requires?: string[]
  tokens?: Record<string, string>
  templates?: Record<string, string>
  provides?: string[]
}

export type KetModule = {
  readonly kind: 'module' | 'theme'
  readonly name: string
  readonly version: string
  readonly depends: readonly string[]
  readonly models: Record<string, ModelDef>
  readonly extend: Record<string, Record<string, string>>
  readonly joints: Record<string, JointDef>
  readonly fills: Record<string, string>
  readonly functions: Record<string, FnSpec>
  readonly views: Record<string, ViewDef>
  readonly requires: readonly string[]
  readonly tokens: Record<string, string>
  readonly templates: Record<string, string>
  readonly provides: readonly string[]
}

export type Manifest = {
  ket: string
  order: string[]
  modules: Record<string, { version: string; kind: string; depends: string[] }>
  models: Record<string, ComposedModel>
  joints: Record<string, { owner: string; props: Record<string, string>; multiple: boolean }>
  fills: Array<{ joint: string; by: string; template: string }>
  functions: Record<string, FnMeta>
  views: Record<string, ViewDef & { by: string }>
  regions: { required: string[]; provided: Record<string, string[]> }
  tokens: Record<string, string>
  patches: Array<{ by: string; target: string; reason: string }>
  diagnostics?: Diagnostic[]
}

export type Diagnostic = { code: string; message: string; module?: string | null; hint?: string | null; at?: string | null }

export type WriteRecord = { op: 'insert' | 'update'; model: string; row?: Row; where?: Row; patch?: Row }
export type Row = Record<string, unknown>

export type Ctx = {
  fnKey: string
  actor: string | null
  dryRun: boolean
  effects: string[]
  writes: WriteRecord[]
  db: {
    select(model: string, where?: Row): Row[]
    insert(model: string, row: Row): unknown
    update(model: string, where: Row, patch: Row): unknown
  }
}

export type Adapter = {
  name: string
  open(): void
  close(): void
  exec(sql: string): void
  all(sql: string, params?: unknown[]): Row[]
  run(sql: string, params?: unknown[]): { changes: number }
  tx<T>(fn: () => T): T
  quoteIdent(name: string): string
  columnSql(c: { base: FieldBase }): string
  introspect(): Record<string, Record<string, string>>
}
