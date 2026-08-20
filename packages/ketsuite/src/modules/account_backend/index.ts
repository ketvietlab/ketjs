import { randomUUID } from 'node:crypto'
import { defineModule, text } from 'ketjs'
import type { Route, ServeContext } from 'ketjs'
import type { TemplateResult } from 'ketjs-view'
import type { FormField, Frame } from '../../ui/index.ts'
import { backendPage, badge, code, formatMoney } from '../../ui/index.ts'
import { readForm, seeOther } from '../backend/forms.ts'
import { viewerOf } from '../backend/routes.ts'
import {
  ACCOUNT_TYPES,
  JOURNAL_TYPES,
  PARTNER_TYPES,
  PAYMENT_TERM_DELAY_TYPES,
  PAYMENT_TERM_VALUES,
  PAYMENT_TYPES,
  TAX_AMOUNT_TYPES,
  TAX_USES,
} from '../account/functions.ts'
import {
  accountingDashboard,
  entityScreen,
  labelOf,
  movesScreen,
  optionsOf,
  reportScreen,
} from './screens.ts'
import { moveDetailScreen } from './move-detail-screen.tsx'

type AnyRow = Record<string, unknown>
type Translator = ReturnType<ServeContext['translate']>

const frame = async (ctx: ServeContext, url: URL, req: Parameters<Route>[1]): Promise<Frame> => ({
  navigation: req.headers['x-ket-navigation'] === 'fragment-v1',
  viewer: await viewerOf(ctx, url, req),
  menu: await ctx.menu(url, req),
  extras: {
    'nav.items': await ctx.joint(url, req, 'backend:nav.items', { active: url.pathname }),
    'topbar.end': await ctx.joint(url, req, 'backend:topbar.end'),
  },
})

const document = async (
  ctx: ServeContext,
  url: URL,
  req: Parameters<Route>[1],
  title: string,
  body: (lang: string, _: Translator, frame: Frame) => TemplateResult | Promise<TemplateResult>,
  translateTitle = true,
) => {
  const lang = ctx.localeOf(url, req)
  const _ = ctx.translate(lang)
  return backendPage(ctx, req, {
    lang,
    title: translateTitle ? _(title) : title,
    body: await body(lang, _, await frame(ctx, url, req)),
  })
}

const resultRedirect = (result: unknown, ok: string, fail = ok) =>
  (result as { ok?: boolean }).ok
    ? seeOther(ok)
    : seeOther(`${fail}${fail.includes('?') ? '&' : '?'}invalid=1`)

const optional = (form: Record<string, string>, name: string) => (form[name] ? { [name]: form[name] } : {})
const localeSuffix = (url: URL) => {
  const lang = url.searchParams.get('lang')
  return lang ? `?lang=${encodeURIComponent(lang)}` : ''
}
const choices = (rows: AnyRow[], empty = false) => [
  ...(empty ? [{ value: '', label: '—' }] : []),
  ...rows.map((row) => ({
    value: String(row.id),
    label: `${String(row.code ?? '')}${row.code ? ' · ' : ''}${String(row.name)}`,
  })),
]

const currencyOf = (companies: AnyRow[], shell: Frame): unknown =>
  companies.find((company) => company.id === shell.viewer?.company)?.currency

const common = async (ctx: ServeContext, url: URL, req: Parameters<Route>[1]) => {
  const [accounts, journals, taxes, terms, partners, companies, templates, units] = (await Promise.all([
    ctx.call('account.listAccounts', {}, url, req),
    ctx.call('account.listJournals', {}, url, req),
    ctx.call('account.listTaxes', {}, url, req),
    ctx.call('account.listPaymentTerms', {}, url, req),
    ctx.call('partner.listPartners', {}, url, req),
    ctx.call('company.listCompanies', {}, url, req),
    ctx.call('product.listTemplates', { withVariants: true }, url, req),
    ctx.call('uom.listUnits', {}, url, req),
  ])) as [AnyRow[], AnyRow[], AnyRow[], AnyRow[], AnyRow[], AnyRow[], AnyRow[], AnyRow[]]
  const companyPartners = new Set(companies.map((company) => company.partnerId))
  return {
    accounts,
    companies,
    journals,
    taxes,
    terms,
    partners: partners.filter((partner) => !companyPartners.has(partner.id)),
    templates,
    units,
  }
}

const moveFields = (
  _: Translator,
  data: Awaited<ReturnType<typeof common>>,
  types: readonly string[],
): FormField[] => [
  {
    name: 'journalId',
    label: _('account_backend.field.journalId'),
    type: 'select',
    options: choices(data.journals),
    required: true,
  },
  {
    name: 'moveType',
    label: _('account_backend.field.moveType'),
    type: 'select',
    options: optionsOf(_, 'moveType', types),
  },
  { name: 'date', label: _('account_backend.field.date'), type: 'date' },
  { name: 'ref', label: _('account_backend.field.ref') },
  {
    name: 'partnerId',
    label: _('account_backend.field.partnerId'),
    type: 'select',
    options: choices(data.partners, true),
  },
]

const invoiceFields = (
  _: Translator,
  data: Awaited<ReturnType<typeof common>>,
  types: readonly string[],
): FormField[] => {
  const customer = types.every((type) => type.startsWith('out_'))
  const journals = data.journals.filter((journal) => journal.type === (customer ? 'sale' : 'purchase'))
  const lineTypes = customer
    ? ['income', 'income_other']
    : ['expense', 'expense_other', 'expense_depreciation', 'expense_direct_cost']
  const lineAccounts = data.accounts.filter((account) => lineTypes.includes(String(account.accountType)))
  const counterpartAccounts = data.accounts.filter(
    (account) => account.accountType === (customer ? 'asset_receivable' : 'liability_payable'),
  )
  const taxes = data.taxes.filter((tax) => tax.typeTaxUse === (customer ? 'sale' : 'purchase'))
  const variants = data.templates.flatMap((template) =>
    ((template.variants as AnyRow[] | undefined) ?? []).map((variant) => ({
      value: String(variant.id),
      label: `${String(template.name)}${variant.defaultCode ? ` · ${String(variant.defaultCode)}` : ''}`,
    })),
  )
  return [
    {
      name: 'journalId',
      label: _('account_backend.field.journalId'),
      type: 'select',
      options: choices(journals),
      required: true,
    },
    {
      name: 'moveType',
      label: _('account_backend.field.moveType'),
      type: 'select',
      options: optionsOf(_, 'moveType', types),
    },
    {
      name: 'partnerId',
      label: _('account_backend.field.partnerId'),
      type: 'select',
      options: choices(data.partners),
      required: true,
    },
    { name: 'invoiceDate', label: _('account_backend.field.invoiceDate'), type: 'date' },
    {
      name: 'paymentTermId',
      label: _('account_backend.field.paymentTermId'),
      type: 'select',
      options: choices(data.terms, true),
    },
    { name: 'ref', label: _('account_backend.field.ref') },
    { name: 'description', label: _('account_backend.field.description'), required: true },
    {
      name: 'productId',
      label: _('account_backend.field.productId'),
      type: 'select',
      options: [{ value: '', label: '—' }, ...variants],
    },
    {
      name: 'productUomId',
      label: _('account_backend.field.productUomId'),
      type: 'select',
      options: choices(data.units, true),
    },
    {
      name: 'quantity',
      label: _('account_backend.field.quantity'),
      type: 'decimal',
      value: 1,
      required: true,
    },
    {
      name: 'priceUnit',
      label: _('account_backend.field.priceUnit'),
      type: 'decimal',
      value: 0,
      required: true,
    },
    { name: 'discount', label: _('account_backend.field.discount'), type: 'decimal', value: 0 },
    {
      name: 'lineAccountId',
      label: _('account_backend.field.lineAccountId'),
      type: 'select',
      options: choices(lineAccounts),
      required: true,
    },
    {
      name: 'counterpartAccountId',
      label: _('account_backend.field.counterpartAccountId'),
      type: 'select',
      options: choices(counterpartAccounts),
      required: true,
    },
    { name: 'taxId', label: _('account_backend.field.taxId'), type: 'select', options: choices(taxes, true) },
    {
      name: 'taxAccountId',
      label: _('account_backend.field.taxAccountId'),
      type: 'select',
      options: choices(data.accounts, true),
    },
  ]
}

