import type { Route, ServeContext } from '@ketvietlab/ketjs'
import {
  canonicalDecimalText,
  minorText,
  moneyMinor,
  roundedQuotient,
  scaleOf,
  sumMoneyMinor,
} from '../account/money.ts'
import { defineChannelRoute, routesOf, sha256 } from '../channel_api/core.ts'

type Req = Parameters<Route>[1]
type Row = Record<string, unknown>
type PeriodKey = 'today' | 'yesterday' | 'this_week' | 'this_month' | 'last_month'

const PERIODS = ['today', 'yesterday', 'this_week', 'this_month', 'last_month'] as const
const envelope = (data: unknown) => ({
  type: 'object',
  properties: { data, error: {}, meta: { type: 'object' } },
})
const money = (currency: string, amount: bigint, scale: number) => ({
  currency,
  amount: canonicalDecimalText(minorText(amount, scale)),
})
const startOfDay = (date: Date) =>
  new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
const addDays = (date: Date, days: number) => new Date(date.getTime() + days * 86_400_000)
const addMonths = (date: Date, months: number) =>
  new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1))

const rangeOf = (key: PeriodKey, clock = new Date()) => {
  const today = startOfDay(clock)
  let start: Date
  let end: Date
  if (key === 'today') {
    start = today
    end = addDays(today, 1)
  } else if (key === 'yesterday') {
    start = addDays(today, -1)
    end = today
  } else if (key === 'this_week') {
    const mondayOffset = (today.getUTCDay() + 6) % 7
    start = addDays(today, -mondayOffset)
    end = addDays(start, 7)
  } else if (key === 'this_month') {
    start = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1))
    end = addMonths(start, 1)
  } else {
    end = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1))
    start = addMonths(end, -1)
  }
  const duration = end.getTime() - start.getTime()
  return {
    key,
    timezone: 'UTC',
    start,
    end,
    comparisonStart: new Date(start.getTime() - duration),
    comparisonEnd: start,
    bucket: key === 'today' || key === 'yesterday' ? ('hour' as const) : ('day' as const),
  }
}

const dateOf = (value: unknown): Date | null => {
  if (!value) return null
  const raw = String(value)
  const date = new Date(/^\d{4}-\d{2}-\d{2}$/u.test(raw) ? `${raw}T00:00:00.000Z` : raw)
  return Number.isFinite(date.getTime()) ? date : null
}
const within = (value: unknown, start: Date, end: Date) => {
  const date = dateOf(value)
  return Boolean(date && date >= start && date < end)
}
const total = (rows: Row[], field: string, scale: number) =>
  sumMoneyMinor(
    rows.map((row) => row[field] ?? '0'),
    scale,
  )
const change = (current: bigint, previous: bigint) => {
  if (current === 0n && previous === 0n) return { kind: 'unchanged', percent: '0' }
  if (previous === 0n) return { kind: 'new_activity' }
  const difference = current - previous
  const magnitude = difference < 0n ? -difference : difference
  const basis = previous < 0n ? -previous : previous
  const percent = canonicalDecimalText(minorText(roundedQuotient(magnitude * 10_000n, basis), 2))
  return { kind: current > previous ? 'increase' : current < previous ? 'decrease' : 'unchanged', percent }
}
const countChange = (current: number, previous: number) => change(BigInt(current), BigInt(previous))
const comparison = (currency: string, scale: number, current: bigint, previous: bigint) => ({
  current: money(currency, current, scale),
  previous: money(currency, previous, scale),
  change: change(current, previous),
})

