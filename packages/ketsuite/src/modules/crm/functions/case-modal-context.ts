import { defineFn } from '@ketvietlab/ketjs'
import type { FnSpec, Row } from '@ketvietlab/ketjs'
import { AUTHORIZATION_EFFECTS, effectiveFunctionKeys } from '../../user/authorization.ts'
import { canAssignCase, canEditCase, caseDetail, duplicateCases } from '../operations.ts'
import { CRM_RECORD_MODAL_LABELS } from '../record-modal-labels.ts'
import { caseReadEffects } from './shared.ts'

export const caseModalContextFunctions: Record<string, FnSpec> = {
  'case.modalContext': defineFn({
    input: { id: 'id?', locale: 'text?', kind: 'text?', stageId: 'id?', partnerId: 'id?' },
    effects: [
      ...new Set([
        ...caseReadEffects,
        ...AUTHORIZATION_EFFECTS.filter((effect) => !effect.startsWith('write:')),
        'read:activity.Type',
        'read:activity.Plan',
        'read:stock.Warehouse',
        'read:crm_sale.OpportunityQuotation',
        'read:sale.Order',
        'read:product.Product',
        'read:product.Template',
      ]),
    ],
    handler: async (ctx, args) => {
      const allowed = ctx.actor ? await effectiveFunctionKeys(ctx, ctx.actor) : []
      const can = (fn: string) =>
        Boolean(ctx.manifest.functions[fn]) && (allowed === null || allowed.includes(fn))
      const creating = !args.id
      if (!can(creating ? 'crm.case.save' : 'crm.case.get')) return null
      const record: Row | null = creating
        ? {
            id: '',
            name: '',
            kind: args.kind === 'opportunity' ? 'opportunity' : 'lead',
            stageId: args.stageId ?? '',
            partnerId: args.partnerId ?? '',
            priority: '1',
            terminalState: 'open',
            active: true,
            version: 0,
          }
        : await caseDetail(ctx, String(args.id))
      if (!record) return null
      const editable = creating || (await canEditCase(ctx, record))
      const assignable = creating || (await canAssignCase(ctx, record))
      const permissions = Object.fromEntries(
        [
          'case.save',
          'case.move',
          'case.convertLead',
          'case.markWon',
          'case.markLost',
          'case.merge',
          'case.refreshScore',
          'case.addMessage',
          'case.logInteraction',
          'activity.schedule',
          'activity.complete',
          'activity.cancel',
          'plan.apply',
        ].map((name) => [name, editable && can(`crm.${name}`)]),
      )
      permissions['case.assign'] = assignable && can('crm.case.assign')
      permissions['case.reassign'] = assignable && can('crm.case.reassign')
      permissions.quotation = editable && can('crm_sale.sale.createQuotation')
      permissions.upload = editable && can('storage.createAttachment')
      const stages = (await ctx.db.select('crm.Stage', { active: true })).sort(
        (a, b) => Number(a.sequence) - Number(b.sequence),
      )
      const teams = await ctx.db.select('crm.Team', { active: true })
      const people = await ctx.db.select('user.User', { active: true })
      const members = can('crm.team.member.list')
        ? await ctx.db.select('crm.TeamMember', { active: true })
        : []
      const peopleIds = new Set([...members.map((item) => item.userId), record.assigneeUserId, ctx.actor])
      const users = people
        .filter((item) => can('user.listUsers') || peopleIds.has(item.id))
        .map((item) => ({ id: item.id, name: item.name }))
      let partner: Row | undefined
      if (creating && args.partnerId && can('partner.getPartner')) {
        partner = (await ctx.db.select('partner.Partner', { id: args.partnerId }))[0]
        if (partner)
          Object.assign(record, {
            contactName: partner.kind === 'person' ? partner.name : '',
            email: partner.email ?? '',
            phone: partner.phone ?? '',
            utmSource: 'marketplace',
          })
      }
      const tags = can('crm.tag.list') ? await ctx.db.select('crm.Tag', { active: true }) : []
      const types = can('activity.listTypes') ? await ctx.db.select('activity.Type', { active: true }) : []
      const plans = can('activity.listPlans') ? await ctx.db.select('activity.Plan', { active: true }) : []
      const warehouses = can('stock.listWarehouses')
        ? await ctx.db.select('stock.Warehouse', { active: true })
        : []
      const duplicates =
        !creating && can('crm.case.detectDuplicates')
          ? await duplicateCases(ctx, {
              id: record.id,
              email: record.email,
              phone: record.phone,
              name: record.name,
            })
          : []
      const productUoms: Record<string, string> = {}
      if (permissions.quotation && can('crm_sale.sale.listQuotableProducts')) {
        const templates = new Map(
          (await ctx.db.select('product.Template', { active: true, saleOk: true })).map((row) => [
            row.id,
            row,
          ]),
        )
        for (const product of await ctx.db.select('product.Product', { active: true })) {
          const template = templates.get(product.templateId)
          if (template?.uomId) productUoms[String(product.id)] = String(template.uomId)
        }
      }
      const quotations: Row[] = []
      if (!creating && can('crm_sale.sale.listQuotations')) {
        for (const link of await ctx.db.select('crm_sale.OpportunityQuotation', { caseId: record.id })) {
          const order = (await ctx.db.select('sale.Order', { id: link.salesOrderId }))[0]
          if (order)
            quotations.push({
              id: order.id,
              name: order.name,
              state: order.state,
              amountTotal: order.amountTotal,
              currency: order.currency,
              createdAt: link.createdAt,
            })
        }
      }
      const lang = args.locale === 'en' ? 'en' : 'vi'
      const messages: Record<string, string> = { ...CRM_RECORD_MODAL_LABELS[lang] }
      for (const [key, value] of Object.entries(ctx.manifest.messages?.[lang] ?? {})) {
        if (['crm.', 'crm_backend.', 'backend.relation.'].some((prefix) => key.startsWith(prefix)))
          messages[key] =
            typeof value === 'string' ? value : String(value.other ?? Object.values(value)[0] ?? key)
      }
      return {
        data: {
          record,
          stages,
          teams,
          users,
          tags,
          types,
          plans,
          warehouses,
          duplicates,
          quotations,
          productUoms,
          permissions,
          lang,
          partnerIntent: Boolean(partner),
          partner: partner ? { id: partner.id, name: partner.name } : null,
        },
        messages,
      }
    },
  }),
}