const createInvoice = async (ctx: ServeContext, url: URL, req: Parameters<Route>[1], redirect: string) => {
  const form = await readForm(req)
  const result = await ctx.call(
    'account.createInvoice',
    {
      id: randomUUID(),
      journalId: form.journalId ?? '',
      moveType: form.moveType ?? '',
      partnerId: form.partnerId ?? '',
      ...optional(form, 'invoiceDate'),
      ...optional(form, 'paymentTermId'),
      ...optional(form, 'ref'),
      description: form.description ?? '',
      ...optional(form, 'productId'),
      ...optional(form, 'productUomId'),
      quantity: form.quantity || '1',
      priceUnit: form.priceUnit || '0',
      discount: form.discount || '0',
      lineAccountId: form.lineAccountId ?? '',
      counterpartAccountId: form.counterpartAccountId ?? '',
      ...optional(form, 'taxId'),
      ...optional(form, 'taxAccountId'),
    },
    url,
    req,
  )
  return resultRedirect(result, redirect)
}

const accountMoveRoute =
  (ctx: ServeContext): Route =>
  async (url, req, params) => {
    if (req.method === 'POST') {
      const form = await readForm(req)
      const result =
        form.action === 'post'
          ? await ctx.call('account.postMove', { id: params.id }, url, req)
          : form.action === 'cancel'
            ? await ctx.call('account.cancelMove', { id: params.id }, url, req)
            : await ctx.call(
                'account.addMoveLine',
                {
                  id: randomUUID(),
                  moveId: params.id,
                  name: form.name ?? '',
                  accountId: form.accountId ?? '',
                  ...optional(form, 'partnerId'),
                  debit: form.debit || '0',
                  credit: form.credit || '0',
                },
                url,
                req,
              )
      return resultRedirect(result, `${url.pathname}${localeSuffix(url)}`)
    }
    if (req.method !== 'GET') return text('GET or POST', { status: 405 })
    const [move, accounts] = (await Promise.all([
      ctx.call('account.getMove', { id: params.id }, url, req),
      ctx.call('account.listAccounts', {}, url, req),
    ])) as [AnyRow | null, AnyRow[]]
    if (!move)
      return text(ctx.translate(ctx.localeOf(url, req))('account_backend.move.notFound'), { status: 404 })
    const lang = ctx.localeOf(url, req)
    const collaboration = await ctx.joint(url, req, 'account_backend:move.collaboration', {
      resModel: 'account.Move',
      resId: String(move.id),
      lang,
    })
    return document(
      ctx,
      url,
      req,
      String(move.name),
      (_, tr, shell) =>
        moveDetailScreen(
          tr,
          move,
          (move.lines as AnyRow[]) ?? [],
          shell,
          choices(accounts),
          `${url.pathname}${localeSuffix(url)}`,
          collaboration,
        ),
      false,
    )
  }

const MESSAGES: Record<string, Record<string, string>> = { vi: {}, en: {} }

