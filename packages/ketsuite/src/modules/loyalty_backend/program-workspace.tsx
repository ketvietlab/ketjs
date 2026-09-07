import { minorText, multiplyToMinor, scaleOf } from '../account/money.ts'
import { randomUUID } from 'node:crypto'
import { text } from '@ketvietlab/ketjs'
import type { Route, Row, ServeContext, Translator } from '@ketvietlab/ketjs'
import type { TemplateResult } from '@ketvietlab/ketjs-view'
import {
  actionGroup as actions,
  badge,
  dataTable,
  formatMoney,
  inline,
  linkButton,
  ModalSheet,
  modalWorkspace,
  Notice,
  RecordForm,
  RecordPage,
  Section,
  shell,
  stack,
  Surface,
  Tabs,
} from '../../ui/index.ts'
import type { FormField, Frame } from '../../ui/index.ts'
import { readForm, seeOther } from '../backend/forms.ts'
import { adminPage, inLocale } from '../backend/screen.ts'
import { PROGRAM_TYPES } from '../loyalty/types.ts'

const actionGroup = (items: TemplateResult[]) => actions({ actions: items })
const base = '/admin/loyalty/programs'
const bool = (value: unknown) => ['1', 'true', 'on'].includes(String(value))
const value = (row: Row, key: string, fallback: string | number | boolean = '') =>
  (row[key] as string | number | boolean) ?? fallback
const rows = (value: unknown): Row[] => (Array.isArray(value) ? (value as Row[]) : [])
const t = (_: Translator, key: string) => _(`loyalty_backend.design.${key}`)
const label = (_: Translator, key: string) => _(`loyalty_backend.field.${key}`)
const select = (
  _: Translator,
  name: string,
  options: readonly string[],
  current: unknown,
  group = name,
): FormField => ({
  name,
  label: label(_, name),
  type: 'select',
  value: String(current ?? options[0]),
  options: options.map((v) => ({ value: v, label: _(`loyalty_backend.${group}.${v}`) })),
})
const field = (
  _: Translator,
  row: Row,
  key: string,
  fallback: string | number | boolean = '',
  type: FormField['type'] = 'text',
  help?: string,
): FormField => ({
  name: key,
  label: label(_, key),
  value: value(row, key, fallback),
  type,
  ...(help ? { help } : {}),
})
const check = (_: Translator, row: Row, key: string, fallback = true): FormField =>
  field(_, row, key, fallback, 'checkbox')
const many = (_: Translator, key: string, choices: Row[], selected: unknown): FormField => ({
  name: key,
  label: label(_, key),
  type: 'checkbox-group',
  span: 'full',
  options: choices.map((row) => ({
    name: `${key}:${String(row.id)}`,
    value: '1',
    label: String(row.name),
    checked: Array.isArray(selected) && selected.includes(row.id),
  })),
})
const selected = (form: Record<string, string>, key: string) =>
  Object.keys(form)
    .filter((name) => name.startsWith(`${key}:`) && bool(form[name]))
    .map((name) => name.slice(key.length + 1))
const errorsOf = (_: Translator, result: Row) =>
  rows(result.errors).map((error) => _(String(error.code), error.params as Row))
const navigate = (_: Translator, href: string, key: string, primary = false) =>
  linkButton({ label: t(_, key), href, variant: primary ? 'primary' : 'secondary' })
const record = (
  _: Translator,
  frame: Frame,
  title: string,
  body: TemplateResult,
  header: { status?: TemplateResult; actions?: TemplateResult } = {},
) =>
  shell(
    _,
    title,
    <RecordPage
      variant="operational"
      frame={frame}
      title={title}
      body={body}
      status={header.status}
      actions={header.actions}
    />,
    {
      ...frame,
      chrome: null,
      topbar: false,
    },
  )
