import { randomUUID } from 'node:crypto'
import { defineModule, text } from '@ketvietlab/ketjs'
import type { Route, ServeContext } from '@ketvietlab/ketjs'
import type { FormField, Frame } from '../../ui/index.ts'
import { actionGroup, formatMoney, linkButton } from '../../ui/index.ts'
import { readForm, seeOther } from '../backend/forms.ts'
import { accountOptions, accountRelationControl } from './relation-control.ts'
import { partnerRelationControl } from '../partner_backend/relation-control.ts'
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
import { optionsOf } from './screens.tsx'
import { accountingOverviewScreen } from './accounting-overview-screen.tsx'
import { accountsScreen } from './accounts-screen.tsx'
import { customerInvoicesScreen } from './customer-invoices-screen.tsx'
import { journalsScreen } from './journals-screen.tsx'
import { generalLedgerScreen } from './general-ledger-screen.tsx'
import { moveDetailScreen } from './move-detail-screen.tsx'
import { journalEntriesScreen } from './journal-entries-screen.tsx'
import { paymentsScreen } from './payments-screen.tsx'
import { paymentTermsScreen } from './payment-terms-screen.tsx'
import { partnerLedgerScreen } from './partner-ledger-screen.tsx'
import { taxesScreen } from './taxes-screen.tsx'
import { trialBalanceScreen } from './trial-balance-screen.tsx'
import { vendorBillsScreen } from './vendor-bills-screen.tsx'
import { adminPage, choices, localeQuery, optional } from '../backend/screen.ts'

type AnyRow = Record<string, unknown>
type Translator = ReturnType<ServeContext['translate']>

/** How many rows an admin list renders before the reader has to narrow it down. */
const LIST_PAGE = 200

const resultRedirect = (result: unknown, ok: string, fail = ok) =>
  (result as { ok?: boolean }).ok
    ? seeOther(ok)
    : seeOther(`${fail}${fail.includes('?') ? '&' : '?'}invalid=1`)

const currencyOf = (companies: AnyRow[], shell: Frame): unknown =>
  companies.find((company) => company.id === shell.viewer?.company)?.currency

/**
 * A configuration list is also its own editor. `?edit=<id>` prefills the create
 * form with that row and posts back to the same id, so a mistyped account code or
 * a changed tax rate is a correction rather than a second row nobody can remove.
 */
const editingId = (url: URL): string => url.searchParams.get('edit') ?? ''

const editTarget = (rows: AnyRow[], url: URL): AnyRow | null => {
  const id = editingId(url)
  return id ? (rows.find((row) => String(row.id) === id) ?? null) : null
}

/** The form target for a config screen, carrying the edited id and the locale. */
const configAction = (url: URL, path: string): string => {
  const target = new URL(path, url)
  const lang = url.searchParams.get('lang')
  if (lang) target.searchParams.set('lang', lang)
  const id = editingId(url)
  if (id) target.searchParams.set('edit', id)
  return `${target.pathname}${target.search}`
}

const editHref = (url: URL, path: string, id: unknown): string => {
  const target = new URL(path, url)
  const lang = url.searchParams.get('lang')
  if (lang) target.searchParams.set('lang', lang)
  target.searchParams.set('edit', String(id))
  return `${target.pathname}${target.search}`
}

/** The value a field should show: what the row holds when editing, the default otherwise. */
const prefill = (fields: FormField[], row: AnyRow | null): FormField[] =>
  row
    ? fields.map((field) => {
        const held = row[field.name]
        if (held === undefined) return field
        if (field.type === 'checkbox') return { ...field, value: held === true }
        return { ...field, value: held === null ? '' : String(held) }
      })
    : fields

/** The id a config POST writes to: the edited row, or a fresh one. */
const targetId = (url: URL): string => editingId(url) || randomUUID()

/**
 * The account name in the reader's language.
 *
 * A bundled chart carries the statutory name in both languages; anything the
 * company added itself has only the one it was typed in.
 */
const accountName = (_: Translator, account: AnyRow): string =>
  String((_.locale.startsWith('en') && account.nameEn) || account.name)

const accountChoices = (_: Translator, rows: AnyRow[], empty = false) => [
  ...(empty ? [{ value: '', label: '—' }] : []),
  ...rows.map((row) => ({ value: String(row.id), label: `${String(row.code)} · ${accountName(_, row)}` })),
]

const common = async (ctx: ServeContext, url: URL, req: Parameters<Route>[1]) => {
  await ctx.call('account.initializeCompany', {}, url, req)
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

const moveFields = async (
  ctx: ServeContext,
  url: URL,
  req: Parameters<Route>[1],
  _: Translator,
  data: Awaited<ReturnType<typeof common>>,
  types: readonly string[],
): Promise<FormField[]> => [
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
    control: await partnerRelationControl(ctx, url, req, _, {
      id: 'move-partner',
      partners: data.partners as Array<{ id: string; name: string; ref?: string | null }>,
      fieldLabel: _('account_backend.field.partnerId'),
      title: _('account_backend.relation.partners'),
      allowEmpty: true,
    }),
  },
]

const invoiceFields = async (
  ctx: ServeContext,
  url: URL,
  req: Parameters<Route>[1],
  _: Translator,
  data: Awaited<ReturnType<typeof common>>,
  types: readonly string[],
): Promise<FormField[]> => {
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
      control: await partnerRelationControl(ctx, url, req, _, {
        id: 'invoice-partner',
        partners: data.partners as Array<{ id: string; name: string; ref?: string | null }>,
        fieldLabel: _('account_backend.field.partnerId'),
        title: _('account_backend.relation.partners'),
        required: true,
      }),
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
      options: accountChoices(_, lineAccounts),
      required: true,
      control: await accountRelationControl(ctx, url, req, _, {
        id: `invoice-line-account:${types.join('-')}`,
        name: 'lineAccountId',
        label: _('account_backend.field.lineAccountId'),
        accounts: accountOptions(lineAccounts),
        accountTypes: customer ? ['income*'] : ['expense*'],
        required: true,
      }),
    },
    {
      name: 'counterpartAccountId',
      label: _('account_backend.field.counterpartAccountId'),
      type: 'select',
      options: accountChoices(_, counterpartAccounts),
      required: true,
      control: await accountRelationControl(ctx, url, req, _, {
        id: `invoice-counterpart:${types.join('-')}`,
        name: 'counterpartAccountId',
        label: _('account_backend.field.counterpartAccountId'),
        accounts: accountOptions(counterpartAccounts),
        accountTypes: [customer ? 'asset_receivable' : 'liability_payable'],
        required: true,
      }),
    },
    { name: 'taxId', label: _('account_backend.field.taxId'), type: 'select', options: choices(taxes, true) },
    {
      // Import duty and import VAT are two taxes on one line: the duty carries
      // `includeBaseAmount`, so the VAT is computed on the base plus the duty.
      name: 'secondTaxId',
      label: _('account_backend.field.secondTaxId'),
      type: 'select',
      options: choices(taxes, true),
      help: _('account_backend.field.secondTaxIdHint'),
    },
    {
      name: 'taxAccountId',
      label: _('account_backend.field.taxAccountId'),
      type: 'select',
      options: accountChoices(_, data.accounts, true),
      control: await accountRelationControl(ctx, url, req, _, {
        id: `invoice-tax-account:${types.join('-')}`,
        name: 'taxAccountId',
        label: _('account_backend.field.taxAccountId'),
        accounts: accountOptions(data.accounts),
        allowEmpty: true,
      }),
      help: _('account_backend.field.taxAccountIdHint'),
    },
  ]
}