export default defineModule({
  name: 'account_backend',
  version: '0.1.0',
  depends: ['account', 'backend'],
  install: 'auto',
  app: true,
  joints: {
    'move.collaboration': {
      props: { resModel: 'text', resId: 'id', lang: 'text' },
      multiple: true,
    },
  },
  title: 'Kế toán trong quản trị',
  summary: 'Giao diện sổ cái, hoá đơn, thanh toán và báo cáo.',
  category: 'Tài chính',
  menus: {
    accounting: { label: 'menu.app', icon: 'banknote', sequence: 30 },
    'accounting.dashboard': {
      parent: 'accounting',
      label: 'menu.dashboard',
      path: '/admin/accounting',
      needs: 'account.listMoves',
      sequence: 1,
    },
    'accounting.customers': { parent: 'accounting', label: 'menu.customers', sequence: 10 },
    'accounting.customerInvoices': {
      parent: 'accounting.customers',
      label: 'menu.customerInvoices',
      path: '/admin/customer-invoices',
      needs: 'account.listMoves',
    },
    'accounting.vendors': { parent: 'accounting', label: 'menu.vendors', sequence: 20 },
    'accounting.vendorBills': {
      parent: 'accounting.vendors',
      label: 'menu.vendorBills',
      path: '/admin/vendor-bills',
      needs: 'account.listMoves',
    },
    'accounting.operations': { parent: 'accounting', label: 'menu.operations', sequence: 30 },
    'accounting.entries': {
      parent: 'accounting.operations',
      label: 'menu.entries',
      path: '/admin/journal-entries',
      needs: 'account.listMoves',
    },
    'accounting.payments': {
      parent: 'accounting.operations',
      label: 'menu.payments',
      path: '/admin/payments',
      needs: 'account.listPayments',
    },
    'accounting.reporting': { parent: 'accounting', label: 'menu.reporting', sequence: 40 },
    'accounting.trialBalance': {
      parent: 'accounting.reporting',
      label: 'menu.trialBalance',
      path: '/admin/trial-balance',
      needs: 'account.trialBalance',
    },
    'accounting.generalLedger': {
      parent: 'accounting.reporting',
      label: 'menu.generalLedger',
      path: '/admin/general-ledger',
      needs: 'account.generalLedger',
    },
    'accounting.partnerStatement': {
      parent: 'accounting.reporting',
      label: 'menu.partnerStatement',
      path: '/admin/partner-statement',
      needs: 'account.partnerStatement',
    },
    'accounting.configuration': { parent: 'accounting', label: 'menu.configuration', sequence: 50 },
    'accounting.accounts': {
      parent: 'accounting.configuration',
      label: 'menu.accounts',
      path: '/admin/accounts',
      needs: 'account.listAccounts',
    },
    'accounting.journals': {
      parent: 'accounting.configuration',
      label: 'menu.journals',
      path: '/admin/journals',
      needs: 'account.listJournals',
    },
    'accounting.taxes': {
      parent: 'accounting.configuration',
      label: 'menu.taxes',
      path: '/admin/taxes',
      needs: 'account.listTaxes',
    },
    'accounting.terms': {
      parent: 'accounting.configuration',
      label: 'menu.paymentTerms',
      path: '/admin/payment-terms',
      needs: 'account.listPaymentTerms',
    },
  },
  routes: {
    '/admin/accounting':
      (ctx): Route =>
      async (url, req) => {
        if (req.method !== 'GET') return text('GET', { status: 405 })
        const [accounts, journals, moves] = (await Promise.all([
          ctx.call('account.listAccounts', {}, url, req),
          ctx.call('account.listJournals', {}, url, req),
          ctx.call('account.listMoves', {}, url, req),
        ])) as [AnyRow[], AnyRow[], AnyRow[]]
        return document(ctx, url, req, 'account_backend.dashboard.title', (_, tr, shell) =>
          accountingDashboard(
            tr,
            {
              accounts: accounts.length,
              journals: journals.length,
              draft: moves.filter((move) => move.state === 'draft').length,
              posted: moves.filter((move) => move.state === 'posted').length,
              unpaid: moves.filter((move) => move.paymentState === 'not_paid').length,
            },
            shell,
          ),
        )
      },
    '/admin/accounts':
      (ctx): Route =>
      async (url, req) => {
        if (req.method === 'POST') {
          const form = await readForm(req)
          return resultRedirect(
            await ctx.call(
              'account.saveAccount',
              {
                id: randomUUID(),
                code: form.code ?? '',
                name: form.name ?? '',
                accountType: form.accountType ?? '',
                reconcile: form.reconcile === '1',
                active: true,
              },
              url,
              req,
            ),
            '/admin/accounts',
          )
        }
        if (req.method !== 'GET') return text('GET or POST', { status: 405 })
        const rows = (await ctx.call('account.listAccounts', {}, url, req)) as AnyRow[]
        return document(ctx, url, req, 'account_backend.accounts.title', (_, tr, shell) =>
          entityScreen(tr, {
            title: tr('account_backend.accounts.title'),
            frame: shell,
            action: '/admin/accounts',
            submit: tr('account_backend.action.create'),
            rows,
            fields: [
              { name: 'code', label: tr('account_backend.field.code'), required: true },
              { name: 'name', label: tr('account_backend.field.name'), required: true },
              {
                name: 'accountType',
                label: tr('account_backend.field.accountType'),
                type: 'select',
                options: optionsOf(tr, 'accountType', ACCOUNT_TYPES),
              },
              { name: 'reconcile', label: tr('account_backend.field.reconcile'), type: 'checkbox' },
            ],
            columns: [
              {
                key: 'code',
                label: tr('account_backend.field.code'),
                cell: (row) => code(String(row.code)),
                priority: 'primary',
              },
              { key: 'name', label: tr('account_backend.field.name'), cell: (row) => String(row.name) },
              {
                key: 'type',
                label: tr('account_backend.field.accountType'),
                cell: (row) => labelOf(tr, 'accountType', row.accountType),
              },
              {
                key: 'reconcile',
                label: tr('account_backend.field.reconcile'),
                cell: (row) => (row.reconcile ? tr('account_backend.yes') : tr('account_backend.no')),
              },
            ],
          }),
        )
      },
    '/admin/journals':
      (ctx): Route =>
      async (url, req) => {
        const data = await common(ctx, url, req)
        if (req.method === 'POST') {
          const form = await readForm(req)
          return resultRedirect(
            await ctx.call(
              'account.saveJournal',
              {
                id: randomUUID(),
                name: form.name ?? '',
                code: form.code ?? '',
                type: form.type ?? '',
                ...optional(form, 'defaultAccountId'),
                active: true,
              },
              url,
              req,
            ),
            '/admin/journals',
          )
        }
        if (req.method !== 'GET') return text('GET or POST', { status: 405 })
        return document(ctx, url, req, 'account_backend.journals.title', (_, tr, shell) =>
          entityScreen(tr, {
            title: tr('account_backend.journals.title'),
            frame: shell,
            action: '/admin/journals',
            submit: tr('account_backend.action.create'),
            rows: data.journals,
            fields: [
              { name: 'name', label: tr('account_backend.field.name'), required: true },
              { name: 'code', label: tr('account_backend.field.code'), required: true },
              {
                name: 'type',
                label: tr('account_backend.field.type'),
                type: 'select',
                options: optionsOf(tr, 'journalType', JOURNAL_TYPES),
              },
              {
                name: 'defaultAccountId',
                label: tr('account_backend.field.defaultAccountId'),
                type: 'select',
                options: choices(data.accounts, true),
              },
            ],
            columns: [
              {
                key: 'code',
                label: tr('account_backend.field.code'),
                cell: (row) => code(String(row.code)),
                priority: 'primary',
              },
              { key: 'name', label: tr('account_backend.field.name'), cell: (row) => String(row.name) },
              {
                key: 'type',
                label: tr('account_backend.field.type'),
                cell: (row) => labelOf(tr, 'journalType', row.type),
              },
              {
                key: 'sequence',
                label: tr('account_backend.field.sequence'),
                cell: (row) => String(row.sequenceNumber),
              },
            ],
          }),
        )
      },
    '/admin/taxes':
      (ctx): Route =>
      async (url, req) => {
        const data = await common(ctx, url, req)
        if (req.method === 'POST') {
          const form = await readForm(req)
          return resultRedirect(
            await ctx.call(
              'account.saveTax',
              {
                id: randomUUID(),
                name: form.name ?? '',
                ...optional(form, 'description'),
                typeTaxUse: form.typeTaxUse ?? 'sale',
                ...optional(form, 'taxScope'),
                amountType: form.amountType ?? 'percent',
                amount: form.amount || '0',
                priceInclude: form.priceInclude === '1',
                includeBaseAmount: form.includeBaseAmount === '1',
                sequence: Number(form.sequence || 10),
                active: true,
              },
              url,
              req,
            ),
            '/admin/taxes',
          )
        }
        if (req.method !== 'GET') return text('GET or POST', { status: 405 })
        return document(ctx, url, req, 'account_backend.taxes.title', (_, tr, shell) => {
          const currency = currencyOf(data.companies, shell)
          return entityScreen(tr, {
            title: tr('account_backend.taxes.title'),
            frame: shell,
            action: '/admin/taxes',
            submit: tr('account_backend.action.create'),
            rows: data.taxes,
            fields: [
              { name: 'name', label: tr('account_backend.field.name'), required: true },
              { name: 'description', label: tr('account_backend.field.description') },
              {
                name: 'typeTaxUse',
                label: tr('account_backend.field.typeTaxUse'),
                type: 'select',
                options: optionsOf(tr, 'taxUse', TAX_USES),
              },
              {
                name: 'taxScope',
                label: tr('account_backend.field.taxScope'),
                type: 'select',
                options: [{ value: '', label: '—' }, ...optionsOf(tr, 'taxScope', ['service', 'consu'])],
              },
              {
                name: 'amountType',
                label: tr('account_backend.field.amountType'),
                type: 'select',
                options: optionsOf(tr, 'taxAmountType', TAX_AMOUNT_TYPES),
              },
              {
                name: 'amount',
                label: tr('account_backend.field.amount'),
                type: 'decimal',
                value: 0,
                required: true,
              },
              { name: 'priceInclude', label: tr('account_backend.field.priceInclude'), type: 'checkbox' },
              {
                name: 'includeBaseAmount',
                label: tr('account_backend.field.includeBaseAmount'),
                type: 'checkbox',
              },
              { name: 'sequence', label: tr('account_backend.field.sequence'), type: 'number', value: 10 },
            ],
            columns: [
              {
                key: 'name',
                label: tr('account_backend.field.name'),
                cell: (row) => String(row.name),
                priority: 'primary',
              },
              {
                key: 'use',
                label: tr('account_backend.field.typeTaxUse'),
                cell: (row) => labelOf(tr, 'taxUse', row.typeTaxUse),
              },
              {
                key: 'computation',
                label: tr('account_backend.field.amountType'),
                cell: (row) => labelOf(tr, 'taxAmountType', row.amountType),
              },
              {
                key: 'amount',
                label: tr('account_backend.field.amount'),
                cell: (row) =>
                  row.amountType === 'fixed'
                    ? formatMoney(tr, row.amount, currency)
                    : row.amountType === 'group'
                      ? '—'
                      : `${String(row.amount)}%`,
                align: 'end',
                kind: 'number',
              },
              {
                key: 'included',
                label: tr('account_backend.field.priceInclude'),
                cell: (row) => (row.priceInclude ? tr('account_backend.yes') : tr('account_backend.no')),
              },
            ],
          })
        })
      },
    '/admin/payment-terms':
      (ctx): Route =>
      async (url, req) => {
        if (req.method === 'POST') {
          const form = await readForm(req)
          const result =
            form.action === 'line'
              ? await ctx.call(
                  'account.savePaymentTermLine',
                  {
                    id: randomUUID(),
                    paymentId: form.paymentId ?? '',
                    value: form.value ?? 'percent',
                    valueAmount: form.valueAmount || '100',
                    delayType: form.delayType ?? 'days_after',
                    nbDays: Number(form.nbDays || 0),
                    ...(form.daysNextMonth ? { daysNextMonth: Number(form.daysNextMonth) } : {}),
                    sequence: Number(form.sequence || 10),
                  },
                  url,
                  req,
                )
              : await ctx.call(
                  'account.savePaymentTerm',
                  { id: randomUUID(), name: form.name ?? '', ...optional(form, 'note'), active: true },
                  url,
                  req,
                )
          return resultRedirect(result, '/admin/payment-terms')
        }
        if (req.method !== 'GET') return text('GET or POST', { status: 405 })
        const rows = (await ctx.call('account.listPaymentTerms', {}, url, req)) as AnyRow[]
        return document(ctx, url, req, 'account_backend.terms.title', (_, tr, shell) =>
          entityScreen(tr, {
            title: tr('account_backend.terms.title'),
            frame: shell,
            action: '/admin/payment-terms',
            submit: tr('account_backend.action.createTerm'),
            rows,
            fields: [
              { name: 'name', label: tr('account_backend.field.name'), required: true },
              { name: 'note', label: tr('account_backend.field.note'), type: 'textarea', span: 'full' },
            ],
            extraForms: rows.length
              ? [
                  {
                    action: '/admin/payment-terms',
                    submit: tr('account_backend.action.addTermLine'),
                    hidden: { action: 'line' },
                    fields: [
                      {
                        name: 'paymentId',
                        label: tr('account_backend.field.paymentTermId'),
                        type: 'select',
                        options: choices(rows),
                        required: true,
                      },
                      {
                        name: 'value',
                        label: tr('account_backend.field.termValue'),
                        type: 'select',
                        options: optionsOf(tr, 'paymentTermValue', PAYMENT_TERM_VALUES),
                      },
                      {
                        name: 'valueAmount',
                        label: tr('account_backend.field.valueAmount'),
                        type: 'decimal',
                        value: 100,
                        required: true,
                      },
                      {
                        name: 'delayType',
                        label: tr('account_backend.field.delayType'),
                        type: 'select',
                        options: optionsOf(tr, 'paymentTermDelay', PAYMENT_TERM_DELAY_TYPES),
                      },
                      {
                        name: 'nbDays',
                        label: tr('account_backend.field.nbDays'),
                        type: 'number',
                        value: 0,
                        required: true,
                      },
                      {
                        name: 'daysNextMonth',
                        label: tr('account_backend.field.daysNextMonth'),
                        type: 'number',
                      },
                      {
                        name: 'sequence',
                        label: tr('account_backend.field.sequence'),
                        type: 'number',
                        value: 10,
                      },
                    ],
                  },
                ]
              : [],
            columns: [
              {
                key: 'name',
                label: tr('account_backend.field.name'),
                cell: (row) => String(row.name),
                priority: 'primary',
              },
              {
                key: 'lines',
                label: tr('account_backend.terms.lines'),
                cell: (row) => String(Array.isArray(row.lines) ? row.lines.length : 0),
              },
              {
                key: 'note',
                label: tr('account_backend.field.note'),
                cell: (row) => String(row.note ?? '—'),
              },
            ],
          }),
        )
      },
    '/admin/journal-entries':
      (ctx): Route =>
      async (url, req) => {
        const data = await common(ctx, url, req)
        if (req.method === 'POST') {
          const form = await readForm(req)
          return resultRedirect(
            await ctx.call(
              'account.createMove',
              {
                id: randomUUID(),
                journalId: form.journalId ?? '',
                moveType: form.moveType || 'entry',
                ...optional(form, 'date'),
                ...optional(form, 'ref'),
                ...optional(form, 'partnerId'),
              },
              url,
              req,
            ),
            '/admin/journal-entries',
          )
        }
        if (req.method !== 'GET') return text('GET or POST', { status: 405 })
        const state = url.searchParams.get('state')
        const rows = (await ctx.call(
          'account.listMoves',
          { moveType: 'entry', ...(state ? { state } : {}) },
          url,
          req,
        )) as AnyRow[]
        return document(ctx, url, req, 'account_backend.entries.title', (_, tr, shell) =>
          movesScreen(tr, {
            title: tr('account_backend.entries.title'),
            frame: shell,
            action: '/admin/journal-entries',
            fields: moveFields(tr, data, ['entry']),
            rows,
          }),
        )
      },
    '/admin/customer-invoices':
      (ctx): Route =>
      async (url, req) => {
        const data = await common(ctx, url, req)
        if (req.method === 'POST') return createInvoice(ctx, url, req, '/admin/customer-invoices')
        if (req.method !== 'GET') return text('GET or POST', { status: 405 })
        const all = (await ctx.call('account.listMoves', {}, url, req)) as AnyRow[]
        const rows = all.filter((move) =>
          ['out_invoice', 'out_refund', 'out_receipt'].includes(String(move.moveType)),
        )
        return document(ctx, url, req, 'account_backend.customerInvoices.title', (_, tr, shell) =>
          movesScreen(tr, {
            title: tr('account_backend.customerInvoices.title'),
            frame: shell,
            action: '/admin/customer-invoices',
            fields: invoiceFields(tr, data, ['out_invoice', 'out_refund', 'out_receipt']),
            rows,
          }),
        )
      },
    '/admin/vendor-bills':
      (ctx): Route =>
      async (url, req) => {
        const data = await common(ctx, url, req)
        if (req.method === 'POST') return createInvoice(ctx, url, req, '/admin/vendor-bills')
        if (req.method !== 'GET') return text('GET or POST', { status: 405 })
        const all = (await ctx.call('account.listMoves', {}, url, req)) as AnyRow[]
        const rows = all.filter((move) =>
          ['in_invoice', 'in_refund', 'in_receipt'].includes(String(move.moveType)),
        )
        return document(ctx, url, req, 'account_backend.vendorBills.title', (_, tr, shell) =>
          movesScreen(tr, {
            title: tr('account_backend.vendorBills.title'),
            frame: shell,
            action: '/admin/vendor-bills',
            fields: invoiceFields(tr, data, ['in_invoice', 'in_refund', 'in_receipt']),
            rows,
          }),
        )
      },
    '/admin/journal-entries/{id}': accountMoveRoute,
    '/admin/customer-invoices/{id}': accountMoveRoute,
    '/admin/vendor-bills/{id}': accountMoveRoute,
    '/admin/payments':
      (ctx): Route =>
      async (url, req) => {
        const [data, openItems] = await Promise.all([
          common(ctx, url, req),
          ctx.call('account.listOpenItems', {}, url, req) as Promise<AnyRow[]>,
        ])
        if (req.method === 'POST') {
          const form = await readForm(req)
          return resultRedirect(
            await ctx.call(
              'account.registerPayment',
              {
                id: randomUUID(),
                name: form.name ?? '',
                paymentType: form.paymentType ?? 'inbound',
                partnerType: form.partnerType ?? 'customer',
                ...optional(form, 'partnerId'),
                journalId: form.journalId ?? '',
                destinationAccountId: form.destinationAccountId ?? '',
                amount: form.amount || '0',
                ...optional(form, 'date'),
                ...optional(form, 'memo'),
                ...optional(form, 'paymentReference'),
                ...optional(form, 'reconcileLineId'),
              },
              url,
              req,
            ),
            '/admin/payments',
          )
        }
        if (req.method !== 'GET') return text('GET or POST', { status: 405 })
        const rows = (await ctx.call('account.listPayments', {}, url, req)) as AnyRow[]
        return document(ctx, url, req, 'account_backend.payments.title', (_, tr, shell) =>
          entityScreen(tr, {
            title: tr('account_backend.payments.title'),
            frame: shell,
            action: '/admin/payments',
            submit: tr('account_backend.action.registerPayment'),
            rows,
            fields: [
              { name: 'name', label: tr('account_backend.field.name'), required: true },
              {
                name: 'paymentType',
                label: tr('account_backend.field.paymentType'),
                type: 'select',
                options: optionsOf(tr, 'paymentType', PAYMENT_TYPES),
              },
              {
                name: 'partnerType',
                label: tr('account_backend.field.partnerType'),
                type: 'select',
                options: optionsOf(tr, 'partnerType', PARTNER_TYPES),
              },
              {
                name: 'partnerId',
                label: tr('account_backend.field.partnerId'),
                type: 'select',
                options: choices(data.partners, true),
              },
              {
                name: 'journalId',
                label: tr('account_backend.field.journalId'),
                type: 'select',
                options: choices(
                  data.journals.filter((journal) => ['bank', 'cash'].includes(String(journal.type))),
                ),
                required: true,
              },
              {
                name: 'destinationAccountId',
                label: tr('account_backend.field.destinationAccountId'),
                type: 'select',
                options: choices(data.accounts),
                required: true,
              },
              {
                name: 'amount',
                label: tr('account_backend.field.amount'),
                type: 'decimal',
                value: 0,
                required: true,
              },
              { name: 'date', label: tr('account_backend.field.date'), type: 'date' },
              { name: 'memo', label: tr('account_backend.field.memo') },
              { name: 'paymentReference', label: tr('account_backend.field.paymentReference') },
              {
                name: 'reconcileLineId',
                label: tr('account_backend.field.reconcileLineId'),
                type: 'select',
                options: [
                  { value: '', label: '—' },
                  ...openItems.map((line) => ({
                    value: String(line.id),
                    label: `${String((line.move as AnyRow)?.name ?? line.moveId)} · ${String(line.accountId)} · ${formatMoney(tr, line.amountResidual, (line.move as AnyRow)?.currency)}`,
                  })),
                ],
              },
            ],
            columns: [
              {
                key: 'name',
                label: tr('account_backend.field.name'),
                cell: (row) => String(row.name),
                priority: 'primary',
              },
              {
                key: 'type',
                label: tr('account_backend.field.paymentType'),
                cell: (row) => labelOf(tr, 'paymentType', row.paymentType),
              },
              {
                key: 'amount',
                label: tr('account_backend.field.amount'),
                cell: (row) => formatMoney(tr, row.amount, row.currency),
                align: 'end',
                kind: 'currency',
              },
              {
                key: 'state',
                label: tr('account_backend.field.state'),
                cell: (row) => badge(labelOf(tr, 'paymentStatus', row.state), 'neutral', String(row.state)),
              },
            ],
          }),
        )
      },
    '/admin/trial-balance':
      (ctx): Route =>
      async (url, req) => {
        if (req.method !== 'GET') return text('GET', { status: 405 })
        const dateFrom = url.searchParams.get('dateFrom') ?? '',
          dateTo = url.searchParams.get('dateTo') ?? ''
        const [rows, companies] = (await Promise.all([
          ctx.call(
            'account.trialBalance',
            { ...(dateFrom ? { dateFrom } : {}), ...(dateTo ? { dateTo } : {}) },
            url,
            req,
          ),
          ctx.call('company.listCompanies', {}, url, req),
        ])) as [AnyRow[], AnyRow[]]
        return document(ctx, url, req, 'account_backend.trialBalance.title', (_, tr, shell) => {
          const currency = currencyOf(companies, shell)
          return reportScreen(tr, {
            title: tr('account_backend.trialBalance.title'),
            frame: shell,
            action: '/admin/trial-balance',
            rows,
            fields: [
              {
                name: 'dateFrom',
                label: tr('account_backend.field.dateFrom'),
                type: 'date',
                value: dateFrom,
              },
              { name: 'dateTo', label: tr('account_backend.field.dateTo'), type: 'date', value: dateTo },
            ],
            columns: [
              {
                key: 'code',
                label: tr('account_backend.field.code'),
                cell: (row) => code(String(row.code)),
                priority: 'primary',
              },
              { key: 'name', label: tr('account_backend.field.name'), cell: (row) => String(row.name) },
              {
                key: 'debit',
                label: tr('account_backend.field.debit'),
                cell: (row) => formatMoney(tr, row.debit, currency),
                align: 'end',
                kind: 'currency',
              },
              {
                key: 'credit',
                label: tr('account_backend.field.credit'),
                cell: (row) => formatMoney(tr, row.credit, currency),
                align: 'end',
                kind: 'currency',
              },
              {
                key: 'balance',
                label: tr('account_backend.field.balance'),
                cell: (row) => formatMoney(tr, row.balance, currency),
                align: 'end',
                kind: 'currency',
              },
            ],
          })
        })
      },
    '/admin/general-ledger':
      (ctx): Route =>
      async (url, req) => {
        if (req.method !== 'GET') return text('GET', { status: 405 })
        const data = await common(ctx, url, req),
          accountId = url.searchParams.get('accountId') ?? '',
          dateFrom = url.searchParams.get('dateFrom') ?? '',
          dateTo = url.searchParams.get('dateTo') ?? ''
        const rows = (await ctx.call(
          'account.generalLedger',
          {
            ...(accountId ? { accountId } : {}),
            ...(dateFrom ? { dateFrom } : {}),
            ...(dateTo ? { dateTo } : {}),
          },
          url,
          req,
        )) as AnyRow[]
        return document(ctx, url, req, 'account_backend.generalLedger.title', (_, tr, shell) => {
          const currency = currencyOf(data.companies, shell)
          return reportScreen(tr, {
            title: tr('account_backend.generalLedger.title'),
            frame: shell,
            action: '/admin/general-ledger',
            rows,
            fields: [
              {
                name: 'accountId',
                label: tr('account_backend.field.accountId'),
                type: 'select',
                value: accountId,
                options: choices(data.accounts, true),
              },
              {
                name: 'dateFrom',
                label: tr('account_backend.field.dateFrom'),
                type: 'date',
                value: dateFrom,
              },
              { name: 'dateTo', label: tr('account_backend.field.dateTo'), type: 'date', value: dateTo },
            ],
            columns: [
              {
                key: 'date',
                label: tr('account_backend.field.date'),
                cell: (row) => String((row.move as AnyRow)?.date ?? '').slice(0, 10),
                priority: 'primary',
              },
              {
                key: 'entry',
                label: tr('account_backend.field.entry'),
                cell: (row) => String((row.move as AnyRow)?.name ?? ''),
              },
              { key: 'name', label: tr('account_backend.field.name'), cell: (row) => String(row.name) },
              {
                key: 'debit',
                label: tr('account_backend.field.debit'),
                cell: (row) => formatMoney(tr, row.debit, currency),
                align: 'end',
                kind: 'currency',
              },
              {
                key: 'credit',
                label: tr('account_backend.field.credit'),
                cell: (row) => formatMoney(tr, row.credit, currency),
                align: 'end',
                kind: 'currency',
              },
            ],
          })
        })
      },
    '/admin/partner-statement':
      (ctx): Route =>
      async (url, req) => {
        if (req.method !== 'GET') return text('GET', { status: 405 })
        const data = await common(ctx, url, req)
        const partnerId = url.searchParams.get('partnerId') ?? ''
        const rows = partnerId
          ? ((await ctx.call('account.partnerStatement', { partnerId }, url, req)) as AnyRow[])
          : []
        return document(ctx, url, req, 'account_backend.partnerStatement.title', (_, tr, shell) => {
          const currency = currencyOf(data.companies, shell)
          return reportScreen(tr, {
            title: tr('account_backend.partnerStatement.title'),
            frame: shell,
            action: '/admin/partner-statement',
            rows,
            fields: [
              {
                name: 'partnerId',
                label: tr('account_backend.field.partnerId'),
                type: 'select',
                value: partnerId,
                options: choices(data.partners, true),
              },
            ],
            columns: [
              {
                key: 'date',
                label: tr('account_backend.field.date'),
                cell: (row) => String((row.move as AnyRow)?.date ?? '').slice(0, 10),
                priority: 'primary',
              },
              {
                key: 'entry',
                label: tr('account_backend.field.entry'),
                cell: (row) => String((row.move as AnyRow)?.name ?? ''),
              },
              { key: 'name', label: tr('account_backend.field.name'), cell: (row) => String(row.name) },
              {
                key: 'debit',
                label: tr('account_backend.field.debit'),
                cell: (row) => formatMoney(tr, row.debit, currency),
                align: 'end',
                kind: 'currency',
              },
              {
                key: 'credit',
                label: tr('account_backend.field.credit'),
                cell: (row) => formatMoney(tr, row.credit, currency),
                align: 'end',
                kind: 'currency',
              },
              {
                key: 'residual',
                label: tr('account_backend.field.residual'),
                cell: (row) => formatMoney(tr, row.amountResidual, currency),
                align: 'end',
                kind: 'currency',
              },
            ],
          })
        })
      },
  },
  messages: MESSAGES,
})