const note = (_: Translator, key: string) => <Notice title={t(_, key)} message="" tone="info" />
const pathFor = (url: URL, path: string) => inLocale(url, path)
const safePost = (req: Parameters<Route>[1]) => {
  if (!req.headers.origin) return true
  try {
    return new URL(String(req.headers.origin)).host === String(req.headers.host)
  } catch {
    return false
  }
}
const catalog = async (ctx: ServeContext, url: URL, req: Parameters<Route>[1]) => {
  const [templates, pricelists, partners, warehouses] = await Promise.all([
    ctx.call('product.listTemplates', { withVariants: true }, url, req),
    ctx.call('pricing.listPricelists', {}, url, req),
    ctx.call('partner.listPartners', { includeArchived: false }, url, req),
    ctx.call('stock.listWarehouses', {}, url, req),
  ])
  return {
    products: rows(templates)
      .filter((template) => template.active && template.saleOk)
      .flatMap((template) =>
        rows(template.variants)
          .filter((product) => product.active)
          .map(
            (product): Row => ({
              ...product,
              name: `${String(template.name)}${product.defaultCode ? ` · ${String(product.defaultCode)}` : ''}`,
            }),
          ),
      ),
    warehouses: rows(warehouses),
    pricelists: rows(pricelists),
    partners: rows(partners),
  }
}
type Catalog = { products: Row[]; pricelists: Row[]; partners: Row[]; warehouses: Row[] }
const programFields = (_: Translator, program: Row, data: Catalog): FormField[] => [
  { ...field(_, program, 'name'), required: true, span: 'full' },
  field(_, program, 'startDate', String(program.dateFrom ?? '').slice(0, 10), 'date'),
  field(_, program, 'endDate', String(program.dateTo ?? '').slice(0, 10), 'date', t(_, 'calendar')),
  check(_, program, 'availableSale'),
  check(_, program, 'availablePos'),
  many(_, 'pricelistIds', data.pricelists, program.pricelistIds),
  ...(program.programType === 'loyalty'
    ? [
        select(_, 'appliesOn', ['both', 'future'], program.appliesOn ?? 'both'),
        field(_, program, 'pointName', t(_, 'points')),
      ]
    : []),
  ...(program.programType === 'next_order_coupons'
    ? [field(_, program, 'voucherValidityDays', 30, 'number', t(_, 'voucherValidity'))]
    : []),
  {
    name: 'advanced',
    label: t(_, 'advanced'),
    fields: [
      check(_, program, 'limitUsage', false),
      field(_, program, 'maxUsage', '', 'number', t(_, 'usage')),
      check(_, program, 'portalVisible', program.programType === 'loyalty'),
    ],
  },
]
const programValues = (form: Record<string, string>, program: Row): Row => ({
  name: form.name ?? '',
  programType: program.programType,
  ...(program.currency ? { currency: program.currency } : {}),
  startDate: form.startDate || null,
  endDate: form.endDate || null,
  availableSale: bool(form.availableSale),
  availablePos: bool(form.availablePos),
  appliesOn: form.appliesOn ?? 'both',
  pointName: form.pointName || undefined,
  limitUsage: bool(form.limitUsage),
  maxUsage: form.maxUsage ? Number(form.maxUsage) : undefined,
  portalVisible: bool(form.portalVisible),
  pricelistIds: selected(form, 'pricelistIds'),
  voucherValidityDays: Number(form.voucherValidityDays || 30),
})
const ruleFields = (_: Translator, rule: Row, program: Row, data: Catalog): FormField[] => [
  {
    name: 'scope',
    label: t(_, 'scope'),
    type: 'select',
    value: value(
      rule,
      'scope',
      Array.isArray(rule.productIds) && rule.productIds.length ? 'specific' : 'all',
    ),
    options: ['all', 'specific'].map((value) => ({ value, label: t(_, value) })),
  },
  many(_, 'productIds', data.products, rule.productIds),
  field(_, rule, 'minimumQuantity', '1', 'decimal'),
  field(_, rule, 'minimumAmount', '0', 'decimal', t(_, 'threshold')),
  select(_, 'taxMode', ['excl', 'incl'], rule.taxMode),
  ...(program.programType === 'loyalty'
    ? [
        select(_, 'pointMode', ['money', 'order', 'unit'], rule.pointMode ?? 'money'),
        {
          name: 'rate',
          label: t(_, 'rate'),
          type: 'decimal' as const,
          value: value(
            rule,
            'rate',
            rule.pointMode === 'money' && Number(rule.pointAmount) > 0
              ? 1 / Number(rule.pointAmount)
              : value(rule, 'pointAmount', 10000),
          ),
          help: t(_, 'rateHint'),
          required: true,
        },
      ]
    : []),
  ...(program.programType === 'promo_code' ? [{ ...field(_, rule, 'code'), required: true }] : []),
]
const rewardFields = (_: Translator, reward: Row, program: Row, data: Catalog): FormField[] => [
  { ...field(_, reward, 'description'), required: true, span: 'full' },
  ...(reward.rewardType === 'discount'
    ? [
        select(
          _,
          'discountMode',
          program.programType === 'loyalty'
            ? ['percent', 'per_order', 'per_point']
            : ['percent', 'per_order'],
          reward.discountMode,
        ),
        field(_, reward, 'discount', '10', 'decimal', t(_, 'discountUnits')),
        {
          name: 'scope',
          label: t(_, 'scope'),
          type: 'select' as const,
          value: value(reward, 'scope', reward.discountApplicability === 'specific' ? 'specific' : 'all'),
          options: ['all', 'specific'].map((value) => ({ value, label: t(_, value) })),
        },
        many(_, 'productIds', data.products, reward.productIds),
        field(_, reward, 'discountMaximum', '', 'decimal', t(_, 'cap')),
      ]
    : reward.rewardType === 'product'
      ? [
          {
            name: 'rewardProductId',
            label: label(_, 'rewardProductId'),
            type: 'select' as const,
            value: value(reward, 'rewardProductId'),
            options: data.products.map((row) => ({ value: String(row.id), label: String(row.name) })),
            required: true,
          },
          field(_, reward, 'rewardProductQuantity', '1', 'decimal', t(_, 'stock')),
        ]
      : [field(_, reward, 'discountMaximum', '', 'decimal', t(_, 'shipping'))]),
  ...(program.programType === 'loyalty'
    ? [field(_, reward, 'requiredPoints', '10', 'decimal', t(_, 'fixedPoints'))]
    : []),
]
const configure = (
  ctx: ServeContext,
  url: URL,
  req: Parameters<Route>[1],
  program: Row,
  form: Record<string, string>,
  entity: string,
  values: Row,
  entityId?: string,
) =>
  ctx.call(
    'loyalty.program.configure',
    {
      id: program.id,
      expectedVersion: Number(form.version),
      entity,
      ...(entityId ? { entityId } : {}),
      values,
    },
    url,
    req,
  ) as Promise<Row>