const createInvoice = async (ctx: ServeContext, url: URL, req: Parameters<Route>[1], redirect: string) => {
  const form = await readForm(req)
  // The taxes apply in their configured sequence, not in the order the two
  // selects happen to sit on the page.
  const taxIds = [form.taxId, form.secondTaxId].filter(
    (id, at, all): id is string => Boolean(id) && all.indexOf(id) === at,
  )
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
      ...(taxIds.length ? { taxIds } : {}),
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
            : form.action === 'reverse'
              ? await ctx.call('account.reverseMove', { id: params.id, reversalId: randomUUID() }, url, req)
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
      // A reversal is a journal entry of its own, so the user lands on it rather
      // than on the document they just corrected.
      if (form.action === 'reverse' && (result as { ok?: boolean }).ok)
        return seeOther(
          `/admin/accounting/entries/${encodeURIComponent(String((result as { reversalId: unknown }).reversalId))}${localeQuery(url)}`,
        )
      return resultRedirect(result, `${url.pathname}${localeQuery(url)}`)
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
    const wanted =
      move.moveType === 'out_invoice'
        ? 'account.customerInvoice'
        : move.moveType === 'in_invoice'
          ? 'account.vendorBill'
          : null
    const printable = (await ctx.reportsOf(url, req, 'account.Move')).filter((report) => report.id === wanted)
    return adminPage(ctx, url, req, {
      title: String(move.name),
      translate: false,
      body: (_, frame) =>
        moveDetailScreen(
          _,
          move,
          (move.lines as AnyRow[]) ?? [],
          frame,
          accountChoices(_, accounts),
          `${url.pathname}${localeQuery(url)}`,
          collaboration,
          printable.length
            ? actionGroup({
                label: 'Print',
                actions: printable.map((report) =>
                  linkButton({
                    label: _(report.title),
                    href: `/reports/${encodeURIComponent(report.id)}/${encodeURIComponent(String(move.id))}${url.search}`,
                  }),
                ),
              })
            : undefined,
        ),
    })
  }

const MESSAGES: Record<string, Record<string, string>> = { vi: {}, en: {} }