const vi: Record<string, string> = {
  'app.title': 'Kế toán trong quản trị',
  'app.summary': 'Giao diện sổ cái, hoá đơn, thanh toán và báo cáo.',
  'app.category': 'Tài chính',
  'menu.app': 'Kế toán',
  'menu.dashboard': 'Tổng quan',
  'menu.customers': 'Khách hàng',
  'menu.customerInvoices': 'Hoá đơn khách hàng',
  'menu.vendors': 'Nhà cung cấp',
  'menu.vendorBills': 'Hoá đơn nhà cung cấp',
  'menu.operations': 'Nghiệp vụ',
  'menu.entries': 'Bút toán',
  'menu.payments': 'Thanh toán',
  'menu.reporting': 'Báo cáo',
  'menu.trialBalance': 'Bảng cân đối thử',
  'menu.generalLedger': 'Sổ cái',
  'menu.partnerStatement': 'Sổ đối tác',
  'menu.configuration': 'Cấu hình',
  'menu.accounts': 'Hệ thống tài khoản',
  'menu.journals': 'Sổ nhật ký',
  'menu.taxes': 'Thuế',
  'menu.paymentTerms': 'Điều khoản thanh toán',
  'dashboard.title': 'Tổng quan kế toán',
  'dashboard.draft': 'Bút toán nháp',
  'dashboard.posted': 'Bút toán đã ghi sổ',
  'dashboard.unpaid': 'Chứng từ chưa thanh toán',
  'dashboard.records': 'Bản ghi',
  'dashboard.reports': 'Báo cáo tài chính',
  'accounts.title': 'Hệ thống tài khoản',
  'journals.title': 'Sổ nhật ký',
  'taxes.title': 'Thuế',
  'terms.title': 'Điều khoản thanh toán',
  'entries.title': 'Bút toán',
  'customerInvoices.title': 'Hoá đơn khách hàng',
  'vendorBills.title': 'Hoá đơn nhà cung cấp',
  'payments.title': 'Thanh toán',
  'trialBalance.title': 'Bảng cân đối thử',
  'generalLedger.title': 'Sổ cái',
  'partnerStatement.title': 'Sổ đối tác',
  'lines.title': 'Dòng bút toán',
  'lines.add': 'Thêm dòng bút toán',
  'move.kicker': 'Chứng từ kế toán',
  'move.actions': 'Hành động trên chứng từ',
  'move.collaboration': 'Trao đổi và hoạt động của chứng từ',
  'terms.lines': 'Số mốc thanh toán',
  'action.create': 'Tạo mới',
  'action.createTerm': 'Tạo điều khoản',
  'action.addTermLine': 'Thêm mốc thanh toán',
  'action.addLine': 'Thêm dòng',
  'action.post': 'Ghi sổ',
  'action.cancel': 'Huỷ',
  'action.registerPayment': 'Ghi nhận thanh toán',
  'action.calculate': 'Tính báo cáo',
  'field.code': 'Mã',
  'field.name': 'Tên',
  'field.accountType': 'Loại tài khoản',
  'field.reconcile': 'Cho phép đối soát',
  'field.type': 'Loại',
  'field.defaultAccountId': 'Tài khoản mặc định',
  'field.sequence': 'Số thứ tự',
  'field.description': 'Mô tả',
  'field.typeTaxUse': 'Phạm vi sử dụng',
  'field.taxScope': 'Phạm vi hàng hoá',
  'field.amountType': 'Cách tính thuế',
  'field.amount': 'Số tiền / tỷ lệ',
  'field.priceInclude': 'Đã gồm trong giá',
  'field.includeBaseAmount': 'Cộng vào cơ sở tính thuế',
  'field.note': 'Ghi chú',
  'field.journalId': 'Sổ nhật ký',
  'field.moveType': 'Loại chứng từ',
  'field.date': 'Ngày',
  'field.ref': 'Tham chiếu',
  'field.partnerId': 'Đối tác',
  'field.state': 'Trạng thái',
  'field.paymentState': 'Thanh toán',
  'field.amountTotal': 'Tổng tiền',
  'field.accountId': 'Tài khoản',
  'field.debit': 'Nợ',
  'field.credit': 'Có',
  'field.residual': 'Còn lại',
  'field.invoiceDate': 'Ngày hoá đơn',
  'field.paymentTermId': 'Điều khoản thanh toán',
  'field.productId': 'ID biến thể',
  'field.productUomId': 'ID đơn vị',
  'field.quantity': 'Số lượng',
  'field.priceUnit': 'Đơn giá',
  'field.discount': 'Chiết khấu %',
  'field.lineAccountId': 'Tài khoản doanh thu / chi phí',
  'field.counterpartAccountId': 'Tài khoản phải thu / phải trả',
  'field.taxId': 'Thuế',
  'field.taxAccountId': 'Tài khoản thuế',
  'field.paymentType': 'Loại thanh toán',
  'field.partnerType': 'Loại đối tác',
  'field.destinationAccountId': 'Tài khoản đối ứng',
  'field.memo': 'Nội dung',
  'field.paymentReference': 'Tham chiếu thanh toán',
  'field.reconcileLineId': 'Đối soát với khoản mở',
  'field.termValue': 'Kiểu giá trị',
  'field.valueAmount': 'Giá trị',
  'field.delayType': 'Cách tính hạn',
  'field.nbDays': 'Số ngày',
  'field.daysNextMonth': 'Ngày trong tháng sau',
  'field.dateFrom': 'Từ ngày',
  'field.dateTo': 'Đến ngày',
  'field.balance': 'Số dư',
  'field.entry': 'Bút toán',
  'move.notFound': 'Không tìm thấy bút toán.',
  yes: 'Có',
  no: 'Không',
  empty: 'Chưa có dữ liệu.',
  emptyHint: 'Tạo bản ghi đầu tiên hoặc thay đổi bộ lọc.',
}