export const newProgramRoute =
  (ctx: ServeContext): Route =>
  async (url, req) => {
    if (!['GET', 'POST'].includes(req.method ?? '')) return text('GET or POST', { status: 405 })
    const data = await catalog(ctx, url, req)
    let program: Row = { programType: url.searchParams.get('type') ?? 'loyalty' }
    if (!PROGRAM_TYPES.includes(String(program.programType) as never))
      return text('Invalid program type', { status: 400 })
    let errors: string[] = []
    if (req.method === 'POST') {
      if (!safePost(req)) return text('Forbidden', { status: 403 })
      const form = await readForm(req)
      const id = randomUUID()
      const result = await configure(
        ctx,
        url,
        req,
        { ...program, id },
        { ...form, version: '0' },
        'program',
        programValues(form, program),
      )
      if (result.ok) return seeOther(pathFor(url, `${base}/${id}`))
      errors = errorsOf(ctx.translate(ctx.localeOf(url, req)), result)
      program = { ...program, ...programValues(form, program) }
    }
    return adminPage(ctx, url, req, {
      title: 'loyalty_backend.action.createProgram',
      body: (_, frame) =>
        record(
          _,
          frame,
          _('loyalty_backend.action.createProgram'),
          stack([
            actionGroup(
              PROGRAM_TYPES.map((type) =>
                linkButton({
                  label: _(`loyalty.program.${type}`),
                  href: pathFor(url, `${base}/new?type=${type}`),
                  variant: type === program.programType ? 'primary' : 'secondary',
                }),
              ),
            ),
            note(_, `purpose.${String(program.programType)}`),
            note(_, 'setup'),
            <Surface
              body={
                <RecordForm
                  action={url.pathname + url.search}
                  fields={programFields(_, program, data)}
                  errors={errors}
                  submit={t(_, 'createSetup')}
                  submitVariant="primary"
                  cancelHref={pathFor(url, base)}
                  cancelLabel={t(_, 'back')}
                />
              }
            />,
          ]),
        ),
    })
  }

