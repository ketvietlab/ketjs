import { createHash } from 'node:crypto'
import { deleteFrom, defineFn, eq } from '@ketvietlab/ketjs'
import type { Ctx, FnSpec, Row } from '@ketvietlab/ketjs'

const now = () => new Date().toISOString()
const issue = (field: string, message: string) => ({ field, message })
const invalid = (field: string, message: string) => ({ ok: false, errors: [issue(field, message)] })
const digest = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex')
const mine = (ctx: Ctx, model: string, where: Row = {}) =>
  ctx.db.select(model, { companyId: ctx.scope.company, ...where })

const check = async (ctx: Ctx, id: unknown) => {
  const requirement = (await mine(ctx, 'quality.Requirement', { id }))[0]
  if (!requirement) return null
  const template = (await mine(ctx, 'quality.Template', { id: requirement.templateId }))[0]
  if (!template) return null
  const [steps, attempts, reviews, photos] = await Promise.all([
    mine(ctx, 'quality.Step', { templateId: template.id }),
    mine(ctx, 'quality.Attempt', { requirementId: requirement.id }),
    mine(ctx, 'quality.Review', { requirementId: requirement.id }),
    mine(ctx, 'quality.Photo', { requirementId: requirement.id }),
  ])
  return {
    requirement,
    template,
    steps: steps.sort((a, b) => Number(a.sequence) - Number(b.sequence)),
    attempts: attempts.sort((a, b) => Number(a.sequence) - Number(b.sequence)),
    reviews: reviews.sort((a, b) => String(a.decidedAt).localeCompare(String(b.decidedAt))),
    photos,
  }
}

const templateHash = (version: unknown, steps: Row[]) =>
  digest(
    JSON.stringify({
      version: String(version),
      steps: steps.map((step) => ({
        sequence: Number(step.sequence),
        code: String(step.code),
        label: String(step.label),
        instruction: String(step.instruction),
        type: String(step.type),
        required: step.required === true,
        minimum: step.minimum ?? null,
        maximum: step.maximum ?? null,
        uom: step.uom ?? null,
        photoMimeTypes: step.photoMimeTypes ?? [],
        photoMaxBytes: step.photoMaxBytes ?? null,
      })),
    }),
  )

const validateSteps = (value: unknown): Row[] | null => {
  if (!Array.isArray(value) || value.length < 1 || value.length > 50) return null
  const steps = value as Row[]
  const types = new Set(['pass_fail', 'measure', 'checklist', 'photo'])
  const ids = new Set<string>()
  const sequences = new Set<number>()
  for (const step of steps) {
    const id = String(step.id ?? '')
    const sequence = Number(step.sequence)
    const type = String(step.type ?? '')
    if (!id || ids.has(id) || !Number.isInteger(sequence) || sequence < 1 || sequences.has(sequence))
      return null
    if (!String(step.code ?? '').trim() || !String(step.label ?? '').trim() || !types.has(type)) return null
    if (type === 'measure') {
      const minimum = Number(step.minimum)
      const maximum = Number(step.maximum)
      if (!Number.isFinite(minimum) || !Number.isFinite(maximum) || minimum > maximum) return null
    }
    if (type === 'photo') {
      const mimeTypes = Array.isArray(step.photoMimeTypes) ? step.photoMimeTypes.map(String) : []
      const maxBytes = Number(step.photoMaxBytes)
      if (
        !mimeTypes.length ||
        mimeTypes.length > 3 ||
        !Number.isInteger(maxBytes) ||
        maxBytes < 1 ||
        maxBytes > 262_144
      )
        return null
    }
    ids.add(id)
    sequences.add(sequence)
  }
  return steps
}