const dateTime = { type: 'string', format: 'date-time' }
const nonNegativeInteger = { type: 'integer', minimum: 0 }
const moneySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    currency: { type: 'string', pattern: '^[A-Z0-9]{3,8}$' },
    amount: { type: 'string', pattern: '^-?\\d+(?:\\.\\d+)?$' },
  },
  required: ['currency', 'amount'],
}
const changeSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    kind: { type: 'string', enum: ['increase', 'decrease', 'unchanged', 'new_activity'] },
    percent: { type: 'string', pattern: '^\\d+(?:\\.\\d+)?$' },
  },
  required: ['kind'],
}
const moneyComparisonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: { current: moneySchema, previous: moneySchema, change: changeSchema },
  required: ['current', 'previous', 'change'],
}
const businessOverviewSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    generatedAt: dateTime,
    company: {
      type: 'object',
      additionalProperties: false,
      properties: {
        name: { type: 'string' },
        currency: { type: 'string', pattern: '^[A-Z0-9]{3,8}$' },
      },
      required: ['name', 'currency'],
    },
    period: {
      type: 'object',
      additionalProperties: false,
      properties: {
        key: { type: 'string', enum: [...PERIODS] },
        timezone: { type: 'string' },
        startAt: dateTime,
        endAt: dateTime,
        comparisonStartAt: dateTime,
        comparisonEndAt: dateTime,
        bucket: { type: 'string', enum: ['hour', 'day'] },
      },
      required: ['key', 'timezone', 'startAt', 'endAt', 'comparisonStartAt', 'comparisonEndAt', 'bucket'],
    },
    kpis: {
      type: 'object',
      additionalProperties: false,
      properties: {
        confirmedOrderValue: moneyComparisonSchema,
        invoicedRevenue: moneyComparisonSchema,
        receivables: {
          type: 'object',
          additionalProperties: false,
          properties: { value: moneySchema, asOf: dateTime },
          required: ['value', 'asOf'],
        },
        orderCount: {
          type: 'object',
          additionalProperties: false,
          properties: { current: nonNegativeInteger, previous: nonNegativeInteger, change: changeSchema },
          required: ['current', 'previous', 'change'],
        },
        averageOrderValue: moneyComparisonSchema,
      },
      required: ['confirmedOrderValue', 'invoicedRevenue', 'receivables', 'orderCount', 'averageOrderValue'],
    },
    trend: {
      type: 'array',
      minItems: 1,
      maxItems: 31,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: { startAt: dateTime, confirmedOrderValue: moneySchema, invoicedRevenue: moneySchema },
        required: ['startAt', 'confirmedOrderValue', 'invoicedRevenue'],
      },
    },
    pipeline: {
      type: 'array',
      minItems: 4,
      maxItems: 4,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          state: { type: 'string', enum: ['draft', 'sent', 'confirmed', 'cancelled'] },
          count: nonNegativeInteger,
          value: moneySchema,
        },
        required: ['state', 'count', 'value'],
      },
    },
    operations: {
      type: 'object',
      additionalProperties: false,
      properties: { pendingOutboundPickings: nonNegativeInteger, activeDeliveries: nonNegativeInteger },
      required: ['pendingOutboundPickings', 'activeDeliveries'],
    },
    topCustomers: {
      type: 'array',
      maxItems: 5,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          reference: { type: 'string', pattern: '^customer_[0-9a-f]{64}$' },
          displayName: { type: 'string' },
          orderCount: { type: 'integer', minimum: 1 },
          value: moneySchema,
        },
        required: ['reference', 'displayName', 'orderCount', 'value'],
      },
    },
    recentOrders: {
      type: 'array',
      maxItems: 5,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          customerName: { type: 'string' },
          state: { type: 'string', enum: ['draft', 'sent', 'confirmed'] },
          orderedAt: dateTime,
          value: moneySchema,
        },
        required: ['id', 'name', 'customerName', 'state', 'orderedAt', 'value'],
      },
    },
    drilldowns: {
      type: 'object',
      additionalProperties: false,
      properties: {
        salesOrders: { type: 'boolean' },
        invoices: { type: 'boolean' },
        customers: { type: 'boolean' },
      },
      required: ['salesOrders', 'invoices', 'customers'],
    },
  },
  required: [
    'generatedAt',
    'company',
    'period',
    'kpis',
    'trend',
    'pipeline',
    'operations',
    'topCustomers',
    'recentOrders',
    'drilldowns',
  ],
}

/**
 * Pages until the source runs out — so what it is asked for has to be bounded.
 *
 * The loop stops at a hundred thousand rows and says nothing, which for a
 * revenue figure is the worst way to be wrong: the number simply comes back
 * smaller, with no marker that anything was dropped. The defence is not a larger
 * ceiling, it is asking only for the window being reported on; `sale.listOrders`
 * carries a comment about a tenant with an imported history handing the whole
 * table to every caller, and paging it out row by row is the same read wearing a
 * loop.
 */
const pages = async (ctx: ServeContext, url: URL, req: Req, name: string, input: Row, pageSize = 2_000) => {
  const rows: Row[] = []
  for (let offset = 0; offset < 100_000; offset += pageSize) {
    const page = (await ctx.call(name, { ...input, limit: pageSize, offset }, url, req)) as Row[]
    rows.push(...page)
    if (page.length < pageSize) return rows
  }
  throw new Error(`${name} exceeded the report's row ceiling; the totals would be silently short`)
}