const en: Record<string, string> = {
  'app.title': 'Accounting in admin',
  'app.summary': 'Ledger, invoice, payment, and reporting UI.',
  'app.category': 'Finance',
  'menu.app': 'Accounting',
  'menu.dashboard': 'Overview',
  'menu.customers': 'Customers',
  'menu.customerInvoices': 'Customer invoices',
  'menu.vendors': 'Vendors',
  'menu.vendorBills': 'Vendor bills',
  'menu.operations': 'Operations',
  'menu.entries': 'Journal entries',
  'menu.payments': 'Payments',
  'menu.reporting': 'Reporting',
  'menu.trialBalance': 'Trial balance',
  'menu.generalLedger': 'General ledger',
  'menu.partnerStatement': 'Partner ledger',
  'menu.configuration': 'Configuration',
  'menu.accounts': 'Chart of accounts',
  'menu.journals': 'Journals',
  'menu.taxes': 'Taxes',
  'menu.paymentTerms': 'Payment terms',
  'dashboard.title': 'Accounting overview',
  'dashboard.draft': 'Draft entries',
  'dashboard.posted': 'Posted entries',
  'dashboard.unpaid': 'Unpaid documents',
  'dashboard.records': 'Records',
  'dashboard.reports': 'Financial reports',
  'accounts.title': 'Chart of accounts',
  'journals.title': 'Journals',
  'taxes.title': 'Taxes',
  'terms.title': 'Payment terms',
  'entries.title': 'Journal entries',
  'customerInvoices.title': 'Customer invoices',
  'vendorBills.title': 'Vendor bills',
  'payments.title': 'Payments',
  'trialBalance.title': 'Trial balance',
  'generalLedger.title': 'General ledger',
  'partnerStatement.title': 'Partner ledger',
  'lines.title': 'Journal items',
  'lines.add': 'Add journal item',
  'move.kicker': 'Accounting document',
  'move.actions': 'Document actions',
  'move.collaboration': 'Document conversation and activities',
  'terms.lines': 'Due milestones',
  'action.create': 'Create',
  'action.createTerm': 'Create term',
  'action.addTermLine': 'Add due milestone',
  'action.addLine': 'Add line',
  'action.post': 'Post',
  'action.cancel': 'Cancel',
  'action.registerPayment': 'Register payment',
  'action.calculate': 'Calculate',
  'field.code': 'Code',
  'field.name': 'Name',
  'field.accountType': 'Account type',
  'field.reconcile': 'Allow reconciliation',
  'field.type': 'Type',
  'field.defaultAccountId': 'Default account',
  'field.sequence': 'Sequence',
  'field.description': 'Description',
  'field.typeTaxUse': 'Tax use',
  'field.taxScope': 'Tax scope',
  'field.amountType': 'Tax computation',
  'field.amount': 'Amount / rate',
  'field.priceInclude': 'Included in price',
  'field.includeBaseAmount': 'Affects tax base',
  'field.note': 'Note',
  'field.journalId': 'Journal',
  'field.moveType': 'Document type',
  'field.date': 'Date',
  'field.ref': 'Reference',
  'field.partnerId': 'Partner',
  'field.state': 'State',
  'field.paymentState': 'Payment',
  'field.amountTotal': 'Total',
  'field.accountId': 'Account',
  'field.debit': 'Debit',
  'field.credit': 'Credit',
  'field.residual': 'Residual',
  'field.invoiceDate': 'Invoice date',
  'field.paymentTermId': 'Payment term',
  'field.productId': 'Variant ID',
  'field.productUomId': 'UoM ID',
  'field.quantity': 'Quantity',
  'field.priceUnit': 'Unit price',
  'field.discount': 'Discount %',
  'field.lineAccountId': 'Income / expense account',
  'field.counterpartAccountId': 'Receivable / payable account',
  'field.taxId': 'Tax',
  'field.taxAccountId': 'Tax account',
  'field.paymentType': 'Payment type',
  'field.partnerType': 'Partner type',
  'field.destinationAccountId': 'Counterpart account',
  'field.memo': 'Memo',
  'field.paymentReference': 'Payment reference',
  'field.reconcileLineId': 'Reconcile with open item',
  'field.termValue': 'Value type',
  'field.valueAmount': 'Value',
  'field.delayType': 'Due computation',
  'field.nbDays': 'Days',
  'field.daysNextMonth': 'Day of next month',
  'field.dateFrom': 'Date from',
  'field.dateTo': 'Date to',
  'field.balance': 'Balance',
  'field.entry': 'Entry',
  'move.notFound': 'Journal entry not found.',
  yes: 'Yes',
  no: 'No',
  empty: 'No data yet.',
  emptyHint: 'Create the first record or change the filters.',
}