export const functions: Record<string, FnSpec> = {
  saveTemplate: defineFn({
    input: { id: 'id', version: 'text', steps: 'json', active: 'bool?' },
    output: { ok: 'bool', id: 'id?', hash: 'text?', errors: 'json?' },
    effects: [
      'read:quality.Template',
      'write:quality.Template',
      'read:quality.Step',
      'write:quality.Step',
      'read:quality.Requirement',
    ],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      const steps = validateSteps(args.steps)
      if (!steps) return invalid('steps', 'quality template steps are invalid')
      const timestamp = now()
      const hash = templateHash(args.version, steps)
      const existing = (await mine(ctx, 'quality.Template', { id: args.id }))[0]
      if (existing && (await mine(ctx, 'quality.Requirement', { templateId: args.id })).length)
        return invalid('id', 'a template already used by a requirement is immutable')
      await ctx.tx(async (tx) => {
        if (existing) {
          await tx.db.update(
            'quality.Template',
            { id: args.id },
            { version: args.version, hash, active: args.active ?? true, updatedAt: timestamp },
          )
          const Step = tx.table('quality.Step')
          await tx.db.del(deleteFrom(Step).where(eq(Step.templateId, String(args.id))))
        } else {
          await tx.db.insert('quality.Template', {
            id: args.id,
            version: args.version,
            hash,
            active: args.active ?? true,
            createdAt: timestamp,
            updatedAt: timestamp,
          })
        }
        for (const step of steps)
          await tx.db.insert('quality.Step', {
            id: step.id,
            templateId: args.id,
            sequence: step.sequence,
            code: step.code,
            label: step.label,
            instruction: step.instruction ?? '',
            type: step.type,
            required: step.required === true,
            minimum: step.minimum ?? null,
            maximum: step.maximum ?? null,
            uom: step.uom ?? null,
            photoMimeTypes: step.photoMimeTypes ?? [],
            photoMaxBytes: step.photoMaxBytes ?? null,
          })
      })
      return { ok: true, id: args.id, hash }
    },
  }),
  createRequirement: defineFn({
    input: { id: 'id', warehouseId: 'id', templateId: 'id' },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: [
      'read:stock.Warehouse',
      'read:quality.Template',
      'read:quality.Requirement',
      'write:quality.Requirement',
    ],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      const existing = (await mine(ctx, 'quality.Requirement', { id: args.id }))[0]
      if (existing)
        return existing.warehouseId === args.warehouseId && existing.templateId === args.templateId
          ? { ok: true, id: args.id }
          : invalid('id', 'quality requirement identity is already bound')
      if (!(await mine(ctx, 'stock.Warehouse', { id: args.warehouseId }))[0])
        return invalid('warehouseId', 'warehouse does not exist')
      const template = (await mine(ctx, 'quality.Template', { id: args.templateId, active: true }))[0]
      if (!template) return invalid('templateId', 'active quality template does not exist')
      const timestamp = now()
      await ctx.db.insert('quality.Requirement', {
        id: args.id,
        warehouseId: args.warehouseId,
        templateId: args.templateId,
        state: 'pending',
        revision: 0,
        createdAt: timestamp,
        updatedAt: timestamp,
      })
      return { ok: true, id: args.id }
    },
  }),
  getCheck: defineFn({
    input: { id: 'id' },
    effects: [
      'read:quality.Requirement',
      'read:quality.Template',
      'read:quality.Step',
      'read:quality.Attempt',
      'read:quality.Review',
      'read:quality.Photo',
    ],
    agent: true,
    handler: (ctx, args) => check(ctx, args.id),
  }),
  uploadPhoto: defineFn({
    input: {
      requirementId: 'id',
      warehouseId: 'id',
      stepId: 'id',
      expectedRevision: 'int',
      mimeType: 'text',
      checksum: 'text',
      altText: 'text',
      byteCount: 'int',
      storeKey: 'text',
    },
    output: { ok: 'bool', upload: 'json?', revision: 'int?', errors: 'json?' },
    effects: [
      'read:quality.Requirement',
      'write:quality.Requirement',
      'read:quality.Template',
      'read:quality.Step',
      'read:quality.Photo',
      'write:quality.Photo',
      'read:quality.Attempt',
      'read:quality.Review',
    ],
    idempotent: true,
    handler: async (ctx, args) => {
      const current = await check(ctx, args.requirementId)
      if (!current || current.requirement.warehouseId !== args.warehouseId)
        return invalid('requirementId', 'quality requirement does not exist')
      if (current.requirement.state !== 'pending') return invalid('requirementId', 'quality check is closed')
      if (Number(current.requirement.revision) !== Number(args.expectedRevision))
        return invalid('expectedRevision', 'quality check changed')
      const step = current.steps.find((candidate) => candidate.id === args.stepId)
      if (step?.type !== 'photo') return invalid('stepId', 'photo step does not exist')
      const mimeTypes = Array.isArray(step.photoMimeTypes) ? step.photoMimeTypes.map(String) : []
      if (!mimeTypes.includes(String(args.mimeType)))
        return invalid('mimeType', 'photo MIME type is not allowed')
      if (
        !Number.isInteger(args.byteCount) ||
        Number(args.byteCount) < 1 ||
        Number(args.byteCount) > Number(step.photoMaxBytes ?? 0)
      )
        return invalid('byteCount', 'photo size exceeds the step limit')
      const existing = current.photos.find(
        (photo) => photo.stepId === args.stepId && photo.checksum === args.checksum,
      )
      if (existing)
        return {
          ok: true,
          upload: existing,
          revision: Number(current.requirement.revision),
        }
      const id = `qpu_${digest(`${String(args.requirementId)}\0${String(args.stepId)}\0${String(args.checksum)}`).slice(0, 40)}`
      const storeKey = `quality/${String(args.requirementId)}/${id}`
      if (args.storeKey !== storeKey) return invalid('storeKey', 'quality photo storage key is invalid')
      const timestamp = now()
      const upload = {
        id,
        requirementId: args.requirementId,
        stepId: args.stepId,
        checksum: args.checksum,
        mimeType: args.mimeType,
        byteCount: args.byteCount,
        altText: args.altText,
        storeKey,
        createdAt: timestamp,
      }
      const written = await ctx.tx(async (tx) => {
        const changed = await tx.db.compareAndSet(
          'quality.Requirement',
          { id: args.requirementId },
          { revision: args.expectedRevision, state: 'pending' },
          { revision: Number(args.expectedRevision) + 1, updatedAt: timestamp },
        )
        if (!('dryRun' in changed) && !changed.matched) return false
        await tx.db.insert('quality.Photo', upload)
        return true
      })
      if (!written) return invalid('expectedRevision', 'quality check changed')
      return { ok: true, upload, revision: Number(args.expectedRevision) + 1 }
    },
  }),
  /**
   * An attempt, and the same attempt arriving twice.
   *
   * The id was a `randomUUID()`, so a replay could only ever be a second,
   * different attempt — and the revision it was written against had already
   * moved, so it was refused instead. The caller supplies the id now, derived
   * from the command it is retrying, and an attempt already carrying that id is
   * that command's answer coming back rather than a new submission.
   */
  submit: defineFn({
    input: {
      id: 'id',
      requirementId: 'id',
      warehouseId: 'id',
      expectedRevision: 'int',
      results: 'json',
      userId: 'id?',
    },
    output: { ok: 'bool', attempt: 'json?', state: 'text?', revision: 'int?', errors: 'json?' },
    effects: [
      'read:quality.Requirement',
      'write:quality.Requirement',
      'read:quality.Template',
      'read:quality.Step',
      'read:quality.Photo',
      'read:quality.Attempt',
      'write:quality.Attempt',
      'read:quality.Review',
    ],
    idempotent: true,
    handler: async (ctx, args) => {
      const current = await check(ctx, args.requirementId)
      if (!current || current.requirement.warehouseId !== args.warehouseId)
        return invalid('requirementId', 'quality requirement does not exist')
      const replay = current.attempts.find((entry) => String(entry.id) === String(args.id))
      if (replay)
        return {
          ok: true,
          attempt: replay,
          state: String(replay.outcome),
          revision: Number(current.requirement.revision),
        }
      if (current.requirement.state !== 'pending') return invalid('requirementId', 'quality check is closed')
      if (Number(current.requirement.revision) !== Number(args.expectedRevision))
        return invalid('expectedRevision', 'quality check changed')
      if (!Array.isArray(args.results) || !args.results.length || args.results.length > 50)
        return invalid('results', 'quality results are invalid')
      const results = args.results as Row[]
      const byStep = new Map(results.map((result) => [String(result.stepPublicId ?? ''), result]))
      if (byStep.size !== results.length) return invalid('results', 'quality steps must be submitted once')
      let passed = true
      for (const step of current.steps) {
        const result = byStep.get(String(step.id))
        if (!result) {
          if (step.required === true)
            return invalid('results', `required step ${String(step.code)} is missing`)
          continue
        }
        if (step.type === 'pass_fail' || step.type === 'checklist') {
          if (typeof result.value !== 'boolean')
            return invalid('results', `step ${String(step.code)} needs a boolean`)
          if (result.value !== true) passed = false
        } else if (step.type === 'measure') {
          const measured = Number(result.measurementValue)
          if (!Number.isFinite(measured))
            return invalid('results', `step ${String(step.code)} needs a measurement`)
          if (measured < Number(step.minimum) || measured > Number(step.maximum)) passed = false
        } else if (step.type === 'photo') {
          const upload = current.photos.find((photo) => photo.id === result.uploadPublicId)
          if (!upload || upload.stepId !== step.id || upload.checksum !== result.checksum)
            return invalid('results', `step ${String(step.code)} needs its canonical upload`)
          if (String(result.altText ?? '').trim() !== String(upload.altText))
            return invalid('results', `step ${String(step.code)} alt text changed after upload`)
        }
      }
      if ([...byStep.keys()].some((id) => !current.steps.some((step) => step.id === id)))
        return invalid('results', 'unknown quality step')
      const sequence = current.attempts.length + 1
      const submittedAt = now()
      const attempt = {
        id: args.id,
        requirementId: args.requirementId,
        sequence,
        outcome: passed ? 'passed' : 'failed',
        results,
        submittedAt,
        submittedByUserId: args.userId ?? null,
      }
      const written = await ctx.tx(async (tx) => {
        const changed = await tx.db.compareAndSet(
          'quality.Requirement',
          { id: args.requirementId },
          { revision: args.expectedRevision, state: 'pending' },
          {
            state: attempt.outcome,
            revision: Number(args.expectedRevision) + 1,
            updatedAt: submittedAt,
          },
        )
        if (!('dryRun' in changed) && !changed.matched) return false
        await tx.db.insert('quality.Attempt', attempt)
        return true
      })
      if (!written) return invalid('expectedRevision', 'quality check changed')
      return {
        ok: true,
        attempt,
        state: attempt.outcome,
        revision: Number(args.expectedRevision) + 1,
      }
    },
  }),
}