const bucketStart = (date: Date, bucket: 'hour' | 'day') =>
  bucket === 'hour'
    ? new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), date.getUTCHours()))
    : startOfDay(date)

export const channelRoutes = routesOf(
  defineChannelRoute({
    profile: 'staff',
    method: 'GET',
    path: 'reports/business-overview',
    operationId: 'staff.reports.businessOverview',
    summary: 'Read one bounded cross-domain business snapshot for the selected period.',
    auth: 'required',
    capability: { key: 'reports.business', action: 'read' },
    request: {
      query: {
        type: 'object',
        additionalProperties: false,
        properties: { period: { type: 'string', enum: [...PERIODS] } },
      },
    },
    responses: { '200': envelope(businessOverviewSchema) },
    handler: async (ctx, url, req, _params, request) => {
      const selected = url.searchParams.get('period')
      const key = (PERIODS.includes(selected as PeriodKey) ? selected : 'this_month') as PeriodKey
      const period = rangeOf(key)
      const companyId = String(request.identity!.companyId)
      const [company, orders, invoices, openItems, pickings] = (await Promise.all([
        ctx.call('company.getCompany', { id: companyId }, url, req),
        // Both windows the answer compares, and nothing in front of them.
        pages(ctx, url, req, 'sale.listOrders', {
          dateFrom: period.comparisonStart.toISOString(),
          dateTo: period.end.toISOString(),
        }),
        pages(ctx, url, req, 'account.listMoves', {
          moveTypes: ['out_invoice', 'out_refund'],
          state: 'posted',
          order: 'desc',
          dateFrom: period.comparisonStart.toISOString().slice(0, 10),
          dateTo: period.end.toISOString().slice(0, 10),
        }),
        pages(ctx, url, req, 'account.listOpenItems', {}, 500),
        ctx.call('stock.listPickingViews', { limit: 101, offset: 0 }, url, req),
      ])) as [Row, Row[], Row[], Row[], Row[]]
      const currency = String(company.currency)
      const scale = scaleOf(currency)
      const confirmed = orders.filter((row) => row.state === 'sale')
      const currentOrders = confirmed.filter((row) => within(row.dateOrder, period.start, period.end))
      const previousOrders = confirmed.filter((row) =>
        within(row.dateOrder, period.comparisonStart, period.comparisonEnd),
      )
      const currentInvoices = invoices.filter((row) => within(row.date, period.start, period.end))
      const previousInvoices = invoices.filter((row) =>
        within(row.date, period.comparisonStart, period.comparisonEnd),
      )
      const invoiceValue = (rows: Row[]) =>
        rows.reduce(
          (sum, row) =>
            sum + moneyMinor(row.amountTotal ?? '0', scale) * (row.moveType === 'out_refund' ? -1n : 1n),
          0n,
        )
      const currentOrderValue = total(currentOrders, 'amountTotal', scale)
      const previousOrderValue = total(previousOrders, 'amountTotal', scale)
      const currentInvoiceValue = invoiceValue(currentInvoices)
      const previousInvoiceValue = invoiceValue(previousInvoices)
      const partnerIds = [...new Set(currentOrders.map((row) => String(row.partnerId)).filter(Boolean))]
      const partners = partnerIds.length
        ? ((await ctx.call(
            'partner.listPartners',
            { ids: partnerIds, includeArchived: true },
            url,
            req,
          )) as Row[])
        : []
      const partnerNames = new Map(partners.map((row) => [String(row.id), String(row.name)]))
      const customerTotals = new Map<string, { count: number; value: bigint }>()
      for (const order of currentOrders) {
        const id = String(order.partnerId)
        const held = customerTotals.get(id) ?? { count: 0, value: 0n }
        held.count += 1
        held.value += moneyMinor(order.amountTotal ?? '0', scale)
        customerTotals.set(id, held)
      }
      const trend = new Map<string, { confirmed: bigint; invoiced: bigint }>()
      const bucketMs = period.bucket === 'hour' ? 3_600_000 : 86_400_000
      for (let at = period.start.getTime(); at < period.end.getTime(); at += bucketMs)
        trend.set(new Date(at).toISOString(), { confirmed: 0n, invoiced: 0n })
      const addTrend = (value: unknown, field: 'confirmed' | 'invoiced', amount: bigint) => {
        const date = dateOf(value)
        if (!date) return
        const start = bucketStart(date, period.bucket).toISOString()
        const held = trend.get(start) ?? { confirmed: 0n, invoiced: 0n }
        held[field] += amount
        trend.set(start, held)
      }
      for (const order of currentOrders)
        addTrend(order.dateOrder, 'confirmed', moneyMinor(order.amountTotal ?? '0', scale))
      for (const invoice of currentInvoices)
        addTrend(
          invoice.date,
          'invoiced',
          moneyMinor(invoice.amountTotal ?? '0', scale) * (invoice.moveType === 'out_refund' ? -1n : 1n),
        )
      const pipelineStates = [
        ['draft', 'draft'],
        ['sent', 'sent'],
        ['confirmed', 'sale'],
        ['cancelled', 'cancel'],
      ] as const
      const availableRoutes = Object.values((await ctx.live(req)).routes)
      const hasCapability = (capability: string) =>
        availableRoutes.some(
          (entry) =>
            entry.contract?.profile === 'staff' &&
            entry.contract.capability?.key === capability &&
            entry.contract.capability.action === 'read',
        )
      return {
        data: {
          generatedAt: new Date().toISOString(),
          company: { name: String(company.name), currency },
          period: {
            key: period.key,
            timezone: period.timezone,
            startAt: period.start.toISOString(),
            endAt: period.end.toISOString(),
            comparisonStartAt: period.comparisonStart.toISOString(),
            comparisonEndAt: period.comparisonEnd.toISOString(),
            bucket: period.bucket,
          },
          kpis: {
            confirmedOrderValue: comparison(currency, scale, currentOrderValue, previousOrderValue),
            invoicedRevenue: comparison(currency, scale, currentInvoiceValue, previousInvoiceValue),
            receivables: {
              value: money(currency, total(openItems, 'amountResidual', scale), scale),
              asOf: new Date().toISOString(),
            },
            orderCount: {
              current: currentOrders.length,
              previous: previousOrders.length,
              change: countChange(currentOrders.length, previousOrders.length),
            },
            averageOrderValue: comparison(
              currency,
              scale,
              currentOrders.length ? roundedQuotient(currentOrderValue, BigInt(currentOrders.length)) : 0n,
              previousOrders.length ? roundedQuotient(previousOrderValue, BigInt(previousOrders.length)) : 0n,
            ),
          },
          trend: [...trend.entries()]
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([startAt, held]) => ({
              startAt,
              confirmedOrderValue: money(currency, held.confirmed, scale),
              invoicedRevenue: money(currency, held.invoiced, scale),
            })),
          pipeline: pipelineStates.map(([state, source]) => {
            const rows = orders.filter((row) => row.state === source)
            return {
              state,
              count: rows.length,
              value: money(currency, total(rows, 'amountTotal', scale), scale),
            }
          }),
          operations: {
            pendingOutboundPickings: pickings.filter(
              (row) =>
                String((row.pickingType as Row | null)?.code) === 'outgoing' &&
                !['done', 'cancel'].includes(String(row.state)),
            ).length,
            // Delivery is intentionally a private integration. The standard report
            // does not guess its state from stock rows.
            activeDeliveries: 0,
          },
          topCustomers: [...customerTotals.entries()]
            .sort(([, left], [, right]) =>
              right.value === left.value ? right.count - left.count : right.value > left.value ? 1 : -1,
            )
            .slice(0, 5)
            .map(([id, held]) => ({
              reference: `customer_${sha256(`${companyId}\0${id}`)}`,
              displayName: partnerNames.get(id) ?? 'Customer',
              orderCount: held.count,
              value: money(currency, held.value, scale),
            })),
          recentOrders: currentOrders
            .slice()
            .sort(
              (left, right) =>
                String(right.dateOrder).localeCompare(String(left.dateOrder)) ||
                String(right.id).localeCompare(String(left.id)),
            )
            .slice(0, 5)
            .map((row) => ({
              id: String(row.id),
              name: String(row.name),
              customerName: partnerNames.get(String(row.partnerId)) ?? 'Customer',
              state: 'confirmed',
              orderedAt: dateOf(row.dateOrder)?.toISOString() ?? period.start.toISOString(),
              value: money(currency, moneyMinor(row.amountTotal ?? '0', scale), scale),
            })),
          drilldowns: {
            salesOrders: hasCapability('sales.orders'),
            invoices: hasCapability('accounting.invoices'),
            customers: hasCapability('sales.customers'),
          },
        },
      }
    },
  }),
)