const selection: Record<string, Record<string, string>> = {
  accountType: {
    asset_receivable: 'Receivable',
    asset_cash: 'Bank and Cash',
    asset_current: 'Current Assets',
    asset_non_current: 'Non-current Assets',
    asset_prepayments: 'Prepayments',
    asset_fixed: 'Fixed Assets',
    liability_payable: 'Payable',
    liability_credit_card: 'Credit Card',
    liability_current: 'Current Liabilities',
    liability_non_current: 'Non-current Liabilities',
    equity: 'Equity',
    equity_unaffected: 'Current Year Earnings',
    income: 'Income',
    income_other: 'Other Income',
    expense: 'Expenses',
    expense_other: 'Other Expenses',
    expense_depreciation: 'Depreciation',
    expense_direct_cost: 'Cost of Revenue',
    off_balance: 'Off-Balance Sheet',
  },
  journalType: { sale: 'Sales', purchase: 'Purchase', cash: 'Cash', bank: 'Bank', general: 'Miscellaneous' },
  taxUse: { sale: 'Sales', purchase: 'Purchases', none: 'None' },
  taxScope: { service: 'Services', consu: 'Goods' },
  taxAmountType: {
    group: 'Group of Taxes',
    fixed: 'Fixed',
    percent: 'Percentage',
    division: 'Percentage Tax Included',
  },
  moveType: {
    entry: 'Journal Entry',
    out_invoice: 'Customer Invoice',
    out_refund: 'Customer Credit Note',
    in_invoice: 'Vendor Bill',
    in_refund: 'Vendor Credit Note',
    out_receipt: 'Sales Receipt',
    in_receipt: 'Purchase Receipt',
  },
  moveState: { draft: 'Draft', posted: 'Posted', cancel: 'Cancelled' },
  paymentState: {
    not_paid: 'Not Paid',
    in_payment: 'In Payment',
    paid: 'Paid',
    partial: 'Partially Paid',
    reversed: 'Reversed',
    blocked: 'Blocked',
    invoicing_legacy: 'Invoicing App Legacy',
  },
  paymentType: { outbound: 'Send', inbound: 'Receive' },
  partnerType: { customer: 'Customer', supplier: 'Vendor' },
  paymentTermValue: { percent: 'Percent', fixed: 'Fixed amount' },
  paymentTermDelay: {
    days_after: 'Days after invoice date',
    days_after_end_of_month: 'Days after end of month',
    days_after_end_of_next_month: 'Days after end of next month',
    days_end_of_month_on_the: 'Days after, then day of next month',
  },
  paymentStatus: {
    draft: 'Draft',
    in_process: 'In Process',
    paid: 'Paid',
    canceled: 'Canceled',
    rejected: 'Rejected',
  },
}