export default defineModule({
  name: 'account_backend',
  // 0.2.0: configuration screens edit and archive in place, a posted document can
  // be reversed, and account labels follow the reader's locale.
  version: '0.2.0',
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
    accounting: { label: 'menu.app', icon: 'banknote', sequence: 26 },
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
      path: '/admin/accounting/customer-invoices',
      needs: 'account.listMoves',
      sequence: 10,
    },
    'accounting.vendors': { parent: 'accounting', label: 'menu.vendors', sequence: 20 },
    'accounting.vendorBills': {
      parent: 'accounting.vendors',
      label: 'menu.vendorBills',
      path: '/admin/accounting/vendor-bills',
      needs: 'account.listMoves',
      sequence: 10,
    },
    'accounting.operations': { parent: 'accounting', label: 'menu.operations', sequence: 30 },
    'accounting.entries': {
      parent: 'accounting.operations',
      label: 'menu.entries',
      path: '/admin/accounting/entries',
      needs: 'account.listMoves',
      sequence: 10,
    },
    'accounting.payments': {
      parent: 'accounting.operations',
      label: 'menu.payments',
      path: '/admin/accounting/payments',
      needs: 'account.listPayments',
      sequence: 20,
    },
    'accounting.reporting': { parent: 'accounting', label: 'menu.reporting', sequence: 40 },
    'accounting.trialBalance': {
      parent: 'accounting.reporting',
      label: 'menu.trialBalance',
      path: '/admin/accounting/trial-balance',
      needs: 'account.trialBalance',
      sequence: 10,
    },
    'accounting.generalLedger': {
      parent: 'accounting.reporting',
      label: 'menu.generalLedger',
      path: '/admin/accounting/general-ledger',
      needs: 'account.generalLedger',
      sequence: 20,
    },
    'accounting.partnerStatement': {
      parent: 'accounting.reporting',
      label: 'menu.partnerStatement',
      path: '/admin/accounting/partner-statement',
      needs: 'account.partnerStatement',
      sequence: 30,
    },
    'accounting.configuration': { parent: 'accounting', label: 'menu.configuration', sequence: 50 },
    'accounting.accounts': {
      parent: 'accounting.configuration',
      label: 'menu.accounts',
      path: '/admin/accounting/accounts',
      needs: 'account.listAccounts',
      sequence: 10,
    },
    'accounting.journals': {
      parent: 'accounting.configuration',
      label: 'menu.journals',
      path: '/admin/accounting/journals',
      needs: 'account.listJournals',
      sequence: 20,
    },
    'accounting.taxes': {
      parent: 'accounting.configuration',
      label: 'menu.taxes',
      path: '/admin/accounting/taxes',
      needs: 'account.listTaxes',
      sequence: 30,
    },
    'accounting.terms': {
      parent: 'accounting.configuration',
      label: 'menu.paymentTerms',
      path: '/admin/accounting/terms',
      needs: 'account.listPaymentTerms',
      sequence: 40,
    },
  },
  routes: {
    '/admin/accounting':
      (ctx): Route =>
      async (url, req) => {
        if (req.method !== 'GET') return text('GET', { status: 405 })
        await ctx.call('account.initializeCompany', {}, url, req)
        // Counting in the database rather than fetching every move to measure the
        // list: a dashboard must not get slower as the ledger grows.
        const [accounts, journals, draft, posted, unpaid, setup] = (await Promise.all([
          ctx.call('account.listAccounts', {}, url, req),
          ctx.call('account.listJournals', {}, url, req),
          ctx.call('account.countMoves', { state: 'draft' }, url, req),
          ctx.call('account.countMoves', { state: 'posted' }, url, req),
          ctx.call('account.countMoves', { state: 'posted', paymentState: 'not_paid' }, url, req),
          ctx.call('account.getSetup', {}, url, req),
        ])) as [AnyRow[], AnyRow[], AnyRow, AnyRow, AnyRow, AnyRow]
        return adminPage(ctx, url, req, {
          title: 'account_backend.dashboard.title',
          body: (_, frame) =>
            accountingOverviewScreen(_, {
              counts: {
                accounts: accounts.length,
                journals: journals.length,
                draft: Number(draft.count),
                posted: Number(posted.count),
                unpaid: Number(unpaid.count),
              },
              frame: frame,
              locale: localeQuery(url),
              standard: String(setup.standard),
            }),
        })
      },
    '/admin/accounting/accounts':
      (ctx): Route =>
      async (url, req) => {
        if (req.method === 'POST') {
          const form = await readForm(req)
          return resultRedirect(
            await ctx.call(
              'account.saveAccount',
              {
                id: targetId(url),
                code: form.code ?? '',
                name: form.name ?? '',
                accountType: form.accountType ?? '',
                reconcile: form.reconcile === '1',
                active: form.active === '1',
              },
              url,
              req,
            ),
            `/admin/accounting/accounts${localeQuery(url)}`,
            configAction(url, '/admin/accounting/accounts'),
          )
        }
        if (req.method !== 'GET') return text('GET or POST', { status: 405 })
        const rows = (await ctx.call('account.listAccounts', { includeArchived: true }, url, req)) as AnyRow[]
        const editing = editTarget(rows, url)
        return adminPage(ctx, url, req, {
          title: 'account_backend.accounts.title',
          body: (_, frame) =>
            accountsScreen(_, {
              frame: frame,
              action: configAction(url, '/admin/accounting/accounts'),
              rows,
              editing,
              submit: editing ? _('account_backend.action.save') : _('account_backend.action.create'),
              rowHref: (row) => editHref(url, '/admin/accounting/accounts', row.id),
              cancelHref: `/admin/accounting/accounts${localeQuery(url)}`,
              displayName: (row) => accountName(_, row),
              errors:
                url.searchParams.get('invalid') === '1' ? [_('account_backend.error.invalid')] : undefined,
              fields: prefill(
                [
                  { name: 'code', label: _('account_backend.field.code'), required: true },
                  {
                    name: 'name',
                    label: _('account_backend.field.name'),
                    required: true,
                    // A bundled account reads under its English name in an English
                    // session, so say which name this field is editing.
                    help: editing?.nameEn
                      ? `${_('account_backend.field.nameEn')}: ${String(editing.nameEn)}`
                      : undefined,
                  },
                  {
                    name: 'accountType',
                    label: _('account_backend.field.accountType'),
                    type: 'select',
                    options: optionsOf(_, 'accountType', ACCOUNT_TYPES),
                  },
                  { name: 'reconcile', label: _('account_backend.field.reconcile'), type: 'checkbox' },
                  {
                    name: 'active',
                    label: _('account_backend.field.active'),
                    type: 'checkbox',
                    value: true,
                    help: _('account_backend.field.activeHint'),
                  },
                ],
                editing,
              ),
            }),
        })
      },
    '/admin/accounting/journals':
      (ctx): Route =>
      async (url, req) => {
        if (req.method === 'POST') {
          const form = await readForm(req)
          return resultRedirect(
            await ctx.call(
              'account.saveJournal',
              {
                id: targetId(url),
                name: form.name ?? '',
                code: form.code ?? '',
                type: form.type ?? '',
                ...optional(form, 'defaultAccountId'),
                active: form.active === '1',
              },
              url,
              req,
            ),
            `/admin/accounting/journals${localeQuery(url)}`,
            configAction(url, '/admin/accounting/journals'),
          )
        }
        if (req.method !== 'GET') return text('GET or POST', { status: 405 })
        const data = await common(ctx, url, req)
        const journals = (await ctx.call(
          'account.listJournals',
          { includeArchived: true },
          url,
          req,
        )) as AnyRow[]
        const editing = editTarget(journals, url)
        return adminPage(ctx, url, req, {
          title: 'account_backend.journals.title',
          body: async (_, frame) =>
            journalsScreen(_, {
              frame: frame,
              action: configAction(url, '/admin/accounting/journals'),
              rows: journals,
              accounts: data.accounts,
              editing,
              submit: editing ? _('account_backend.action.save') : _('account_backend.action.create'),
              rowHref: (row) => editHref(url, '/admin/accounting/journals', row.id),
              cancelHref: `/admin/accounting/journals${localeQuery(url)}`,
              displayName: (row) => accountName(_, row),
              errors:
                url.searchParams.get('invalid') === '1' ? [_('account_backend.error.invalid')] : undefined,
              fields: prefill(
                [
                  { name: 'name', label: _('account_backend.field.name'), required: true },
                  { name: 'code', label: _('account_backend.field.code'), required: true },
                  {
                    name: 'type',
                    label: _('account_backend.field.type'),
                    type: 'select',
                    options: optionsOf(_, 'journalType', JOURNAL_TYPES),
                  },
                  {
                    name: 'defaultAccountId',
                    label: _('account_backend.field.defaultAccountId'),
                    type: 'select',
                    options: accountChoices(_, data.accounts, true),
                    control: await accountRelationControl(ctx, url, req, _, {
                      id: 'journal-default-account',
                      name: 'defaultAccountId',
                      label: _('account_backend.field.defaultAccountId'),
                      accounts: accountOptions(data.accounts),
                      allowEmpty: true,
                    }),
                  },
                  {
                    name: 'active',
                    label: _('account_backend.field.active'),
                    type: 'checkbox',
                    value: true,
                    help: _('account_backend.field.activeHint'),
                  },
                ],
                editing,
              ),
            }),
        })
      },
    '/admin/accounting/taxes':
      (ctx): Route =>
      async (url, req) => {
        if (req.method === 'POST') {
          const form = await readForm(req)
          return resultRedirect(
            await ctx.call(
              'account.saveTax',
              {
                id: targetId(url),
                name: form.name ?? '',
                ...optional(form, 'description'),
                typeTaxUse: form.typeTaxUse ?? 'sale',
                amountType: form.amountType ?? 'percent',
                amount: form.amount || '0',
                priceInclude: form.priceInclude === '1',
                includeBaseAmount: form.includeBaseAmount === '1',
                ...optional(form, 'accountId'),
                sequence: Number(form.sequence || 10),
                active: form.active === '1',
              },
              url,
              req,
            ),
            `/admin/accounting/taxes${localeQuery(url)}`,
            configAction(url, '/admin/accounting/taxes'),
          )
        }
        if (req.method !== 'GET') return text('GET or POST', { status: 405 })
        const data = await common(ctx, url, req)
        const taxes = (await ctx.call('account.listTaxes', { includeArchived: true }, url, req)) as AnyRow[]
        const editing = editTarget(taxes, url)
        return adminPage(ctx, url, req, {
          title: 'account_backend.taxes.title',
          body: async (_, frame) => {
            const currency = currencyOf(data.companies, frame)
            return taxesScreen(_, {
              frame: frame,
              action: configAction(url, '/admin/accounting/taxes'),
              rows: taxes,
              accounts: data.accounts,
              currency,
              editing,
              submit: editing ? _('account_backend.action.save') : _('account_backend.action.create'),
              rowHref: (row) => editHref(url, '/admin/accounting/taxes', row.id),
              cancelHref: `/admin/accounting/taxes${localeQuery(url)}`,
              errors:
                url.searchParams.get('invalid') === '1' ? [_('account_backend.error.invalid')] : undefined,
              fields: prefill(
                [
                  { name: 'name', label: _('account_backend.field.name'), required: true },
                  { name: 'description', label: _('account_backend.field.description') },
                  {
                    name: 'typeTaxUse',
                    label: _('account_backend.field.typeTaxUse'),
                    type: 'select',
                    options: optionsOf(_, 'taxUse', TAX_USES),
                  },
                  {
                    name: 'amountType',
                    label: _('account_backend.field.amountType'),
                    type: 'select',
                    options: optionsOf(_, 'taxAmountType', TAX_AMOUNT_TYPES),
                  },
                  {
                    name: 'amount',
                    label: _('account_backend.field.amount'),
                    type: 'decimal',
                    value: 0,
                    required: true,
                  },
                  {
                    name: 'accountId',
                    label: _('account_backend.field.accountId'),
                    type: 'select',
                    options: accountChoices(_, data.accounts, true),
                    control: await accountRelationControl(ctx, url, req, _, {
                      id: 'tax-account',
                      name: 'accountId',
                      label: _('account_backend.field.accountId'),
                      accounts: accountOptions(data.accounts),
                      allowEmpty: true,
                    }),
                  },
                  { name: 'priceInclude', label: _('account_backend.field.priceInclude'), type: 'checkbox' },
                  {
                    name: 'includeBaseAmount',
                    label: _('account_backend.field.includeBaseAmount'),
                    type: 'checkbox',
                    help: _('account_backend.field.includeBaseAmountHint'),
                  },
                  {
                    name: 'sequence',
                    label: _('account_backend.field.sequence'),
                    type: 'number',
                    value: 10,
                    help: _('account_backend.field.sequenceHint'),
                  },
                  {
                    name: 'active',
                    label: _('account_backend.field.active'),
                    type: 'checkbox',
                    value: true,
                    help: _('account_backend.field.activeHint'),
                  },
                ],
                editing,
              ),
            })
          },
        })
      },
    '/admin/accounting/terms':
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
                  {
                    id: targetId(url),
                    name: form.name ?? '',
                    ...optional(form, 'note'),
                    active: form.active === '1',
                  },
                  url,
                  req,
                )
          return resultRedirect(
            result,
            `/admin/accounting/terms${localeQuery(url)}`,
            configAction(url, '/admin/accounting/terms'),
          )
        }
        if (req.method !== 'GET') return text('GET or POST', { status: 405 })
        const rows = (await ctx.call(
          'account.listPaymentTerms',
          { includeArchived: true },
          url,
          req,
        )) as AnyRow[]
        const editing = editTarget(rows, url)
        return adminPage(ctx, url, req, {
          title: 'account_backend.terms.title',
          body: (_, frame) =>
            paymentTermsScreen(_, {
              frame: frame,
              action: configAction(url, '/admin/accounting/terms'),
              rows,
              editing,
              submit: editing ? _('account_backend.action.save') : _('account_backend.action.create'),
              rowHref: (row) => editHref(url, '/admin/accounting/terms', row.id),
              cancelHref: `/admin/accounting/terms${localeQuery(url)}`,
              errors:
                url.searchParams.get('invalid') === '1' ? [_('account_backend.error.invalid')] : undefined,
              termFields: prefill(
                [
                  { name: 'name', label: _('account_backend.field.name'), required: true },
                  { name: 'note', label: _('account_backend.field.note'), type: 'textarea', span: 'full' },
                  {
                    name: 'active',
                    label: _('account_backend.field.active'),
                    type: 'checkbox',
                    value: true,
                    help: _('account_backend.field.activeHint'),
                  },
                ],
                editing,
              ),
              lineFields: rows.length
                ? [
                    {
                      name: 'paymentId',
                      label: _('account_backend.field.paymentTermId'),
                      type: 'select',
                      options: choices(rows),
                      required: true,
                    },
                    {
                      name: 'value',
                      label: _('account_backend.field.termValue'),
                      type: 'select',
                      options: optionsOf(_, 'paymentTermValue', PAYMENT_TERM_VALUES),
                    },
                    {
                      name: 'valueAmount',
                      label: _('account_backend.field.valueAmount'),
                      type: 'decimal',
                      value: 100,
                      required: true,
                    },
                    {
                      name: 'delayType',
                      label: _('account_backend.field.delayType'),
                      type: 'select',
                      options: optionsOf(_, 'paymentTermDelay', PAYMENT_TERM_DELAY_TYPES),
                    },
                    {
                      name: 'nbDays',
                      label: _('account_backend.field.nbDays'),
                      type: 'number',
                      value: 0,
                      required: true,
                    },
                    {
                      name: 'daysNextMonth',
                      label: _('account_backend.field.daysNextMonth'),
                      type: 'number',
                    },
                    {
                      name: 'sequence',
                      label: _('account_backend.field.sequence'),
                      type: 'number',
                      value: 10,
                    },
                  ]
                : undefined,
            }),
        })
      },
    '/admin/accounting/entries':
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
            `/admin/accounting/entries${localeQuery(url)}`,
          )
        }
        if (req.method !== 'GET') return text('GET or POST', { status: 405 })
        const state = url.searchParams.get('state')
        const rows = (await ctx.call(
          'account.listMoves',
          { moveType: 'entry', ...(state ? { state } : {}), limit: LIST_PAGE },
          url,
          req,
        )) as AnyRow[]
        return adminPage(ctx, url, req, {
          title: 'account_backend.entries.title',
          body: async (_, frame) =>
            journalEntriesScreen(_, {
              frame: frame,
              action: `/admin/accounting/entries${localeQuery(url)}`,
              fields: await moveFields(ctx, url, req, _, data, ['entry']),
              rows,
              locale: localeQuery(url),
              errors:
                url.searchParams.get('invalid') === '1' ? [_('account_backend.error.invalid')] : undefined,
            }),
        })
      },
    '/admin/accounting/customer-invoices':
      (ctx): Route =>
      async (url, req) => {
        const data = await common(ctx, url, req)
        if (req.method === 'POST')
          return createInvoice(ctx, url, req, `/admin/accounting/customer-invoices${localeQuery(url)}`)
        if (req.method !== 'GET') return text('GET or POST', { status: 405 })
        const rows = (await ctx.call(
          'account.listMoves',
          { moveTypes: ['out_invoice', 'out_refund', 'out_receipt'], limit: LIST_PAGE },
          url,
          req,
        )) as AnyRow[]
        return adminPage(ctx, url, req, {
          title: 'account_backend.customerInvoices.title',
          body: async (_, frame) =>
            customerInvoicesScreen(_, {
              frame: frame,
              action: `/admin/accounting/customer-invoices${localeQuery(url)}`,
              fields: await invoiceFields(ctx, url, req, _, data, [
                'out_invoice',
                'out_refund',
                'out_receipt',
              ]),
              rows,
              locale: localeQuery(url),
              errors:
                url.searchParams.get('invalid') === '1' ? [_('account_backend.error.invalid')] : undefined,
            }),
        })
      },
    '/admin/accounting/vendor-bills':
      (ctx): Route =>
      async (url, req) => {
        const data = await common(ctx, url, req)
        if (req.method === 'POST')
          return createInvoice(ctx, url, req, `/admin/accounting/vendor-bills${localeQuery(url)}`)
        if (req.method !== 'GET') return text('GET or POST', { status: 405 })
        const rows = (await ctx.call(
          'account.listMoves',
          { moveTypes: ['in_invoice', 'in_refund', 'in_receipt'], limit: LIST_PAGE },
          url,
          req,
        )) as AnyRow[]
        return adminPage(ctx, url, req, {
          title: 'account_backend.vendorBills.title',
          body: async (_, frame) =>
            vendorBillsScreen(_, {
              frame: frame,
              action: `/admin/accounting/vendor-bills${localeQuery(url)}`,
              fields: await invoiceFields(ctx, url, req, _, data, ['in_invoice', 'in_refund', 'in_receipt']),
              rows,
              locale: localeQuery(url),
              errors:
                url.searchParams.get('invalid') === '1' ? [_('account_backend.error.invalid')] : undefined,
            }),
        })
      },
    '/admin/accounting/entries/{id}': accountMoveRoute,
    '/admin/accounting/customer-invoices/{id}': accountMoveRoute,
    '/admin/accounting/vendor-bills/{id}': accountMoveRoute,
    '/admin/accounting/payments':
      (ctx): Route =>
      async (url, req) => {
        const [data, openItems] = await Promise.all([
          common(ctx, url, req),
          ctx.call('account.listOpenItems', { limit: LIST_PAGE }, url, req) as Promise<AnyRow[]>,
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
            `/admin/accounting/payments${localeQuery(url)}`,
          )
        }
        if (req.method !== 'GET') return text('GET or POST', { status: 405 })
        const rows = (await ctx.call('account.listPayments', { limit: LIST_PAGE }, url, req)) as AnyRow[]
        return adminPage(ctx, url, req, {
          title: 'account_backend.payments.title',
          body: async (_, frame) =>
            paymentsScreen(_, {
              frame: frame,
              action: `/admin/accounting/payments${localeQuery(url)}`,
              rows,
              openItems: openItems.length,
              errors:
                url.searchParams.get('invalid') === '1' ? [_('account_backend.error.invalid')] : undefined,
              fields: [
                { name: 'name', label: _('account_backend.field.name'), required: true },
                {
                  name: 'paymentType',
                  label: _('account_backend.field.paymentType'),
                  type: 'select',
                  options: optionsOf(_, 'paymentType', PAYMENT_TYPES),
                },
                {
                  name: 'partnerType',
                  label: _('account_backend.field.partnerType'),
                  type: 'select',
                  options: optionsOf(_, 'partnerType', PARTNER_TYPES),
                },
                {
                  name: 'partnerId',
                  label: _('account_backend.field.partnerId'),
                  type: 'select',
                  options: choices(data.partners, true),
                },
                {
                  name: 'journalId',
                  label: _('account_backend.field.journalId'),
                  type: 'select',
                  options: choices(
                    data.journals.filter((journal) => ['bank', 'cash'].includes(String(journal.type))),
                  ),
                  required: true,
                },
                {
                  name: 'destinationAccountId',
                  label: _('account_backend.field.destinationAccountId'),
                  type: 'select',
                  options: choices(data.accounts),
                  required: true,
                  control: await accountRelationControl(ctx, url, req, _, {
                    id: 'payment-destination-account',
                    name: 'destinationAccountId',
                    label: _('account_backend.field.destinationAccountId'),
                    accounts: accountOptions(data.accounts),
                    required: true,
                  }),
                },
                {
                  name: 'amount',
                  label: _('account_backend.field.amount'),
                  type: 'decimal',
                  value: 0,
                  required: true,
                },
                { name: 'date', label: _('account_backend.field.date'), type: 'date' },
                { name: 'memo', label: _('account_backend.field.memo') },
                { name: 'paymentReference', label: _('account_backend.field.paymentReference') },
                {
                  name: 'reconcileLineId',
                  label: _('account_backend.field.reconcileLineId'),
                  type: 'select',
                  options: [
                    { value: '', label: '—' },
                    ...openItems.map((line) => ({
                      value: String(line.id),
                      label: `${String((line.move as AnyRow)?.name ?? line.moveId)} · ${String(line.accountId)} · ${formatMoney(_, line.amountResidual, (line.move as AnyRow)?.currency)}`,
                    })),
                  ],
                },
              ],
            }),
        })
      },
    '/admin/accounting/trial-balance':
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
        return adminPage(ctx, url, req, {
          title: 'account_backend.trialBalance.title',
          body: (_, frame) => {
            const currency = currencyOf(companies, frame)
            return trialBalanceScreen(_, {
              frame: frame,
              action: `/admin/accounting/trial-balance${localeQuery(url)}`,
              rows,
              currency,
              fields: [
                { name: 'dateFrom', label: _('account_backend.field.dateFrom'), value: dateFrom },
                { name: 'dateTo', label: _('account_backend.field.dateTo'), value: dateTo },
              ],
            })
          },
        })
      },
    '/admin/accounting/general-ledger':
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
            limit: LIST_PAGE,
          },
          url,
          req,
        )) as AnyRow[]
        return adminPage(ctx, url, req, {
          title: 'account_backend.generalLedger.title',
          body: async (_, frame) => {
            const currency = currencyOf(data.companies, frame)
            return generalLedgerScreen(_, {
              frame: frame,
              action: `/admin/accounting/general-ledger${localeQuery(url)}`,
              rows,
              currency,
              fields: [
                {
                  name: 'accountId',
                  label: _('account_backend.field.accountId'),
                  type: 'select',
                  value: accountId,
                  options: choices(data.accounts, true),
                  control: await accountRelationControl(ctx, url, req, _, {
                    id: 'general-ledger-account',
                    name: 'accountId',
                    label: _('account_backend.field.accountId'),
                    value: accountId,
                    accounts: accountOptions(data.accounts),
                    allowEmpty: true,
                  }),
                },
                {
                  name: 'dateFrom',
                  label: _('account_backend.field.dateFrom'),
                  type: 'date',
                  value: dateFrom,
                },
                { name: 'dateTo', label: _('account_backend.field.dateTo'), type: 'date', value: dateTo },
              ],
            })
          },
        })
      },
    '/admin/accounting/partner-statement':
      (ctx): Route =>
      async (url, req) => {
        if (req.method !== 'GET') return text('GET', { status: 405 })
        const data = await common(ctx, url, req)
        const partnerId = url.searchParams.get('partnerId') ?? ''
        const rows = partnerId
          ? ((await ctx.call(
              'account.partnerStatement',
              { partnerId, limit: LIST_PAGE },
              url,
              req,
            )) as AnyRow[])
          : []
        return adminPage(ctx, url, req, {
          title: 'account_backend.partnerStatement.title',
          body: (_, frame) => {
            const currency = currencyOf(data.companies, frame)
            return partnerLedgerScreen(_, {
              frame: frame,
              action: `/admin/accounting/partner-statement${localeQuery(url)}`,
              rows,
              currency,
              selected: Boolean(partnerId),
              fields: [
                {
                  name: 'partnerId',
                  label: _('account_backend.field.partnerId'),
                  type: 'select',
                  value: partnerId,
                  options: choices(data.partners, true),
                },
              ],
            })
          },
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
  'dashboard.kicker': 'Không gian tài chính',
  'dashboard.subtitle': 'Theo dõi chứng từ, công nợ, báo cáo và cấu hình kế toán tại một nơi.',
  'dashboard.draft': 'Bút toán nháp',
  'dashboard.posted': 'Bút toán đã ghi sổ',
  'dashboard.unpaid': 'Chứng từ chưa thanh toán',
  'dashboard.records': 'Bản ghi',
  'dashboard.reports': 'Báo cáo tài chính',
  'dashboard.reportsHint': 'Mở các báo cáo sổ cái và công nợ đã ghi sổ.',
  'dashboard.operations': 'Nghiệp vụ hằng ngày',
  'dashboard.operationsHint': 'Tạo và theo dõi hoá đơn, bút toán và thanh toán.',
  'dashboard.configurationHint': 'Quản lý nền tảng dùng khi ghi sổ chứng từ.',
  'dashboard.customerInvoicesHint': 'Hoá đơn bán hàng và phần công nợ chưa thanh toán.',
  'dashboard.vendorBillsHint': 'Chứng từ mua hàng và nghĩa vụ phải trả nhà cung cấp.',
  'dashboard.entriesHint': 'Bút toán nháp và đã ghi sổ trong sổ nhật ký.',
  'dashboard.paymentsHint': 'Khoản thu, chi và đối soát công nợ.',
  'dashboard.trialBalanceHint': 'Đối chiếu tổng phát sinh Nợ và Có theo tài khoản.',
  'dashboard.generalLedgerHint': 'Xem chi tiết phát sinh trên từng tài khoản.',
  'dashboard.partnerLedgerHint': 'Theo dõi công nợ phải thu, phải trả theo đối tác.',
  'dashboard.accountsHint': 'Hệ thống tài khoản Việt Nam theo Thông tư 99/2025/TT-BTC.',
  'dashboard.journalsHint': 'Phân loại và đánh số chứng từ kế toán.',
  'dashboard.taxesHint': 'Cấu hình phạm vi và cách tính thuế.',
  'dashboard.paymentTermsHint': 'Lịch thanh toán dùng cho hoá đơn và công nợ.',
  'accounts.title': 'Hệ thống tài khoản',
  'account.kicker': 'Cấu hình sổ cái',
  'account.subtitle': 'Quản lý hệ thống mã và loại tài khoản.',
  'account.summary.total': 'Tổng tài khoản',
  'account.summary.asset': 'Tài sản',
  'account.summary.liability': 'Nợ và vốn',
  'account.summary.profit': 'Kết quả kinh doanh',
  'account.create.title': 'Tạo tài khoản',
  'account.create.hint': 'Mã phải duy nhất trong công ty; loại tài khoản quyết định hành vi báo cáo.',
  'account.list.title': 'Hệ thống tài khoản hiện có',
  'account.list.hint': 'Kiểm tra mã, loại và khả năng đối soát của từng tài khoản.',
  'account.empty': 'Chưa có tài khoản',
  'account.emptyHint': 'Tạo tài khoản đầu tiên để cấu hình sổ cái.',
  'journals.title': 'Sổ nhật ký',
  'journal.kicker': 'Cấu hình ghi sổ',
  'journal.subtitle': 'Tổ chức chứng từ theo loại sổ nhật ký.',
  'journal.summary.total': 'Tổng sổ',
  'journal.summary.sale': 'Bán hàng',
  'journal.summary.purchase': 'Mua hàng',
  'journal.summary.liquidity': 'Ngân hàng và tiền mặt',
  'journal.create.title': 'Tạo sổ nhật ký',
  'journal.create.hint': 'Mã là duy nhất; sổ ngân hàng và tiền mặt cần tài khoản thanh khoản mặc định.',
  'journal.list.title': 'Sổ nhật ký hiện có',
  'journal.list.hint': 'Kiểm tra mã, loại và tài khoản mặc định dùng khi ghi sổ.',
  'journal.empty': 'Chưa có sổ nhật ký',
  'journal.emptyHint': 'Tạo sổ đầu tiên để bắt đầu phân loại chứng từ.',
  'taxes.title': 'Thuế',
  'tax.kicker': 'Cấu hình thuế',
  'tax.subtitle': 'Quản lý phạm vi và cách tính thuế theo mã ổn định.',
  'tax.summary.total': 'Tổng sắc thuế',
  'tax.summary.sale': 'Bán hàng',
  'tax.summary.purchase': 'Mua hàng',
  'tax.summary.included': 'Đã gồm trong giá',
  'tax.create.title': 'Tạo thuế',
  'tax.create.hint': 'Chọn phạm vi sử dụng, cách tính và nhập số tiền hoặc tỷ lệ.',
  'tax.list.title': 'Thuế hiện có',
  'tax.list.hint': 'Kiểm tra phạm vi, phép tính, giá trị và chính sách bao gồm trong giá.',
  'tax.empty': 'Chưa có thuế',
  'tax.emptyHint': 'Tạo sắc thuế đầu tiên để áp dụng trên chứng từ.',
  'terms.title': 'Điều khoản thanh toán',
  'term.kicker': 'Lịch thanh toán',
  'term.subtitle': 'Cấu hình các mốc đến hạn thanh toán.',
  'term.summary.total': 'Tổng điều khoản',
  'term.summary.configured': 'Đã có mốc',
  'term.summary.lines': 'Tổng số mốc',
  'term.create.title': 'Tạo điều khoản thanh toán',
  'term.create.hint': 'Đặt tên và ghi chú hiển thị trên chứng từ.',
  'term.line.create.title': 'Thêm mốc đến hạn',
  'term.line.create.hint': 'Phân bổ phần trăm hoặc số tiền và chọn cách tính ngày đến hạn.',
  'term.list.title': 'Điều khoản hiện có',
  'term.list.hint': 'Kiểm tra số mốc đến hạn và ghi chú của từng điều khoản.',
  'term.empty': 'Chưa có điều khoản thanh toán',
  'term.emptyHint': 'Tạo điều khoản đầu tiên, sau đó thêm các mốc đến hạn.',
  'entries.title': 'Bút toán',
  'entry.kicker': 'Sổ cái',
  'entry.subtitle': 'Ghi nhận và kiểm soát các bút toán kế toán thủ công.',
  'entry.summary.total': 'Tổng bút toán',
  'entry.summary.draft': 'Bản nháp',
  'entry.summary.posted': 'Đã ghi sổ',
  'entry.create.title': 'Tạo bút toán',
  'entry.create.hint': 'Chọn sổ nhật ký, ngày và tham chiếu trước khi thêm các dòng Nợ/Có.',
  'entry.list.title': 'Bút toán hiện có',
  'entry.list.hint': 'Mở bút toán để thêm dòng, kiểm tra cân đối và ghi sổ.',
  'entry.empty': 'Chưa có bút toán',
  'entry.emptyHint': 'Tạo bút toán đầu tiên để bắt đầu ghi nhận vào sổ cái.',
  'customerInvoices.title': 'Hoá đơn khách hàng',
  'customerInvoice.kicker': 'Công nợ khách hàng',
  'customerInvoice.subtitle': 'Lập, kiểm tra và theo dõi thanh toán hoá đơn bán hàng.',
  'customerInvoice.summary.total': 'Tổng hoá đơn',
  'customerInvoice.summary.draft': 'Bản nháp',
  'customerInvoice.summary.posted': 'Đã ghi sổ',
  'customerInvoice.summary.unpaid': 'Chưa thanh toán',
  'customerInvoice.create.title': 'Tạo hoá đơn khách hàng',
  'customerInvoice.create.hint': 'Nhập khách hàng, dòng doanh thu, thuế và tài khoản phải thu.',
  'customerInvoice.list.title': 'Hoá đơn khách hàng hiện có',
  'customerInvoice.list.hint': 'Mở chứng từ để kiểm tra dòng, ghi sổ, theo dõi thanh toán và trao đổi.',
  'customerInvoice.empty': 'Chưa có hoá đơn khách hàng',
  'customerInvoice.emptyHint': 'Tạo hoá đơn đầu tiên để bắt đầu theo dõi công nợ phải thu.',
  'vendorBills.title': 'Hoá đơn nhà cung cấp',
  'vendorBill.kicker': 'Công nợ nhà cung cấp',
  'vendorBill.subtitle': 'Ghi nhận, kiểm tra và theo dõi thanh toán hoá đơn mua hàng.',
  'vendorBill.summary.total': 'Tổng hoá đơn',
  'vendorBill.summary.draft': 'Bản nháp',
  'vendorBill.summary.posted': 'Đã ghi sổ',
  'vendorBill.summary.unpaid': 'Chưa thanh toán',
  'vendorBill.create.title': 'Tạo hoá đơn nhà cung cấp',
  'vendorBill.create.hint': 'Nhập chứng từ, nhà cung cấp, dòng chi phí và tài khoản phải trả.',
  'vendorBill.list.title': 'Hoá đơn hiện có',
  'vendorBill.list.hint': 'Mở một chứng từ để kiểm tra dòng bút toán, ghi sổ hoặc theo dõi thanh toán.',
  'vendorBill.empty': 'Chưa có hoá đơn nhà cung cấp',
  'vendorBill.emptyHint': 'Tạo hoá đơn đầu tiên để bắt đầu theo dõi công nợ phải trả.',
  'error.invalid': 'Dữ liệu chưa hợp lệ. Kiểm tra các trường bắt buộc và thử lại.',
  'relation.accounts': 'Hệ thống tài khoản',
  'relation.partners': 'Danh bạ đối tác',
  'payments.title': 'Thanh toán',
  'payment.kicker': 'Ngân hàng và tiền mặt',
  'payment.subtitle': 'Ghi nhận tiền thu, tiền chi và đối soát công nợ mở.',
  'payment.summary.total': 'Tổng thanh toán',
  'payment.summary.inbound': 'Tiền thu',
  'payment.summary.outbound': 'Tiền chi',
  'payment.summary.open': 'Khoản mở',
  'payment.create.title': 'Ghi nhận thanh toán',
  'payment.create.hint': 'Chọn luồng tiền, đối tác, sổ tiền và tài khoản công nợ phù hợp.',
  'payment.list.title': 'Thanh toán đã ghi nhận',
  'payment.list.hint': 'Theo dõi chiều thanh toán, giá trị và trạng thái ghi sổ.',
  'payment.empty': 'Chưa có thanh toán',
  'payment.emptyHint': 'Ghi nhận khoản thu hoặc chi đầu tiên để bắt đầu theo dõi dòng tiền.',
  'trialBalance.title': 'Bảng cân đối thử',
  'trial.kicker': 'Báo cáo sổ cái',
  'trial.subtitle': 'Đối chiếu tổng phát sinh Nợ và Có theo tài khoản trong kỳ.',
  'trial.summary.debit': 'Tổng Nợ',
  'trial.summary.credit': 'Tổng Có',
  'trial.summary.balance': 'Chênh lệch',
  'trial.filter.title': 'Kỳ báo cáo',
  'trial.filter.hint': 'Để trống ngày để tính trên toàn bộ bút toán đã ghi sổ.',
  'trial.result.title': 'Số dư theo tài khoản',
  'trial.result.hint': 'Tổng Nợ và Có phải cân bằng trên toàn bộ hệ thống tài khoản.',
  'trial.empty': 'Không có số liệu trong kỳ',
  'trial.emptyHint': 'Thay đổi khoảng ngày hoặc ghi sổ các bút toán trước khi tính lại.',
  'generalLedger.title': 'Sổ cái',
  'ledger.kicker': 'Chi tiết sổ cái',
  'ledger.subtitle': 'Theo dõi phát sinh Nợ và Có của từng tài khoản theo kỳ.',
  'ledger.summary.lines': 'Dòng bút toán',
  'ledger.summary.debit': 'Tổng Nợ',
  'ledger.summary.credit': 'Tổng Có',
  'ledger.filter.title': 'Bộ lọc sổ cái',
  'ledger.filter.hint': 'Chọn một tài khoản hoặc để trống để xem toàn bộ dòng đã ghi sổ.',
  'ledger.result.title': 'Chi tiết phát sinh',
  'ledger.result.hint': 'Mỗi dòng liên kết phát sinh với bút toán và ngày ghi sổ.',
  'ledger.empty': 'Không có phát sinh phù hợp',
  'ledger.emptyHint': 'Thay đổi tài khoản hoặc khoảng ngày để xem dữ liệu khác.',
  'partnerStatement.title': 'Sổ đối tác',
  'partnerLedger.kicker': 'Công nợ đối tác',
  'partnerLedger.subtitle': 'Theo dõi phát sinh phải thu, phải trả và số còn lại theo đối tác.',
  'partnerLedger.summary.debit': 'Tổng Nợ',
  'partnerLedger.summary.credit': 'Tổng Có',
  'partnerLedger.summary.residual': 'Còn lại',
  'partnerLedger.filter.title': 'Chọn đối tác',
  'partnerLedger.filter.hint': 'Báo cáo chỉ bao gồm tài khoản phải thu và phải trả trên bút toán đã ghi sổ.',
  'partnerLedger.result.title': 'Chi tiết công nợ',
  'partnerLedger.result.hint': 'Theo dõi chứng từ, phát sinh Nợ/Có và phần chưa đối soát.',
  'partnerLedger.select': 'Chưa chọn đối tác',
  'partnerLedger.selectHint': 'Chọn một đối tác để xem sổ công nợ.',
  'partnerLedger.empty': 'Đối tác chưa có phát sinh',
  'partnerLedger.emptyHint': 'Đối tác đã chọn không có bút toán phải thu hoặc phải trả đã ghi sổ.',
  'lines.title': 'Dòng bút toán',
  'lines.add': 'Thêm dòng bút toán',
  'move.kicker': 'Chứng từ kế toán',
  'move.actions': 'Hành động trên chứng từ',
  'move.collaboration': 'Trao đổi và hoạt động của chứng từ',
  'terms.lines': 'Số mốc thanh toán',
  'action.create': 'Tạo mới',
  'action.save': 'Lưu thay đổi',
  'action.cancelEdit': 'Thôi sửa',
  'action.createTerm': 'Tạo điều khoản',
  'action.addTermLine': 'Thêm mốc thanh toán',
  'action.addLine': 'Thêm dòng',
  'action.post': 'Ghi sổ',
  'action.cancel': 'Huỷ',
  'action.reverse': 'Đảo bút toán',
  'action.registerPayment': 'Ghi nhận thanh toán',
  'action.calculate': 'Tính báo cáo',
  active: 'Đang dùng',
  archived: 'Đã lưu trữ',
  'column.includeBaseAmount': 'Cộng vào cơ sở',
  'account.edit.title': 'Sửa tài khoản',
  'journal.edit.title': 'Sửa sổ nhật ký',
  'tax.edit.title': 'Sửa thuế',
  'term.edit.title': 'Sửa điều khoản thanh toán',
  'field.code': 'Mã',
  'field.name': 'Tên',
  'field.nameEn': 'Tên tiếng Anh theo chế độ kế toán',
  'field.active': 'Đang sử dụng',
  'field.activeHint': 'Bỏ chọn để lưu trữ. Bản ghi đã lưu trữ không còn xuất hiện trong danh sách chọn.',
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
  'field.paymentAmount': 'Số tiền',
  'field.priceInclude': 'Đã gồm trong giá',
  'field.includeBaseAmount': 'Cộng vào cơ sở tính thuế',
  'field.includeBaseAmountHint':
    'Số thuế này được cộng vào cơ sở tính của các thuế đứng sau nó. Dùng cho thuế nhập khẩu, khi thuế GTGT hàng nhập khẩu tính trên giá đã gồm thuế nhập khẩu.',
  'field.sequenceHint': 'Thuế trên cùng một dòng được áp dụng theo thứ tự tăng dần của số này.',
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
  'field.secondTaxId': 'Thuế thứ hai',
  'field.secondTaxIdHint': 'Để trống nếu dòng chỉ chịu một loại thuế.',
  'field.taxAccountId': 'Tài khoản thuế',
  'field.taxAccountIdHint':
    'Chỉ dùng khi dòng có đúng một loại thuế. Với nhiều thuế, mỗi thuế hạch toán vào tài khoản đã cấu hình của nó.',
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
  'dashboard.kicker': 'Finance workspace',
  'dashboard.subtitle': 'Track documents, balances, reports, and accounting configuration in one place.',
  'dashboard.draft': 'Draft entries',
  'dashboard.posted': 'Posted entries',
  'dashboard.unpaid': 'Unpaid documents',
  'dashboard.records': 'Records',
  'dashboard.reports': 'Financial reports',
  'dashboard.reportsHint': 'Open posted ledger and receivable or payable reports.',
  'dashboard.operations': 'Daily operations',
  'dashboard.operationsHint': 'Create and track invoices, journal entries, and payments.',
  'dashboard.configurationHint': 'Manage the foundations used when posting documents.',
  'dashboard.customerInvoicesHint': 'Sales invoices and outstanding customer balances.',
  'dashboard.vendorBillsHint': 'Purchase documents and supplier obligations.',
  'dashboard.entriesHint': 'Draft and posted entries across accounting journals.',
  'dashboard.paymentsHint': 'Inbound, outbound, and reconciled payments.',
  'dashboard.trialBalanceHint': 'Compare total debit and credit movements by account.',
  'dashboard.generalLedgerHint': 'Inspect posted movements on an individual account.',
  'dashboard.partnerLedgerHint': 'Track receivable and payable balances by partner.',
  'dashboard.accountsHint': 'Vietnam chart of accounts under Circular 99/2025/TT-BTC.',
  'dashboard.journalsHint': 'Classify and sequence accounting documents.',
  'dashboard.taxesHint': 'Configure tax scope and calculation methods.',
  'dashboard.paymentTermsHint': 'Payment schedules used by invoices and balances.',
  'accounts.title': 'Chart of accounts',
  'account.kicker': 'Ledger configuration',
  'account.subtitle': 'Manage account codes and account types.',
  'account.summary.total': 'Total accounts',
  'account.summary.asset': 'Assets',
  'account.summary.liability': 'Liabilities & equity',
  'account.summary.profit': 'Profit & loss',
  'account.create.title': 'Create an account',
  'account.create.hint': 'The code is unique per company; account type determines reporting behavior.',
  'account.list.title': 'Current chart of accounts',
  'account.list.hint': 'Review the code, type, and reconciliation behavior of each account.',
  'account.empty': 'No accounts yet',
  'account.emptyHint': 'Create the first account to configure the general ledger.',
  'journals.title': 'Journals',
  'journal.kicker': 'Posting configuration',
  'journal.subtitle': 'Organize documents with journal types.',
  'journal.summary.total': 'Total journals',
  'journal.summary.sale': 'Sales',
  'journal.summary.purchase': 'Purchases',
  'journal.summary.liquidity': 'Bank & cash',
  'journal.create.title': 'Create a journal',
  'journal.create.hint': 'The code is unique; bank and cash journals need a default liquidity account.',
  'journal.list.title': 'Current journals',
  'journal.list.hint': 'Review the code, type, and default account used for posting.',
  'journal.empty': 'No journals yet',
  'journal.emptyHint': 'Create the first journal to start classifying documents.',
  'taxes.title': 'Taxes',
  'tax.kicker': 'Tax configuration',
  'tax.subtitle': 'Manage tax scope and computation with stable selection codes.',
  'tax.summary.total': 'Total taxes',
  'tax.summary.sale': 'Sales',
  'tax.summary.purchase': 'Purchases',
  'tax.summary.included': 'Price included',
  'tax.create.title': 'Create a tax',
  'tax.create.hint': 'Choose the use, computation, and enter an amount or rate.',
  'tax.list.title': 'Current taxes',
  'tax.list.hint': 'Review use, computation, value, and price-included behavior.',
  'tax.empty': 'No taxes yet',
  'tax.emptyHint': 'Create the first tax to apply it on documents.',
  'terms.title': 'Payment terms',
  'term.kicker': 'Payment schedule',
  'term.subtitle': 'Configure payment due milestones.',
  'term.summary.total': 'Total terms',
  'term.summary.configured': 'With milestones',
  'term.summary.lines': 'Total milestones',
  'term.create.title': 'Create a payment term',
  'term.create.hint': 'Set the name and note shown on documents.',
  'term.line.create.title': 'Add a due milestone',
  'term.line.create.hint': 'Allocate a percentage or fixed amount and choose the due-date computation.',
  'term.list.title': 'Current payment terms',
  'term.list.hint': 'Review milestone counts and notes for every term.',
  'term.empty': 'No payment terms yet',
  'term.emptyHint': 'Create the first term, then add its due milestones.',
  'entries.title': 'Journal entries',
  'entry.kicker': 'General ledger',
  'entry.subtitle': 'Record and control manual accounting journal entries.',
  'entry.summary.total': 'Total entries',
  'entry.summary.draft': 'Draft',
  'entry.summary.posted': 'Posted',
  'entry.create.title': 'Create a journal entry',
  'entry.create.hint': 'Choose the journal, date, and reference before adding debit and credit lines.',
  'entry.list.title': 'Current journal entries',
  'entry.list.hint': 'Open an entry to add lines, review balance, and post it.',
  'entry.empty': 'No journal entries yet',
  'entry.emptyHint': 'Create the first entry to start recording in the general ledger.',
  'customerInvoices.title': 'Customer invoices',
  'customerInvoice.kicker': 'Customer receivables',
  'customerInvoice.subtitle': 'Create, review, and track payment of sales invoices.',
  'customerInvoice.summary.total': 'Total invoices',
  'customerInvoice.summary.draft': 'Draft',
  'customerInvoice.summary.posted': 'Posted',
  'customerInvoice.summary.unpaid': 'Unpaid',
  'customerInvoice.create.title': 'Create a customer invoice',
  'customerInvoice.create.hint': 'Enter the customer, revenue line, tax, and receivable account.',
  'customerInvoice.list.title': 'Current customer invoices',
  'customerInvoice.list.hint': 'Open a document to review lines, post it, track payment, and collaborate.',
  'customerInvoice.empty': 'No customer invoices yet',
  'customerInvoice.emptyHint': 'Create the first invoice to start tracking accounts receivable.',
  'vendorBills.title': 'Vendor bills',
  'vendorBill.kicker': 'Vendor payable',
  'vendorBill.subtitle': 'Record, review, and track payment of purchase invoices.',
  'vendorBill.summary.total': 'Total bills',
  'vendorBill.summary.draft': 'Draft',
  'vendorBill.summary.posted': 'Posted',
  'vendorBill.summary.unpaid': 'Unpaid',
  'vendorBill.create.title': 'Create a vendor bill',
  'vendorBill.create.hint': 'Enter the document, vendor, expense line, and payable account.',
  'vendorBill.list.title': 'Current vendor bills',
  'vendorBill.list.hint': 'Open a document to review journal items, post it, or track payment.',
  'vendorBill.empty': 'No vendor bills yet',
  'vendorBill.emptyHint': 'Create the first bill to start tracking accounts payable.',
  'error.invalid': 'The form is invalid. Check required fields and try again.',
  'relation.accounts': 'Chart of accounts',
  'relation.partners': 'Partner directory',
  'payments.title': 'Payments',
  'payment.kicker': 'Bank and cash',
  'payment.subtitle': 'Record receipts, disbursements, and reconciliation against open items.',
  'payment.summary.total': 'Total payments',
  'payment.summary.inbound': 'Receipts',
  'payment.summary.outbound': 'Disbursements',
  'payment.summary.open': 'Open items',
  'payment.create.title': 'Register a payment',
  'payment.create.hint': 'Choose the cash direction, partner, liquidity journal, and matching account.',
  'payment.list.title': 'Recorded payments',
  'payment.list.hint': 'Review payment direction, value, and posting status.',
  'payment.empty': 'No payments yet',
  'payment.emptyHint': 'Register the first receipt or disbursement to start tracking cash flow.',
  'trialBalance.title': 'Trial balance',
  'trial.kicker': 'General ledger report',
  'trial.subtitle': 'Reconcile total debits and credits by account for the period.',
  'trial.summary.debit': 'Total debit',
  'trial.summary.credit': 'Total credit',
  'trial.summary.balance': 'Difference',
  'trial.filter.title': 'Reporting period',
  'trial.filter.hint': 'Leave dates blank to calculate across all posted entries.',
  'trial.result.title': 'Balances by account',
  'trial.result.hint': 'Total debit and credit must balance across the chart of accounts.',
  'trial.empty': 'No figures for this period',
  'trial.emptyHint': 'Change the dates or post journal entries before recalculating.',
  'generalLedger.title': 'General ledger',
  'ledger.kicker': 'Ledger detail',
  'ledger.subtitle': 'Track debit and credit movements by account and period.',
  'ledger.summary.lines': 'Journal items',
  'ledger.summary.debit': 'Total debit',
  'ledger.summary.credit': 'Total credit',
  'ledger.filter.title': 'Ledger filters',
  'ledger.filter.hint': 'Choose an account or leave it blank to show all posted journal items.',
  'ledger.result.title': 'Account movements',
  'ledger.result.hint': 'Each item relates the movement to its journal entry and posting date.',
  'ledger.empty': 'No matching movements',
  'ledger.emptyHint': 'Change the account or date range to view other data.',
  'partnerStatement.title': 'Partner ledger',
  'partnerLedger.kicker': 'Partner receivables and payables',
  'partnerLedger.subtitle': 'Track receivable, payable, and residual movements by partner.',
  'partnerLedger.summary.debit': 'Total debit',
  'partnerLedger.summary.credit': 'Total credit',
  'partnerLedger.summary.residual': 'Residual',
  'partnerLedger.filter.title': 'Select a partner',
  'partnerLedger.filter.hint': 'The report includes only posted receivable and payable journal items.',
  'partnerLedger.result.title': 'Partner movements',
  'partnerLedger.result.hint': 'Review documents, debit/credit movements, and unreconciled amounts.',
  'partnerLedger.select': 'No partner selected',
  'partnerLedger.selectHint': 'Choose a partner to view its ledger.',
  'partnerLedger.empty': 'No partner movements',
  'partnerLedger.emptyHint': 'The selected partner has no posted receivable or payable items.',
  'lines.title': 'Journal items',
  'lines.add': 'Add journal item',
  'move.kicker': 'Accounting document',
  'move.actions': 'Document actions',
  'move.collaboration': 'Document conversation and activities',
  'terms.lines': 'Due milestones',
  'action.create': 'Create',
  'action.save': 'Save changes',
  'action.cancelEdit': 'Stop editing',
  'action.createTerm': 'Create term',
  'action.addTermLine': 'Add due milestone',
  'action.addLine': 'Add line',
  'action.post': 'Post',
  'action.cancel': 'Cancel',
  'action.reverse': 'Reverse entry',
  'action.registerPayment': 'Register payment',
  'action.calculate': 'Calculate',
  active: 'Active',
  archived: 'Archived',
  'account.edit.title': 'Edit account',
  'column.includeBaseAmount': 'Affects base',
  'journal.edit.title': 'Edit journal',
  'tax.edit.title': 'Edit tax',
  'term.edit.title': 'Edit payment term',
  'field.code': 'Code',
  'field.name': 'Name',
  'field.nameEn': 'Statutory English name',
  'field.active': 'In use',
  'field.activeHint': 'Clear to archive. An archived record no longer appears in selection lists.',
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
  'field.paymentAmount': 'Amount',
  'field.priceInclude': 'Included in price',
  'field.includeBaseAmount': 'Affects tax base',
  'field.includeBaseAmountHint':
    'This tax is added to the base every later tax is computed on. Import duty uses it, so import VAT applies to the price plus the duty.',
  'field.sequenceHint': 'Taxes on one line apply in ascending order of this number.',
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
  'field.secondTaxId': 'Second tax',
  'field.secondTaxIdHint': 'Leave empty when the line carries a single tax.',
  'field.taxAccountId': 'Tax account',
  'field.taxAccountIdHint':
    'Only used when the line carries exactly one tax. With several, each tax posts to its own configured account.',
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
