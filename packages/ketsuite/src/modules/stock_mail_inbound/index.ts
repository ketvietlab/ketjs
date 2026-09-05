import { defineModule, eq, from, KetError } from '@ketvietlab/ketjs'
import type { Ctx, FnSpec } from '@ketvietlab/ketjs'
import { ensureThread } from '../mail/index.ts'
import {
  inboundInput,
  inboundMutationEffects,
  inboundOutput,
  receiveInbound,
  signedInboundRoute,
} from '../mail_inbound/index.ts'
import { jsonValue } from '../mail_transport/index.ts'

const functions: Record<string, FnSpec> = {
  receive: {
    input: inboundInput,
    output: inboundOutput,
    effects: [
      ...inboundMutationEffects,
      'write:mail.Thread',
      'read:stock.PickingType',
      'read:stock.Picking',
      'write:stock.Picking',
    ],
    idempotent: true,
    handler: (ctx: Ctx, args) =>
      ctx.tx((tx) =>
        receiveInbound(
          tx,
          {
            provider: String(args.provider),
            providerEventId: String(args.providerEventId),
            kind: String(args.kind),
            fromAddress: args.fromAddress ? String(args.fromAddress) : undefined,
            recipients: args.recipients,
            subject: args.subject ? String(args.subject) : undefined,
            text: args.text ? String(args.text) : undefined,
            html: args.html ? String(args.html) : undefined,
            references: args.references,
            alias: args.alias ? String(args.alias).toLowerCase() : undefined,
            attachments: args.attachments,
            receivedAt: String(args.receivedAt),
          },
          {
            aliasBridge: 'stock.receipt',
            resolveAlias: async (inner, alias, input) => {
              const defaults = jsonValue<Record<string, unknown>>(alias.defaults, {})
              const pickingTypeId = String(defaults.pickingTypeId ?? '')
              const PT = inner.table('stock.PickingType')
              const type = await inner.db.one(from(PT).where(eq(PT.id, pickingTypeId), eq(PT.active, true)))
              if (!type?.defaultLocationSrcId || !type.defaultLocationDestId)
                throw new KetError({
                  code: 'E_INBOUND_STOCK_DEFAULTS',
                  module: 'stock_mail_inbound',
                  message: 'stock receipt alias needs an active picking type with default locations',
                })
              const id = `inbound:${input.provider}:${input.providerEventId}:picking`
              const P = inner.table('stock.Picking')
              const existing = await inner.db.one(from(P).where(eq(P.id, id)))
              const name =
                String(input.subject ?? '')
                  .replace(/[\r\n]/g, ' ')
                  .trim()
                  .slice(0, 200) || `Email receipt ${input.providerEventId}`
              if (!existing)
                await inner.db.insert('stock.Picking', {
                  id,
                  name,
                  pickingTypeId,
                  locationId: type.defaultLocationSrcId,
                  locationDestId: type.defaultLocationDestId,
                  moveType: 'direct',
                  state: 'draft',
                  scheduledDate: input.receivedAt,
                })
              const thread = await ensureThread(inner, {
                id: `thread:stock.Picking:${id}`,
                resModel: 'stock.Picking',
                resId: id,
                displayName: name,
              })
              return { threadId: String(thread.id), targetId: id }
            },
          },
        ),
      ),
  },
}

export default defineModule({
  name: 'stock_mail_inbound',
  version: '0.1.0',
  depends: ['stock', 'mail_inbound'],
  title: 'Email nhập kho',
  summary: 'Alias tường minh tạo phiếu nhập kho nháp và Chatter từ email đã xác thực.',
  category: 'Kho vận',
  functions,
  routes: {
    '/mail/inbound/stock/{alias}': {
      anonymous: true,
      handler: signedInboundRoute('stock_mail_inbound.receive', (params) => ({
        alias: params.alias?.toLowerCase() ?? '',
      })),
    },
  },
  messages: {
    vi: {
      'app.title': 'Email nhập kho',
      'app.summary': 'Alias tường minh tạo phiếu nhập kho nháp và Chatter từ email đã xác thực.',
      'app.category': 'Kho vận',
    },
    en: {
      'app.title': 'Stock inbound email',
      'app.summary': 'An explicit alias bridge creates a draft receipt and Chatter from verified email.',
      'app.category': 'Inventory',
    },
  },
})

export { functions }