export const programWorkspaceRoute =
  (ctx: ServeContext): Route =>
  async (url, req, params) => {
    if (!['GET', 'POST'].includes(req.method ?? '')) return text('GET or POST', { status: 405 })
    const program = (await ctx.call('loyalty.program.inspect', { id: params.id }, url, req)) as Row | null
    if (!program) return text('Not found', { status: 404 })
    const data = await catalog(ctx, url, req)
    const canWrite = await ctx.allows('loyalty.program.configure', url, req)
    const canTransition = await ctx.allows('loyalty.program.transition', url, req)
    const path = `${base}/${encodeURIComponent(params.id)}`
    const href = (query = '') => pathFor(url, path + query)
    const tab = url.searchParams.get('tab') ?? 'overview'
    const modal = url.searchParams.get('modal')
    if (modal && !['rule', 'reward', 'activate', 'archive', 'restore'].includes(modal))
      return text('Not found', { status: 404 })
    const entryId = url.searchParams.get('entry') ?? 'new'
    let entry: Row = {
      rewardType:
        program.programType === 'buy_x_get_y'
          ? 'product'
          : (url.searchParams.get('rewardType') ?? 'discount'),
    }
    if (modal === 'rule' || modal === 'reward') {
      if (entryId !== 'new') {
        const found = rows(program[modal === 'rule' ? 'rules' : 'rewards']).find((row) => row.id === entryId)
        if (!found) return text('Not found', { status: 404 })
        entry = found
      }
    }
    let errors: string[] = []
    let preview: Row | null = null
    let submitted: Record<string, string> = {}
    if (req.method === 'POST') {
      if (!safePost(req)) return text('Forbidden', { status: 403 })
      const form = await readForm(req)
      submitted = form
      let result: Row
      if (modal === 'activate' || modal === 'archive' || modal === 'restore')
        result = (await ctx.call(
          'loyalty.program.transition',
          { id: params.id, expectedVersion: Number(form.version), action: modal },
          url,
          req,
        )) as Row
      else if (modal === 'rule' || modal === 'reward') {
        const values: Row =
          form.operation === 'toggle'
            ? { active: !entry.active }
            : modal === 'rule'
              ? {
                  ...form,
                  productIds: selected(form, 'productIds'),
                  pointMode: form.pointMode ?? 'order',
                  pointAmount:
                    form.pointMode === 'money'
                      ? (1 / Number(form.rate)).toFixed(12).replace(/0+$/, '').replace(/\.$/, '')
                      : form.rate || '1',
                  taxMode: form.taxMode ?? 'excl',
                }
              : {
                  ...form,
                  productIds: selected(form, 'productIds'),
                  rewardType: entry.rewardType,
                  discountApplicability: form.scope === 'specific' ? 'specific' : 'order',
                  requiredPoints: form.requiredPoints || '1',
                  discountMaximum: form.discountMaximum || undefined,
                }
        result = await configure(
          ctx,
          url,
          req,
          program,
          form,
          modal,
          values,
          entryId === 'new' ? randomUUID() : entryId,
        )
        entry = { ...entry, ...values, rate: form.rate }
      } else if (tab === 'simulator') {
        const lines = [0, 1, 2, 3, 4]
          .filter((index) => form[`product${index}`])
          .map((index) => ({
            id: String(index),
            productId: form[`product${index}`],
            quantity: Number(form[`quantity${index}`] || 1),
            untaxed: minorText(
              multiplyToMinor(
                [form[`quantity${index}`] || '1', form[`price${index}`] || '0'],
                scaleOf(program.currency),
              ),
              scaleOf(program.currency),
            ),
            total: minorText(
              multiplyToMinor(
                [form[`quantity${index}`] || '1', form[`total${index}`] || form[`price${index}`] || '0'],
                scaleOf(program.currency),
              ),
              scaleOf(program.currency),
            ),
            lineKind: 'product',
          }))
        if (Number(form.shipping) > 0 && lines[0])
          lines.push({
            id: 'shipping',
            productId: lines[0].productId,
            quantity: 1,
            untaxed: form.shipping!,
            total: form.shipping!,
            lineKind: 'shipping',
          })
        result = (await ctx.call(
          'loyalty.program.preview',
          {
            id: params.id,
            expectedVersion: Number(form.version),
            ...(form.availablePoints !== '' ? { availablePoints: form.availablePoints } : {}),
            order: {
              orderId: 'preview',
              orderType: form.channel || 'sale',
              date: form.date || new Date().toISOString(),
              currency: program.currency,
              partnerId: form.partnerId || null,
              warehouseId: form.warehouseId || null,
              pricelistId: form.pricelistId || null,
              codes: form.code ? [form.code] : [],
              lines,
            },
          },
          url,
          req,
        )) as Row
        preview = result
      } else result = await configure(ctx, url, req, program, form, 'program', programValues(form, program))
      if (result.ok && !preview) {
        const target = form.returnTo ? new URL(form.returnTo, url.origin) : null
        return seeOther(
          target?.origin === url.origin && (target.pathname === path || target.pathname === base)
            ? target.pathname + target.search
            : href(`?tab=${modal === 'rule' ? 'rules' : modal === 'reward' ? 'rewards' : tab}`),
        )
      }
      errors = errorsOf(ctx.translate(ctx.localeOf(url, req)), result)
    }
    return adminPage(ctx, url, req, {
      title: 'loyalty_backend.program.detail',
      body: (_, frame) => {
        const version = { version: String(program.configVersion ?? 0) }
        const action = url.pathname + url.search
        const money = ['gift_card', 'ewallet'].includes(String(program.programType))
        const tabs = ['overview', ...(money ? [] : ['rules', 'rewards', 'simulator'])]
        const readiness = rows(program.readiness)
          .map((error) => _(String(error.code)))
          .join(' ')
        const entityTable = (entity: string) =>
          dataTable(_, {
            rows: rows(program[entity === 'rule' ? 'rules' : 'rewards']),
            id: (row) => String(row.id),
            rowHref: (row) => href(`?tab=${tab}&modal=${entity}&entry=${encodeURIComponent(String(row.id))}`),
            rowLink: false,
            columns: [
              {
                key: 'description',
                label: t(_, entity),
                cell: (row) =>
                  entity === 'reward'
                    ? String(row.description)
                    : stack(
                        [
                          inline([`${label(_, 'minimumQuantity')}: ${String(row.minimumQuantity)}`]),
                          inline([
                            `${label(_, 'minimumAmount')}: ${formatMoney(_, row.minimumAmount, program.currency)} · ${_(`loyalty_backend.taxMode.${String(row.taxMode)}`)}`,
                          ]),
                        ],
                        'compact',
                      ),
                priority: 'primary',
              },
              {
                key: 'scope',
                label: t(_, 'scope'),
                cell: (row) =>
                  rows(data.products)
                    .filter((product) => ((row.productIds as unknown[]) ?? []).includes(product.id))
                    .map((product) => product.name)
                    .join(', ') || t(_, 'all'),
              },
              {
                key: 'active',
                label: label(_, 'state'),
                cell: (row) =>
                  badge(t(_, row.active ? 'enabled' : 'disabled'), row.active ? 'positive' : 'neutral'),
              },
            ],
          })
        let body: TemplateResult
        if (tab === 'rules' || tab === 'rewards') {
          const entity = tab === 'rules' ? 'rule' : 'reward'
          body = stack([
            note(
              _,
              tab === 'rules' ? (program.earnSource === 'groups' ? 'groups' : 'rulesAdd') : 'oneReward',
            ),
            ...(canWrite
              ? [actionGroup([navigate(_, href(`?tab=${tab}&modal=${entity}`), `add.${entity}`, true)])]
              : []),
            entityTable(entity),
          ])
        } else if (tab === 'simulator') {
          const fields: FormField[] = [
            ...[0, 1, 2, 3, 4].flatMap((index) => [
              {
                name: `product${index}`,
                label: `${t(_, 'line')} ${index + 1}`,
                type: 'select' as const,
                value: submitted[`product${index}`] ?? '',
                options: [
                  { value: '', label: t(_, 'noProduct') },
                  ...data.products.map((row) => ({ value: String(row.id), label: String(row.name) })),
                ],
              },
              {
                name: `quantity${index}`,
                label: label(_, 'quantity'),
                type: 'decimal' as const,
                value: submitted[`quantity${index}`] ?? '1',
              },
              {
                name: `price${index}`,
                label: t(_, 'untaxedPrice'),
                type: 'decimal' as const,
                value: submitted[`price${index}`] ?? '',
              },
              {
                name: `total${index}`,
                label: t(_, 'taxedPrice'),
                type: 'decimal' as const,
                value: submitted[`total${index}`] ?? '',
              },
            ]),
            {
              name: 'partnerId',
              label: label(_, 'partnerId'),
              type: 'select',
              value: submitted.partnerId ?? '',
              options: [
                { value: '', label: t(_, 'guest') },
                ...data.partners.map((row) => ({ value: String(row.id), label: String(row.name) })),
              ],
            },
            ...(program.programType === 'loyalty'
              ? [field(_, submitted, 'availablePoints', '', 'decimal', t(_, 'balancePreview'))]
              : []),
            field(_, submitted, 'shipping', '', 'decimal'),
            field(_, submitted, 'date', new Date().toISOString().slice(0, 10), 'date'),
            {
              name: 'channel',
              label: label(_, 'channel'),
              type: 'select',
              value: submitted.channel ?? 'sale',
              options: ['sale', 'pos'].map((value) => ({ value, label: value === 'sale' ? 'Sales' : 'POS' })),
            },
            {
              name: 'pricelistId',
              label: label(_, 'pricelistIds'),
              type: 'select',
              value: submitted.pricelistId ?? '',
              options: [
                { value: '', label: t(_, 'none') },
                ...data.pricelists.map((row) => ({ value: String(row.id), label: String(row.name) })),
              ],
            },
            {
              name: 'warehouseId',
              label: label(_, 'warehouseId'),
              type: 'select',
              value: submitted.warehouseId ?? '',
              options: [
                { value: '', label: t(_, 'allWarehouses') },
                ...data.warehouses.map((row) => ({ value: String(row.id), label: String(row.name) })),
              ],
            },
            field(_, submitted, 'code'),
          ]
          body = stack([
            note(_, 'preview'),
            <Surface
              body={
                <RecordForm
                  action={action}
                  fields={[
                    ...fields.filter(
                      (field) =>
                        !/^(product|quantity|price|total)[1-4]$/.test(field.name) &&
                        !['date', 'channel', 'pricelistId', 'warehouseId', 'code'].includes(field.name),
                    ),
                    {
                      name: 'moreLines',
                      label: t(_, 'moreLines'),
                      fields: fields.filter((field) =>
                        /^(product|quantity|price|total)[1-4]$/.test(field.name),
                      ),
                      open: [1, 2, 3, 4].some((index) => Boolean(submitted[`product${index}`])),
                    },
                    {
                      name: 'advanced',
                      label: t(_, 'advanced'),
                      fields: fields.filter((field) =>
                        ['date', 'channel', 'pricelistId', 'warehouseId', 'code'].includes(field.name),
                      ),
                    },
                  ]}
                  hidden={version}
                  errors={errors}
                  submit={t(_, 'calculate')}
                  submitVariant="primary"
                />
              }
            />,
            ...(preview
              ? [
                  <Section
                    title={t(_, 'result')}
                    body={stack(
                      rows(preview.trace).map((trace) => (
                        <Notice
                          title={t(_, `trace.${String(trace.code)}`)}
                          message={[
                            trace.description,
                            trace.quantity == null
                              ? null
                              : `${label(_, 'quantity')}: ${String(trace.quantity)}`,
                            trace.amount == null
                              ? null
                              : `${label(_, 'minimumAmount')}: ${String(trace.amount)}`,
                            trace.earned == null
                              ? null
                              : `${t(_, 'earned')}: ${String(trace.earned)}; ${t(_, 'available')}: ${String(trace.available)}`,
                            trace.requiredPoints == null
                              ? null
                              : `${program.programType === 'loyalty' ? `${t(_, 'cost')}: ${String(trace.requiredPoints)}; ` : ''}${t(_, 'discount')}: ${String(trace.discountAmount)} ${String(program.currency)}`,
                          ]
                            .filter(Boolean)
                            .join(' · ')}
                          tone={
                            [
                              'ruleFailed',
                              'rewardUnavailable',
                              'schedule',
                              'code',
                              'usage',
                              'stopped',
                            ].includes(String(trace.code))
                              ? 'warning'
                              : 'info'
                          }
                        />
                      )),
                    )}
                  />,
                ]
              : []),
          ])
        } else
          body = stack([
            note(_, 'companyScope'),
            ...(program.active ? [note(_, 'saveActive')] : []),
            <Surface
              body={
                <RecordForm
                  saveBeforeNavigation={t(_, 'saveBeforeLeave')}
                  action={href()}
                  submitPlacement={canWrite ? 'inside' : 'external'}
                  fields={programFields(
                    _,
                    req.method === 'POST' && !modal
                      ? { ...program, ...programValues(submitted, program) }
                      : program,
                    data,
                  ).map((field) => ({ ...field, disabled: !canWrite }))}
                  hidden={version}
                  errors={!modal ? errors : []}
                  submit={t(_, 'save')}
                  submitVariant="primary"
                />
              }
            />,
          ])
        const workspace = record(
          _,
          frame,
          String(program.name),
          stack([
            ...(program.phase === 'draft'
              ? [
                  <Notice
                    title={t(_, readiness ? 'notReady' : 'ready')}
                    message={readiness || t(_, 'readyHint')}
                    tone={readiness ? 'warning' : 'info'}
                  />,
                ]
              : []),
            <Tabs
              label={String(program.name)}
              items={tabs.map((id) => ({
                id,
                label: t(_, `tab.${id}`),
                href: href(`?tab=${id}`),
                active: tab === id,
              }))}
            />,
            body,
          ]),
          {
            status: badge(
              _(`loyalty_backend.state.${String(program.state)}`),
              program.state === 'running' ? 'positive' : 'neutral',
            ),
            actions: actionGroup([
              navigate(_, pathFor(url, base), 'back'),
              ...(canTransition
                ? [
                    navigate(
                      _,
                      href(
                        `?modal=${program.phase === 'draft' ? 'activate' : program.active ? 'archive' : 'restore'}`,
                      ),
                      program.phase === 'draft' ? 'activate' : program.active ? 'archive' : 'restore',
                    ),
                  ]
                : []),
            ]),
          },
        )
        if (!modal) return workspace
        if (!canWrite && (modal === 'rule' || modal === 'reward')) {
          return modalWorkspace(
            workspace,
            <ModalSheet
              title={t(_, modal)}
              closeHref={href(`?tab=${tab}`)}
              closeLabel={t(_, 'cancel')}
              body={
                <RecordForm
                  action={action}
                  fields={(modal === 'rule'
                    ? ruleFields(_, entry, program, data)
                    : rewardFields(_, entry, program, data)
                  ).map((field) => ({ ...field, disabled: true }))}
                  submit=""
                  submitVariant="secondary"
                  submitPlacement="external"
                />
              }
            />,
          )
        }
        let content: TemplateResult
        if (modal === 'rule' || modal === 'reward')
          content = stack([
            ...(modal === 'reward' && entryId === 'new' && program.programType !== 'buy_x_get_y'
              ? [
                  actionGroup(
                    ['discount', 'product', 'shipping'].map((type) =>
                      linkButton({
                        label: _(`loyalty.reward.${type}`),
                        href: href(`?tab=rewards&modal=reward&rewardType=${type}`),
                        variant: entry.rewardType === type ? 'primary' : 'secondary',
                      }),
                    ),
                  ),
                ]
              : []),
            <RecordForm
              action={action}
              fields={
                modal === 'rule' ? ruleFields(_, entry, program, data) : rewardFields(_, entry, program, data)
              }
              hidden={version}
              errors={errors}
              submit={t(_, 'save')}
              submitVariant="primary"
            />,
            ...(entryId !== 'new'
              ? [
                  note(_, 'toggleHint'),
                  <RecordForm
                    action={action}
                    fields={[]}
                    hidden={{ ...version, operation: 'toggle' }}
                    submit={t(_, entry.active ? 'disable' : 'enable')}
                    submitVariant="secondary"
                  />,
                ]
              : []),
          ])
        else
          content = stack([
            note(
              _,
              modal === 'activate'
                ? 'activateConfirm'
                : modal === 'archive'
                  ? money
                    ? 'stopMoney'
                    : 'stopPoints'
                  : 'restoreConfirm',
            ),
            <RecordForm
              action={action}
              fields={[]}
              hidden={version}
              errors={errors}
              submit={t(_, modal)}
              submitVariant="primary"
            />,
          ])
        return modalWorkspace(
          workspace,
          <ModalSheet
            title={t(_, modal)}
            closeHref={href(`?tab=${tab}`)}
            closeLabel={t(_, 'cancel')}
            presentation="dialog"
            unsavedPrompt={t(_, 'unsaved')}
            body={content}
          />,
        )
      },
    })
  }
