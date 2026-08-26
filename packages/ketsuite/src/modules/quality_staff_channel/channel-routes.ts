import { createHash } from 'node:crypto'
import type { Route, ServeContext } from '@ketvietlab/ketjs'
import { channelError, defineChannelRoute, routesOf, sha256, stableHash } from '../channel_api/core.ts'

type Req = Parameters<Route>[1]
type Row = Record<string, unknown>

const string = { type: 'string' }
const nullableString = { type: ['string', 'null'] }
const uuid = { type: 'string', format: 'uuid' }
const version = { type: 'string', pattern: '^qcv_[0-9a-f]{64}$' }
const envelope = (data: unknown) => ({
  type: 'object',
  properties: { data, error: {}, meta: { type: 'object' } },
})
const idParams = {
  type: 'object',
  additionalProperties: false,
  properties: { id: uuid },
  required: ['id'],
}
const step = {
  type: 'object',
  additionalProperties: false,
  properties: {
    publicId: uuid,
    sequence: { type: 'integer', minimum: 1 },
    code: string,
    label: string,
    instruction: string,
    type: { type: 'string', enum: ['pass_fail', 'measure', 'checklist', 'photo'] },
    required: { type: 'boolean' },
    minimum: nullableString,
    maximum: nullableString,
    uom: nullableString,
    photoMimeTypes: { type: 'array', items: string },
    photoMaxBytes: { type: ['integer', 'null'] },
  },
  required: [
    'publicId',
    'sequence',
    'code',
    'label',
    'instruction',
    'type',
    'required',
    'minimum',
    'maximum',
    'uom',
    'photoMimeTypes',
    'photoMaxBytes',
  ],
}
const checkSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    schemaVersion: { type: 'integer', const: 1 },
    requirementPublicId: uuid,
    state: { type: 'string', enum: ['pending', 'passed', 'failed', 'waived'] },
    expectedCheckVersion: version,
    template: {
      type: 'object',
      additionalProperties: false,
      properties: { version: string, hash: { type: 'string', pattern: '^[0-9a-f]{64}$' } },
      required: ['version', 'hash'],
    },
    steps: { type: 'array', items: step },
    attempts: {
      type: 'array',
      maxItems: 100,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          publicId: uuid,
          sequence: { type: 'integer', minimum: 1 },
          outcome: { type: 'string', enum: ['passed', 'failed'] },
          submittedAt: { type: 'string', format: 'date-time' },
        },
        required: ['publicId', 'sequence', 'outcome', 'submittedAt'],
      },
    },
    reviews: {
      type: 'array',
      maxItems: 100,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          publicId: uuid,
          outcome: { type: 'string', enum: ['rejected', 'waived'] },
          decidedAt: { type: 'string', format: 'date-time' },
        },
        required: ['publicId', 'outcome', 'decidedAt'],
      },
    },
  },
  required: [
    'schemaVersion',
    'requirementPublicId',
    'state',
    'expectedCheckVersion',
    'template',
    'steps',
    'attempts',
    'reviews',
  ],
}

const photoBody = {
  type: 'object',
  additionalProperties: false,
  properties: {
    warehouseId: string,
    stepPublicId: uuid,
    expectedVersion: version,
    mimeType: { type: 'string', enum: ['image/jpeg', 'image/png', 'image/webp'] },
    contentBase64: { type: 'string', minLength: 4, maxLength: 349_528 },
    checksum: { type: 'string', pattern: '^[0-9a-f]{64}$' },
    altText: { type: 'string', minLength: 3, maxLength: 240 },
  },
  required: [
    'warehouseId',
    'stepPublicId',
    'expectedVersion',
    'mimeType',
    'contentBase64',
    'checksum',
    'altText',
  ],
}
const resultInput = {
  type: 'object',
  additionalProperties: false,
  properties: {
    stepPublicId: uuid,
    value: { type: 'boolean' },
    measurementValue: { type: 'string', pattern: '^-?\\d+(?:\\.\\d+)?$' },
    uploadPublicId: string,
    checksum: { type: 'string', pattern: '^[0-9a-f]{64}$' },
    altText: { type: 'string', minLength: 3, maxLength: 240 },
  },
  required: ['stepPublicId'],
}
const submitBody = {
  type: 'object',
  additionalProperties: false,
  properties: {
    warehouseId: string,
    expectedVersion: version,
    results: { type: 'array', minItems: 1, maxItems: 50, items: resultInput },
  },
  required: ['warehouseId', 'expectedVersion', 'results'],
}
const photoResponse = {
  type: 'object',
  additionalProperties: false,
  properties: {
    schemaVersion: { type: 'integer', const: 1 },
    requirementPublicId: uuid,
    stepPublicId: uuid,
    uploadPublicId: { type: 'string', pattern: '^qpu_[0-9a-f]{40}$' },
    checksum: { type: 'string', pattern: '^[0-9a-f]{64}$' },
    mimeType: { type: 'string', enum: ['image/jpeg', 'image/png', 'image/webp'] },
    byteCount: { type: 'integer', minimum: 1, maximum: 262_144 },
    expectedCheckVersion: version,
  },
  required: [
    'schemaVersion',
    'requirementPublicId',
    'stepPublicId',
    'uploadPublicId',
    'checksum',
    'mimeType',
    'byteCount',
    'expectedCheckVersion',
  ],
}
const submitResponse = {
  type: 'object',
  additionalProperties: false,
  properties: {
    schemaVersion: { type: 'integer', const: 1 },
    requirementPublicId: uuid,
    state: { type: 'string', enum: ['passed', 'failed'] },
    checkVersion: version,
    attempt: {
      type: 'object',
      additionalProperties: false,
      properties: {
        publicId: uuid,
        outcome: { type: 'string', enum: ['passed', 'failed'] },
        submittedAt: { type: 'string', format: 'date-time' },
      },
      required: ['publicId', 'outcome', 'submittedAt'],
    },
  },
  required: ['schemaVersion', 'requirementPublicId', 'state', 'checkVersion', 'attempt'],
}