const viSelection: Record<string, Record<string, string>> = {
  accountType: {
    asset_receivable: 'Phải thu',
    asset_cash: 'Ngân hàng và tiền mặt',
    asset_current: 'Tài sản ngắn hạn',
    asset_non_current: 'Tài sản dài hạn',
    asset_prepayments: 'Chi phí trả trước',
    asset_fixed: 'Tài sản cố định',
    liability_payable: 'Phải trả',
    liability_credit_card: 'Thẻ tín dụng',
    liability_current: 'Nợ ngắn hạn',
    liability_non_current: 'Nợ dài hạn',
    equity: 'Vốn chủ sở hữu',
    equity_unaffected: 'Lợi nhuận năm hiện tại',
    income: 'Doanh thu',
    income_other: 'Thu nhập khác',
    expense: 'Chi phí',
    expense_other: 'Chi phí khác',
    expense_depreciation: 'Khấu hao',
    expense_direct_cost: 'Giá vốn',
    off_balance: 'Ngoài bảng cân đối',
  },
  journalType: {
    sale: 'Bán hàng',
    purchase: 'Mua hàng',
    cash: 'Tiền mặt',
    bank: 'Ngân hàng',
    general: 'Nghiệp vụ khác',
  },
  taxUse: { sale: 'Bán hàng', purchase: 'Mua hàng', none: 'Không áp dụng' },
  taxScope: { service: 'Dịch vụ', consu: 'Hàng hoá' },
  taxAmountType: {
    group: 'Nhóm thuế',
    fixed: 'Cố định',
    percent: 'Phần trăm',
    division: 'Phần trăm đã gồm thuế',
  },
  moveType: {
    entry: 'Bút toán',
    out_invoice: 'Hoá đơn khách hàng',
    out_refund: 'Hoá đơn điều chỉnh khách hàng',
    in_invoice: 'Hoá đơn nhà cung cấp',
    in_refund: 'Hoá đơn điều chỉnh nhà cung cấp',
    out_receipt: 'Biên nhận bán hàng',
    in_receipt: 'Biên nhận mua hàng',
  },
  moveState: { draft: 'Nháp', posted: 'Đã ghi sổ', cancel: 'Đã huỷ' },
  paymentState: {
    not_paid: 'Chưa thanh toán',
    in_payment: 'Đang thanh toán',
    paid: 'Đã thanh toán',
    partial: 'Thanh toán một phần',
    reversed: 'Đã đảo',
    blocked: 'Bị chặn',
    invoicing_legacy: 'Kế thừa hệ thống cũ',
  },
  paymentType: { outbound: 'Gửi tiền', inbound: 'Nhận tiền' },
  partnerType: { customer: 'Khách hàng', supplier: 'Nhà cung cấp' },
  paymentTermValue: { percent: 'Phần trăm', fixed: 'Số tiền cố định' },
  paymentTermDelay: {
    days_after: 'Số ngày sau ngày hoá đơn',
    days_after_end_of_month: 'Số ngày sau cuối tháng',
    days_after_end_of_next_month: 'Số ngày sau cuối tháng kế tiếp',
    days_end_of_month_on_the: 'Cộng ngày rồi chốt ngày trong tháng sau',
  },
  paymentStatus: {
    draft: 'Nháp',
    in_process: 'Đang xử lý',
    paid: 'Đã thanh toán',
    canceled: 'Đã huỷ',
    rejected: 'Bị từ chối',
  },
}

for (const [group, values] of Object.entries(selection))
  for (const [key, value] of Object.entries(values)) {
    en[`${group}.${key}`] = value
    vi[`${group}.${key}`] = viSelection[group]?.[key] ?? value
  }

Object.assign(MESSAGES.vi, vi)
Object.assign(MESSAGES.en, en)