const idempotencyKey = (ctx: ServeContext, url: URL, req: Req) => {
  const key = String(req.headers['idempotency-key'] ?? '').trim()
  if (key.length >= 8 && key.length <= 200) return key
  return {
    status: 400,
    error: channelError(ctx, url, req, 'channel_api.idempotencyRequired', {
      messageKey: 'channel_api.error.idempotencyRequired',
    }),
  }
}
const requestVersion = (req: Req, body: Row): string | null => {
  const expected = String(body.expectedVersion ?? '')
  const header = String(req.headers['if-match'] ?? '').trim()
  return !header || header === expected || header === `"${expected}"` ? expected : null
}
const versionOf = (value: Row) =>
  `qcv_${stableHash({
    id: value.requirementPublicId,
    state: value.state,
    revision: value.revision,
    template: value.template,
    steps: value.steps,
    attempts: value.attempts,
    reviews: value.reviews,
  })}`
const project = (value: Row) => {
  const requirement = value.requirement as Row
  const template = value.template as Row
  const projected: Row = {
    schemaVersion: 1,
    requirementPublicId: String(requirement.id),
    state: String(requirement.state),
    revision: Number(requirement.revision),
    template: { version: String(template.version), hash: String(template.hash) },
    steps: ((value.steps as Row[]) ?? []).map((entry) => ({
      publicId: String(entry.id),
      sequence: Number(entry.sequence),
      code: String(entry.code),
      label: String(entry.label),
      instruction: String(entry.instruction),
      type: String(entry.type),
      required: entry.required === true,
      minimum: entry.minimum == null ? null : String(entry.minimum),
      maximum: entry.maximum == null ? null : String(entry.maximum),
      uom: entry.uom == null ? null : String(entry.uom),
      photoMimeTypes: Array.isArray(entry.photoMimeTypes) ? entry.photoMimeTypes.map(String) : [],
      photoMaxBytes: entry.photoMaxBytes == null ? null : Number(entry.photoMaxBytes),
    })),
    attempts: ((value.attempts as Row[]) ?? []).map((entry) => ({
      publicId: String(entry.id),
      sequence: Number(entry.sequence),
      outcome: String(entry.outcome),
      submittedAt: String(entry.submittedAt),
    })),
    reviews: ((value.reviews as Row[]) ?? []).map((entry) => ({
      publicId: String(entry.id),
      outcome: String(entry.outcome),
      decidedAt: String(entry.decidedAt),
    })),
  }
  const expectedCheckVersion = versionOf(projected)
  delete projected.revision
  return { ...projected, expectedCheckVersion }
}
const notFound = (ctx: ServeContext, url: URL, req: Req) => ({
  status: 404,
  error: channelError(ctx, url, req, 'quality_staff_channel.notFound', {
    messageKey: 'quality_staff_channel.error.notFound',
  }),
})
const conflict = (ctx: ServeContext, url: URL, req: Req) => ({
  status: 409,
  error: channelError(ctx, url, req, 'quality_staff_channel.versionConflict', {
    messageKey: 'quality_staff_channel.error.versionConflict',
    retryable: true,
  }),
})
const domainFailure = (ctx: ServeContext, url: URL, req: Req, result: Row) => {
  const errors = Array.isArray(result.errors) ? (result.errors as Row[]) : []
  const stale = errors.some((entry) => String(entry.field) === 'expectedRevision')
  return stale
    ? conflict(ctx, url, req)
    : {
        status: 422,
        error: channelError(ctx, url, req, 'quality_staff_channel.invalidRequest', {
          messageKey: 'quality_staff_channel.error.invalidRequest',
        }),
      }
}

export const channelRoutes = routesOf(
  defineChannelRoute({
    profile: 'staff',
    method: 'GET',
    path: 'quality/checks/{id}',
    operationId: 'staff.quality.checks.get',
    summary: 'Read one canonical quality requirement and its immutable inspection template.',
    auth: 'required',
    capability: { key: 'quality.checks', action: 'read' },
    request: { params: idParams },
    responses: { '200': envelope(checkSchema), '404': envelope({ type: 'null' }) },
    handler: async (ctx, url, req, params) => {
      const found = (await ctx.call('quality.getCheck', { id: params.id }, url, req)) as Row | null
      if (!found) return notFound(ctx, url, req)
      const data = project(found)
      return { data, headers: { etag: `"${data.expectedCheckVersion}"` } }
    },
  }),
  defineChannelRoute({
    profile: 'staff',
    method: 'POST',
    path: 'quality/checks/{id}/photos',
    operationId: 'staff.quality.checks.uploadPhoto',
    summary: 'Store one bounded quality photograph against fresh check evidence.',
    auth: 'required',
    capability: { key: 'quality.checks', action: 'upload' },
    request: { params: idParams, body: photoBody },
    responses: {
      '200': envelope(photoResponse),
      '404': envelope({ type: 'null' }),
      '409': envelope({ type: 'null' }),
      '422': envelope({ type: 'null' }),
    },
    idempotent: true,
    rateLimit: { action: 'staff.quality.checks.uploadPhoto', limit: 30, windowMs: 60_000 },
    handler: async (ctx, url, req, params, request) => {
      const key = idempotencyKey(ctx, url, req)
      if (typeof key !== 'string') return key
      const before = (await ctx.call('quality.getCheck', { id: params.id }, url, req)) as Row | null
      if (!before) return notFound(ctx, url, req)
      // The upload id is the content's own identity, so a photo already carrying
      // it is this request arriving twice. Uploading moved the check version, so
      // without this the retry is told its own upload conflicted — the domain
      // function already answers a replay, and the precondition never let it.
      const replayId = `qpu_${sha256(`${params.id}\0${String(request.body.stepPublicId)}\0${String(request.body.checksum)}`).slice(0, 40)}`
      const replayedUpload = ((before.photos as Row[]) ?? []).find((photo) => photo.id === replayId)
      if (replayedUpload) {
        const held = project(before).expectedCheckVersion
        return {
          data: {
            schemaVersion: 1,
            requirementPublicId: params.id,
            stepPublicId: String(replayedUpload.stepId),
            uploadPublicId: String(replayedUpload.id),
            checksum: String(replayedUpload.checksum),
            mimeType: String(replayedUpload.mimeType),
            byteCount: Number(replayedUpload.byteCount),
            expectedCheckVersion: held,
          },
          headers: { etag: `"${held}"` },
        }
      }
      const expected = requestVersion(req, request.body)
      if (!expected || expected !== project(before).expectedCheckVersion) return conflict(ctx, url, req)
      let content: Buffer
      try {
        content = Buffer.from(String(request.body.contentBase64), 'base64')
      } catch {
        content = Buffer.alloc(0)
      }
      const canonicalBase64 = content.toString('base64').replace(/=+$/u, '')
      if (
        !content.length ||
        canonicalBase64 !== String(request.body.contentBase64).replace(/=+$/u, '') ||
        createHash('sha256').update(content).digest('hex') !== request.body.checksum
      )
        return domainFailure(ctx, url, req, { errors: [{ field: 'contentBase64' }] })
      const step = ((before.steps as Row[]) ?? []).find((entry) => entry.id === request.body.stepPublicId)
      const mimeTypes = Array.isArray(step?.photoMimeTypes) ? step.photoMimeTypes.map(String) : []
      if (
        step?.type !== 'photo' ||
        !mimeTypes.includes(String(request.body.mimeType)) ||
        content.length > Number(step.photoMaxBytes ?? 0)
      )
        return domainFailure(ctx, url, req, { errors: [{ field: 'stepPublicId' }] })
      const uploadId = `qpu_${sha256(`${params.id}\0${String(request.body.stepPublicId)}\0${String(request.body.checksum)}`).slice(0, 40)}`
      const storeKey = `quality/${params.id}/${uploadId}`
      const storage = await ctx.storageOf(url, req)
      await storage.put(
        storeKey,
        (async function* () {
          yield content
        })(),
        { size: content.length, type: String(request.body.mimeType) },
      )
      const result = (await ctx.call(
        'quality.uploadPhoto',
        {
          requirementId: params.id,
          warehouseId: request.body.warehouseId,
          stepId: request.body.stepPublicId,
          expectedRevision: Number((before.requirement as Row).revision),
          mimeType: request.body.mimeType,
          checksum: request.body.checksum,
          altText: request.body.altText,
          byteCount: content.length,
          storeKey,
        },
        url,
        req,
        {
          idempotencyKey: key,
          idempotencyNamespace: `staff:${String(request.identity!.companyId)}:${request.identity!.userId}:quality.photo`,
        },
      )) as Row
      if (result.ok !== true) {
        const current = (await ctx.call('quality.getCheck', { id: params.id }, url, req)) as Row | null
        const referenced = ((current?.photos as Row[]) ?? []).some((photo) => photo.storeKey === storeKey)
        if (!referenced) await storage.remove(storeKey).catch(() => {})
        return domainFailure(ctx, url, req, result)
      }
      const after = (await ctx.call('quality.getCheck', { id: params.id }, url, req)) as Row
      const checkVersion = project(after).expectedCheckVersion
      const upload = result.upload as Row
      return {
        data: {
          schemaVersion: 1,
          requirementPublicId: params.id,
          stepPublicId: String(upload.stepId),
          uploadPublicId: String(upload.id),
          checksum: String(upload.checksum),
          mimeType: String(upload.mimeType),
          byteCount: Number(upload.byteCount),
          expectedCheckVersion: checkVersion,
        },
        headers: { etag: `"${checkVersion}"` },
      }
    },
  }),
  defineChannelRoute({
    profile: 'staff',
    method: 'POST',
    path: 'quality/checks/{id}/submit',
    operationId: 'staff.quality.checks.submit',
    summary: 'Submit one complete inspection attempt against the canonical template and uploads.',
    auth: 'required',
    capability: { key: 'quality.checks', action: 'submit' },
    request: { params: idParams, body: submitBody },
    responses: {
      '200': envelope(submitResponse),
      '404': envelope({ type: 'null' }),
      '409': envelope({ type: 'null' }),
      '422': envelope({ type: 'null' }),
    },
    idempotent: true,
    rateLimit: { action: 'staff.quality.checks.submit', limit: 30, windowMs: 60_000 },
    handler: async (ctx, url, req, params, request) => {
      const key = idempotencyKey(ctx, url, req)
      if (typeof key !== 'string') return key
      const before = (await ctx.call('quality.getCheck', { id: params.id }, url, req)) as Row | null
      if (!before) return notFound(ctx, url, req)
      // Submitting moves the check version, so a replay of this POST carries an
      // `expectedVersion` that is by then stale. Refusing it 409 tells a caller
      // its own successful submission conflicted, and leaves it unable to tell
      // that from a real conflict. The command is recognised by its key first.
      const namespace = `staff:${String(request.identity!.companyId)}:${request.identity!.userId}:quality.submit`
      const attemptId = `qat_${sha256(`${namespace}\n${params.id}\n${key}`).slice(0, 40)}`
      const replayed = ((before.attempts as Row[]) ?? []).find((entry) => entry.id === attemptId)
      if (replayed) {
        const held = project(before).expectedCheckVersion
        return {
          data: {
            schemaVersion: 1,
            requirementPublicId: params.id,
            state: String((before.requirement as Row).state),
            checkVersion: held,
            attempt: {
              publicId: String(replayed.id),
              outcome: String(replayed.outcome),
              submittedAt: String(replayed.submittedAt),
            },
          },
          headers: { etag: `"${held}"` },
        }
      }
      const expected = requestVersion(req, request.body)
      if (!expected || expected !== project(before).expectedCheckVersion) return conflict(ctx, url, req)
      const result = (await ctx.call(
        'quality.submit',
        {
          id: attemptId,
          requirementId: params.id,
          warehouseId: request.body.warehouseId,
          expectedRevision: Number((before.requirement as Row).revision),
          results: request.body.results,
          userId: request.identity!.userId,
        },
        url,
        req,
        {
          idempotencyKey: key,
          idempotencyNamespace: namespace,
        },
      )) as Row
      if (result.ok !== true) return domainFailure(ctx, url, req, result)
      const after = (await ctx.call('quality.getCheck', { id: params.id }, url, req)) as Row
      const checkVersion = project(after).expectedCheckVersion
      const attempt = result.attempt as Row
      return {
        data: {
          schemaVersion: 1,
          requirementPublicId: params.id,
          state: String(result.state),
          checkVersion,
          attempt: {
            publicId: String(attempt.id),
            outcome: String(attempt.outcome),
            submittedAt: String(attempt.submittedAt),
          },
        },
        headers: { etag: `"${checkVersion}"` },
      }
    },
  }),
)
