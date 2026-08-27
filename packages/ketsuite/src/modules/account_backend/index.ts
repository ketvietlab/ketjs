import { randomUUID } from 'node:crypto'
import { defineModule, text } from '@ketvietlab/ketjs'
import type { Route, ServeContext } from '@ketvietlab/ketjs'
import type { FormField, Frame } from '../../ui/index.ts'
import { formatMoney, modalWorkspace } from '../../ui/index.ts'
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
import { accountDefaultsScreen } from './account-defaults-screen.tsx'
import {
  accountFormModal,
  accountingOverviewScreen,
  accountsListScreen,
  journalFormModal,
  journalsListScreen,
  labelOf,
  moveTitle,
  optionsOf,
  taxFormScreen,
  taxesListScreen,
} from './screens/index.ts'
import { customerInvoicesScreen } from './customer-invoices-screen.tsx'
import { generalLedgerScreen } from './general-ledger-screen.tsx'
import { moveDetailScreen } from './move-detail-screen.tsx'
import { journalEntriesScreen } from './journal-entries-screen.tsx'
import { paymentsScreen } from './payments-screen.tsx'
import { paymentTermsScreen } from './payment-terms-screen.tsx'
import { partnerLedgerScreen } from './partner-ledger-screen.tsx'
import { trialBalanceScreen } from './trial-balance-screen.tsx'
import { vendorBillsScreen } from './vendor-bills-screen.tsx'
import { adminPage, choices, localeQuery, optional, printGroup, selectionLabel } from '../backend/screen.ts'
import { PAGE_SIZE, pageOf, pager, searchOf, withParam } from '../backend/paging.ts'
import { overviewCharts, periodOf, yearsOf } from './overview.ts'

const crossSite = (req: Parameters<Route>[1]): boolean => {
  const origin = req.headers.origin as string | undefined
  if (!origin) return false
  try {
    return new URL(origin).host !== String(req.headers.host ?? '')
  } catch {
    return true
  }
}

/**
 * A cross-origin POST carries the signed-in user's session cookie without their
 * intent, and every write behind these routes acts on money, stock or customer
 * records. Refused the way user_backend, company_backend, oauth_backend,
 * product_backend and stock_backend already refuse it.
 */

type AnyRow = Record<string, unknown>
type Translator = ReturnType<ServeContext['translate']>

/** How many rows an admin list renders before the reader has to narrow it down. */
const LIST_PAGE = 200

const succeeded = (result: unknown): boolean => (result as { ok?: boolean }).ok === true

/**
 * What a rejected submission has to carry back to its own screen.
 *
 * A redirect to `?invalid=1` used to be the whole answer: it named no field, gave
 * no reason, and threw away everything the user had typed into a fifteen-field
 * invoice. The domain already answers with `{ field, code }`, so the screen can
 * say which control is wrong and why, and put the values back.
 */
type Rejection = { messages: string[]; fields: Record<string, string>; values: Record<string, string> }

/** What the domain answers with when it refuses: a field, a code the screen translates. */
type Issue = { field?: string; code?: string; message?: string; params?: Record<string, unknown> }

const rejection = (result: unknown, _: Translator, form: Record<string, string>): Rejection => {
  const errors = ((result as { errors?: Issue[] } | null)?.errors ?? []).map((error) => ({
    field: error.field,
    text: error.code ? _(error.code, error.params) : (error.message ?? _('account_backend.error.invalid')),
  }))
  return {
    messages: errors.length ? errors.map((error) => error.text) : [_('account_backend.error.invalid')],
    fields: Object.fromEntries(
      errors.filter((error) => error.field).map((error) => [String(error.field), error.text]),
    ),
    values: form,
  }
}

/** Apply a rejection to the form that produced it: the reason inline, the value back. */
const restore = (fields: FormField[], rejected?: Rejection): FormField[] =>
  rejected
    ? fields.map((field) => ({
        ...field,
        error: rejected.fields[field.name] ?? null,
        // A form body omits an unchecked box entirely, so absence is the value.
        value:
          field.type === 'checkbox'
            ? rejected.values[field.name] === '1'
            : (rejected.values[field.name] ?? ''),
      }))
    : fields

/**
 * The state a configuration form should show: what the user just submitted when it
 * was refused, the record being corrected when one is open, the defaults otherwise.
 */
const formState = (fields: FormField[], row: AnyRow | null, rejected?: Rejection): FormField[] =>
  rejected ? restore(fields, rejected) : prefill(fields, row)

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

/** The milestone a payment-term screen is correcting, found across every term's lines. */
const termLineTarget = (terms: AnyRow[], url: URL): AnyRow | null => {
  const id = url.searchParams.get('editLine') ?? ''
  if (!id) return null
  for (const term of terms)
    for (const line of (term.lines as AnyRow[] | undefined) ?? []) if (String(line.id) === id) return line
  return null
}

const lineHref = (url: URL, id: unknown): string => {
  const target = new URL('/admin/accounting/terms', url)
  const lang = url.searchParams.get('lang')
  if (lang) target.searchParams.set('lang', lang)
  target.searchParams.set('editLine', String(id))
  return `${target.pathname}${target.search}`
}

const lineFormAction = (url: URL): string => {
  const target = new URL('/admin/accounting/terms', url)
  const lang = url.searchParams.get('lang')
  if (lang) target.searchParams.set('lang', lang)
  const line = url.searchParams.get('editLine')
  if (line) target.searchParams.set('editLine', line)
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

const accountListPath = (url: URL): string => {
  const target = new URL(url)
  target.pathname = '/admin/accounting/accounts'
  for (const key of ['create', 'edit', 'invalid', 'returnTo']) target.searchParams.delete(key)
  return `${target.pathname}${target.search}`
}

const accountModalPath = (url: URL, edit?: unknown, invalid = false): string => {
  const target = new URL(accountListPath(url), 'http://ket.local')
  if (edit) target.searchParams.set('edit', String(edit))
  else target.searchParams.set('create', '1')
  if (invalid) target.searchParams.set('invalid', '1')
  return `${target.pathname}${target.search}`
}

const safeAccountReturnTo = (url: URL): string => {
  const fallback = `/admin/accounting/accounts${localeQuery(url)}`
  const raw = url.searchParams.get('returnTo')
  if (!raw) return fallback
  const candidate = new URL(raw, 'http://ket.local')
  return candidate.origin === 'http://ket.local' && candidate.pathname === '/admin/accounting/accounts'
    ? `${candidate.pathname}${candidate.search}`
    : fallback
}

const accountSummary = (rows: AnyRow[]) => {
  const count = (prefixes: string[]) =>
    rows.filter((row) => prefixes.some((prefix) => String(row.accountType).startsWith(prefix))).length
  return {
    total: rows.length,
    asset: count(['asset']),
    liability: count(['liability', 'equity']),
    profit: count(['income', 'expense']),
  }
}

const accountGroups = (_: Translator, url: URL, rows: AnyRow[], grouped: boolean) => {
  if (!grouped) return undefined
  const groups = new Map<string, AnyRow[]>()
  for (const row of rows) {
    const type = String(row.accountType)
    groups.set(type, [...(groups.get(type) ?? []), row])
  }
  return [...groups.entries()].map(([type, groupRows]) => ({
    id: `type:${type}`,
    label: labelOf(_, 'accountType', type),
    count: groupRows.length,
    depth: 0,
    open: true,
    href: withParam(url, 'group', null),
    rows: groupRows,
  }))
}

const saveAccount = async (
  ctx: ServeContext,
  url: URL,
  req: Parameters<Route>[1],
  form: Awaited<ReturnType<typeof readForm>>,
) =>
  ctx.call(
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
  )

const accountFields = (_: Translator, editing: AnyRow | null, rejected?: Rejection): FormField[] =>
  formState(
    [
      { name: 'code', label: _('account_backend.field.code'), required: true },
      {
        name: 'name',
        label: _('account_backend.field.name'),
        required: true,
        // A bundled account reads under its English name in an English session,
        // so say which name this field is editing.
        help: editing?.nameEn ? `${_('account_backend.field.nameEn')}: ${String(editing.nameEn)}` : undefined,
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
    rejected,
  )

const journalListPath = (url: URL): string => {
  const target = new URL(url)
  target.pathname = '/admin/accounting/journals'
  for (const key of ['create', 'edit', 'invalid', 'returnTo']) target.searchParams.delete(key)
  return `${target.pathname}${target.search}`
}

const journalModalPath = (url: URL, edit?: unknown, invalid = false): string => {
  const target = new URL(journalListPath(url), 'http://ket.local')
  if (edit) target.searchParams.set('edit', String(edit))
  else target.searchParams.set('create', '1')
  if (invalid) target.searchParams.set('invalid', '1')
  return `${target.pathname}${target.search}`
}

const safeJournalReturnTo = (url: URL): string => {
  const fallback = `/admin/accounting/journals${localeQuery(url)}`
  const raw = url.searchParams.get('returnTo')
  if (!raw) return fallback
  const candidate = new URL(raw, 'http://ket.local')
  return candidate.origin === 'http://ket.local' && candidate.pathname === '/admin/accounting/journals'
    ? `${candidate.pathname}${candidate.search}`
    : fallback
}

const journalSummary = (rows: AnyRow[]) => ({
  total: rows.length,
  sale: rows.filter((row) => row.type === 'sale').length,
  purchase: rows.filter((row) => row.type === 'purchase').length,
  liquidity: rows.filter((row) => ['bank', 'cash'].includes(String(row.type))).length,
})

const saveJournal = async (
  ctx: ServeContext,
  url: URL,
  req: Parameters<Route>[1],
  form: Awaited<ReturnType<typeof readForm>>,
) =>
  ctx.call(
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
  )

const journalFields = async (
  ctx: ServeContext,
  url: URL,
  req: Parameters<Route>[1],
  _: Translator,
  accounts: AnyRow[],
  editing: AnyRow | null,
  rejected?: Rejection,
): Promise<FormField[]> =>
  formState(
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
        options: accountChoices(_, accounts, true),
        control: await accountRelationControl(ctx, url, req, _, {
          id: 'journal-default-account',
          name: 'defaultAccountId',
          label: _('account_backend.field.defaultAccountId'),
          accounts: accountOptions(accounts),
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
    rejected,
  )

const taxListPath = (url: URL): string => {
  const target = new URL(url)
  target.pathname = '/admin/accounting/taxes'
  for (const key of ['edit', 'invalid', 'returnTo']) target.searchParams.delete(key)
  return `${target.pathname}${target.search}`
}

const safeTaxReturnTo = (url: URL): string => {
  const fallback = `/admin/accounting/taxes${localeQuery(url)}`
  const raw = url.searchParams.get('returnTo')
  if (!raw) return fallback
  const candidate = new URL(raw, 'http://ket.local')
  return candidate.origin === 'http://ket.local' && candidate.pathname === '/admin/accounting/taxes'
    ? `${candidate.pathname}${candidate.search}`
    : fallback
}

const taxFormPath = (url: URL, returnTo: string, edit?: unknown): string => {
  const target = new URL('/admin/accounting/taxes/new', url)
  target.search = ''
  const lang = url.searchParams.get('lang')
  if (lang) target.searchParams.set('lang', lang)
  target.searchParams.set('returnTo', returnTo)
  if (edit) target.searchParams.set('edit', String(edit))
  return `${target.pathname}${target.search}`
}

const taxSummary = (rows: AnyRow[]) => ({
  total: rows.length,
  sale: rows.filter((row) => row.typeTaxUse === 'sale').length,
  purchase: rows.filter((row) => row.typeTaxUse === 'purchase').length,
  included: rows.filter((row) => row.priceInclude).length,
})

const saveTax = async (
  ctx: ServeContext,
  url: URL,
  req: Parameters<Route>[1],
  form: Awaited<ReturnType<typeof readForm>>,
) =>
  ctx.call(
    'account.saveTax',
    {
      id: targetId(url),
      name: form.name ?? '',
      ...optional(form, 'description'),
      typeTaxUse: form.typeTaxUse ?? 'sale',
      ...optional(form, 'taxScope'),
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
  )

const taxFields = async (
  ctx: ServeContext,
  url: URL,
  req: Parameters<Route>[1],
  _: Translator,
  accounts: AnyRow[],
  editing: AnyRow | null,
  rejected?: Rejection,
): Promise<FormField[]> =>
  formState(
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
        options: accountChoices(_, accounts, true),
        control: await accountRelationControl(ctx, url, req, _, {
          id: 'tax-account',
          name: 'accountId',
          label: _('account_backend.field.accountId'),
          accounts: accountOptions(accounts),
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
    rejected,
  )

const accountChoices = (_: Translator, rows: AnyRow[], empty = false) => [
  ...(empty ? [{ value: '', label: '—' }] : []),
  ...rows.map((row) => ({ value: String(row.id), label: `${String(row.code)} · ${accountName(_, row)}` })),
]

const accountLabel = (_: Translator, rows: AnyRow[], id: unknown): string => {
  const held = rows.find((row) => String(row.id) === String(id))
  return held ? `${String(held.code)} · ${accountName(_, held)}` : String(id ?? '')
}

/** The control accounts a payment can settle: receivables and payables, nothing else. */
const CONTROL_TYPES = ['asset_receivable', 'liability_payable']
const controlAccounts = (rows: AnyRow[]): AnyRow[] =>
  rows.filter((row) => CONTROL_TYPES.includes(String(row.accountType)))

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
    // A manual entry belongs in the general journal. Offering the journals in
    // insertion order made "bank" the default, which put every hand-written entry
    // into the bank sequence.
    options: choices([
      ...data.journals.filter((journal) => journal.type === 'general'),
      ...data.journals.filter((journal) => journal.type !== 'general'),
    ]),
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
    // Both accounts are answers the configuration already has: the product's
    // category or the company default decides the first, the partner or the
    // company default the second. The field stays, because an unusual document
    // still needs to be able to say otherwise — it just no longer has to.
    {
      name: 'lineAccountId',
      label: _('account_backend.field.lineAccountId'),
      type: 'select',
      options: accountChoices(_, lineAccounts, true),
      help: _('account_backend.field.lineAccountIdHint'),
      control: await accountRelationControl(ctx, url, req, _, {
        id: `invoice-line-account:${types.join('-')}`,
        name: 'lineAccountId',
        label: _('account_backend.field.lineAccountId'),
        accounts: accountOptions(lineAccounts),
        accountTypes: customer ? ['income*'] : ['expense*'],
        allowEmpty: true,
      }),
    },
    {
      name: 'counterpartAccountId',
      label: _('account_backend.field.counterpartAccountId'),
      type: 'select',
      options: accountChoices(_, counterpartAccounts, true),
      help: _('account_backend.field.counterpartAccountIdHint'),
      control: await accountRelationControl(ctx, url, req, _, {
        id: `invoice-counterpart:${types.join('-')}`,
        name: 'counterpartAccountId',
        label: _('account_backend.field.counterpartAccountId'),
        accounts: accountOptions(counterpartAccounts),
        accountTypes: [customer ? 'asset_receivable' : 'liability_payable'],
        allowEmpty: true,
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

const createInvoice = async (
  ctx: ServeContext,
  url: URL,
  req: Parameters<Route>[1],
): Promise<{ done: ReturnType<typeof seeOther> } | { rejected: Rejection }> => {
  const form = await readForm(req)
  // The taxes apply in their configured sequence, not in the order the two
  // selects happen to sit on the page.
  const taxIds = [form.taxId, form.secondTaxId].filter(
    (id, at, all): id is string => Boolean(id) && all.indexOf(id) === at,
  )
  const id = randomUUID()
  const result = await ctx.call(
    'account.createInvoice',
    {
      id,
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
      // Left blank, the domain resolves them from the category, the partner and
      // the company defaults — so blank must arrive as absent, not as ''.
      ...optional(form, 'lineAccountId'),
      ...optional(form, 'counterpartAccountId'),
      ...(taxIds.length ? { taxIds } : {}),
      ...optional(form, 'taxAccountId'),
    },
    url,
    req,
  )
  if (!succeeded(result)) return { rejected: rejection(result, ctx.translate(ctx.localeOf(url, req)), form) }
  // A new invoice is a draft that still has to be posted, so the reader goes to it
  // rather than back to a list where it is one unnamed row among many.
  const opened = `${encodeURIComponent(id)}${localeQuery(url)}`
  return {
    done: seeOther(
      String(form.moveType ?? '').startsWith('out_')
        ? `/admin/accounting/customer-invoices/${opened}`
        : `/admin/accounting/vendor-bills/${opened}`,
    ),
  }
}

const accountMoveRoute =
  (ctx: ServeContext): Route =>
  async (url, req, params) => {
    let rejected: Rejection | undefined
    if (req.method === 'POST') {
      if (crossSite(req)) return text('Forbidden', { status: 403 })
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
      if (succeeded(result))
        // A reversal is a journal entry of its own, so the user lands on it rather
        // than on the document they just corrected.
        return seeOther(
          form.action === 'reverse'
            ? `/admin/accounting/entries/${encodeURIComponent(String((result as { reversalId: unknown }).reversalId))}${localeQuery(url)}`
            : `${url.pathname}${localeQuery(url)}`,
        )
      rejected = rejection(result, ctx.translate(ctx.localeOf(url, req)), form)
    } else if (req.method !== 'GET') return text('GET or POST', { status: 405 })
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
      // A draft has no journal number, so `name` is still its raw id — not a
      // browser-tab title.
      title: moveTitle(ctx.translate(lang), move),
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
          printGroup(_, printable, String(move.id), url.search),
          rejected?.messages,
        ),
    })
  }

const MESSAGES: Record<string, Record<string, string>> = { vi: {}, en: {} }

export default defineModule({
  name: 'account_backend',
  // 0.3.0: a refused form says which rule it broke and keeps what was typed;
  // pickers only offer values the ledger accepts; dashboard cards count the lists
  // they open; payment-term milestones are visible and editable.
  version: '0.3.0',
  depends: ['account', 'backend'],
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
    'accounting.defaults': {
      parent: 'accounting.configuration',
      label: 'menu.defaults',
      path: '/admin/accounting/defaults',
      needs: 'account.getDefaults',
      sequence: 50,
    },
  },
  routes: {
    '/admin/accounting':
      (ctx): Route =>
      async (url, req) => {
        if (req.method !== 'GET') return text('GET', { status: 405 })
        await ctx.call('account.initializeCompany', {}, url, req)
        const period = periodOf(url)
        const read = async (name: string, args: AnyRow): Promise<AnyRow> =>
          (await ctx.call(name, args, url, req)) as AnyRow
        // Nine reads, one round of latency. A balance is as at a date and a
        // result is over a window, so they are separate calls rather than one
        // "dashboard" function: the same split the trial balance and the general
        // ledger already make, and the reason narrowing the filter cannot make
        // total assets shrink.
        const [
          current,
          previous,
          position,
          opening,
          timeline,
          openItems,
          cashFlow,
          setup,
          companies,
          oldest,
        ] = await Promise.all([
          read('account.performance', { dateFrom: period.from, dateTo: period.to }),
          read('account.performance', { dateFrom: period.previousFrom, dateTo: period.previousTo }),
          read('account.position', { asOf: period.to }),
          read('account.position', { asOf: period.previousTo }),
          read('account.revenueTimeline', { dateFrom: period.from, dateTo: period.to }),
          read('account.openItemSummary', { asOf: period.to, partnerLimit: 5 }),
          read('account.cashFlow', { dateFrom: period.from, dateTo: period.to }),
          read('account.getSetup', {}),
          ctx.call('company.listCompanies', {}, url, req) as Promise<AnyRow[]>,
          // The oldest posted move, and only that one: the year chips offer
          // the years the ledger actually covers, and asking the database for
          // the earliest date is cheaper than every year deriving from a scan.
          ctx.call('account.listMoves', { state: 'posted', order: 'asc', limit: 1 }, url, req) as Promise<
            AnyRow[]
          >,
        ])
        // The comparison line has to be bucketed the way this one was, or the
        // two are not comparable: a previous window one day shorter would
        // otherwise pick days where this picked months and draw a shape that
        // shares an axis with nothing.
        const previousTimeline = await read('account.revenueTimeline', {
          dateFrom: period.previousFrom,
          dateTo: period.previousTo,
          granularity: String(timeline.granularity ?? 'day'),
        })
        return adminPage(ctx, url, req, {
          title: 'account_backend.overview.title',
          body: async (_, frame) => {
            const currency = currencyOf(companies as AnyRow[], frame)
            const charts = await overviewCharts(ctx, url, req, _, {
              currency,
              current,
              timeline,
              previousTimeline,
            })
            return accountingOverviewScreen(_, {
              frame,
              action: '/admin/accounting',
              preset: period.preset,
              years: yearsOf(String((oldest as AnyRow[])[0]?.date ?? '')),
              presetHref: (name) => {
                const target = new URL('/admin/accounting', url)
                target.searchParams.set('period', name)
                const lang = url.searchParams.get('lang')
                if (lang) target.searchParams.set('lang', lang)
                return `${target.pathname}${target.search}`
              },
              // The language rides as a hidden field: a GET form discards the
              // query string its action carried, which silently sent a reader
              // filtering in Vietnamese back to the negotiated locale.
              hidden: url.searchParams.get('lang')
                ? { lang: String(url.searchParams.get('lang')) }
                : undefined,
              fields: [
                { name: 'dateFrom', label: _('account_backend.field.dateFrom'), value: period.fromDay },
                { name: 'dateTo', label: _('account_backend.field.dateTo'), value: period.toDay },
              ],
              current,
              previous,
              position,
              opening,
              openItems,
              cashFlow,
              revenue: charts.revenue,
              mix: charts.mix,
              currency,
              standard: String(setup.standard),
              ledgerHref: (accountId) => {
                const target = new URL('/admin/accounting/general-ledger', url)
                target.searchParams.set('accountId', accountId)
                target.searchParams.set('dateFrom', period.from)
                target.searchParams.set('dateTo', period.to)
                const lang = url.searchParams.get('lang')
                if (lang) target.searchParams.set('lang', lang)
                return `${target.pathname}${target.search}`
              },
              partnerHref: (partnerId) => {
                const target = new URL('/admin/accounting/partner-statement', url)
                target.searchParams.set('partnerId', partnerId)
                const lang = url.searchParams.get('lang')
                if (lang) target.searchParams.set('lang', lang)
                return `${target.pathname}${target.search}`
              },
            })
          },
        })
      },
    '/admin/accounting/accounts':
      (ctx): Route =>
      async (url, req) => {
        let rejected: Rejection | undefined
        if (req.method === 'POST') {
          if (crossSite(req)) return text('Forbidden', { status: 403 })
          const form = await readForm(req)
          const result = await saveAccount(ctx, url, req, form)
          if (succeeded(result)) return seeOther(accountListPath(url))
          rejected = rejection(result, ctx.translate(ctx.localeOf(url, req)), form)
        } else if (req.method !== 'GET') return text('GET or POST', { status: 405 })
        const all = (await ctx.call('account.listAccounts', { includeArchived: true }, url, req)) as AnyRow[]
        const editing = editTarget(all, url)
        const returnTo = accountListPath(url)
        const modalOpen =
          req.method === 'POST' || url.searchParams.get('create') === '1' || Boolean(editingId(url))
        const formPath = accountModalPath(url, editing?.id ?? editingId(url))
        const page = pageOf(url)
        const search = searchOf(url)
        const status = ['active', 'archived'].includes(String(url.searchParams.get('status')))
          ? url.searchParams.get('status')
          : null
        const family = ['asset', 'liability', 'profit'].includes(String(url.searchParams.get('family')))
          ? url.searchParams.get('family')
          : null
        const grouped = url.searchParams.get('group') === 'type'
        const needle = search?.toLocaleLowerCase()
        const matching = all.filter((row) => {
          const active = row.active === true
          if (status === 'active' && !active) return false
          if (status === 'archived' && active) return false
          const type = String(row.accountType)
          if (family === 'asset' && !type.startsWith('asset')) return false
          if (family === 'liability' && !['liability', 'equity'].some((prefix) => type.startsWith(prefix)))
            return false
          if (family === 'profit' && !['income', 'expense'].some((prefix) => type.startsWith(prefix)))
            return false
          return (
            !needle ||
            `${String(row.code)} ${accountName(ctx.translate(ctx.localeOf(url, req)), row)}`
              .toLocaleLowerCase()
              .includes(needle)
          )
        })
        const rows = grouped ? matching : matching.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
        return adminPage(ctx, url, req, {
          title: 'account_backend.accounts.title',
          body: (_, frame) => {
            const workspace = accountsListScreen(_, {
              frame: {
                ...frame,
                chrome: {
                  search: {
                    name: 'q',
                    value: search ?? '',
                    placeholder: _('account_backend.accounts.title'),
                    keep: {
                      ...(status ? { status } : {}),
                      ...(family ? { family } : {}),
                      ...(grouped ? { group: 'type' } : {}),
                      ...(url.searchParams.get('lang') ? { lang: String(url.searchParams.get('lang')) } : {}),
                    },
                    facets: [
                      ...(status
                        ? [
                            {
                              label:
                                status === 'active'
                                  ? _('account_backend.active')
                                  : _('account_backend.archived'),
                              without: withParam(url, 'status', null),
                            },
                          ]
                        : []),
                      ...(family
                        ? [
                            {
                              label: _(`account_backend.account.summary.${family}`),
                              without: withParam(url, 'family', null),
                            },
                          ]
                        : []),
                      ...(grouped
                        ? [
                            {
                              label: `${_('backend.chrome.groupBy')}: ${_('account_backend.field.accountType')}`,
                              without: withParam(url, 'group', null),
                            },
                          ]
                        : []),
                    ],
                    menus: [
                      {
                        id: 'filters',
                        label: _('backend.chrome.filters'),
                        items: [
                          {
                            id: 'status:active',
                            label: _('account_backend.active'),
                            path: withParam(url, 'status', status === 'active' ? null : 'active'),
                            active: status === 'active',
                          },
                          {
                            id: 'status:archived',
                            label: _('account_backend.archived'),
                            path: withParam(url, 'status', status === 'archived' ? null : 'archived'),
                            active: status === 'archived',
                          },
                          ...(['asset', 'liability', 'profit'] as const).map((value) => ({
                            id: `family:${value}`,
                            label: _(`account_backend.account.summary.${value}`),
                            path: withParam(url, 'family', family === value ? null : value),
                            active: family === value,
                          })),
                        ],
                      },
                      {
                        id: 'group',
                        label: _('backend.chrome.groupBy'),
                        items: [
                          {
                            id: 'group:type',
                            label: _('account_backend.field.accountType'),
                            path: withParam(url, 'group', grouped ? null : 'type'),
                            active: grouped,
                          },
                        ],
                      },
                    ],
                  },
                  pager: grouped ? null : pager(url, page, rows.length, matching.length),
                },
              },
              rows,
              createHref: accountModalPath(url),
              rowHref: (row) => accountModalPath(url, row.id),
              displayName: (row) => accountName(_, row),
              summary: accountSummary(all),
              table: { groups: accountGroups(_, url, matching, grouped) },
            })
            if (!modalOpen) return workspace
            return modalWorkspace(
              workspace,
              accountFormModal(_, {
                frame,
                action: formPath,
                cancelHref: returnTo,
                editing,
                displayName: (row) => accountName(_, row),
                errors:
                  rejected?.messages ??
                  (url.searchParams.get('invalid') === '1'
                    ? [_('account_backend.error.invalid')]
                    : undefined),
                fields: accountFields(_, editing, rejected),
              }),
            )
          },
        })
      },
    '/admin/accounting/accounts/new':
      (ctx): Route =>
      async (url, req) => {
        if (req.method === 'POST') {
          if (crossSite(req)) return text('Forbidden', { status: 403 })
          const form = await readForm(req)
          const result = await saveAccount(ctx, url, req, form)
          if (succeeded(result)) return seeOther(safeAccountReturnTo(url))
          return seeOther(accountModalPath(url, editingId(url), true))
        } else if (req.method !== 'GET') return text('GET or POST', { status: 405 })
        return seeOther(accountModalPath(url, editingId(url), url.searchParams.get('invalid') === '1'))
      },
    '/admin/accounting/journals':
      (ctx): Route =>
      async (url, req) => {
        let rejected: Rejection | undefined
        if (req.method === 'POST') {
          if (crossSite(req)) return text('Forbidden', { status: 403 })
          const form = await readForm(req)
          const result = await saveJournal(ctx, url, req, form)
          if (succeeded(result)) return seeOther(journalListPath(url))
          rejected = rejection(result, ctx.translate(ctx.localeOf(url, req)), form)
        } else if (req.method !== 'GET') return text('GET or POST', { status: 405 })
        const data = await common(ctx, url, req)
        const all = (await ctx.call('account.listJournals', { includeArchived: true }, url, req)) as AnyRow[]
        const editing = editTarget(all, url)
        const returnTo = journalListPath(url)
        const modalOpen =
          req.method === 'POST' || url.searchParams.get('create') === '1' || Boolean(editingId(url))
        const formPath = journalModalPath(url, editing?.id ?? editingId(url))
        const page = pageOf(url)
        const search = searchOf(url)
        const status = ['active', 'archived'].includes(String(url.searchParams.get('status')))
          ? url.searchParams.get('status')
          : null
        const type = JOURNAL_TYPES.includes(String(url.searchParams.get('type')) as never)
          ? url.searchParams.get('type')
          : null
        const needle = search?.toLocaleLowerCase()
        const matching = all.filter((row) => {
          const active = row.active === true
          if (status === 'active' && !active) return false
          if (status === 'archived' && active) return false
          if (type && row.type !== type) return false
          return !needle || `${String(row.code)} ${String(row.name)}`.toLocaleLowerCase().includes(needle)
        })
        const journals = matching.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
        return adminPage(ctx, url, req, {
          title: 'account_backend.journals.title',
          body: async (_, frame) => {
            const workspace = journalsListScreen(_, {
              frame: {
                ...frame,
                chrome: {
                  search: {
                    name: 'q',
                    value: search ?? '',
                    placeholder: _('account_backend.journals.title'),
                    keep: {
                      ...(status ? { status } : {}),
                      ...(type ? { type } : {}),
                      ...(url.searchParams.get('lang') ? { lang: String(url.searchParams.get('lang')) } : {}),
                    },
                    facets: [
                      ...(status
                        ? [
                            {
                              label:
                                status === 'active'
                                  ? _('account_backend.active')
                                  : _('account_backend.archived'),
                              without: withParam(url, 'status', null),
                            },
                          ]
                        : []),
                      ...(type
                        ? [
                            {
                              label: labelOf(_, 'journalType', type),
                              without: withParam(url, 'type', null),
                            },
                          ]
                        : []),
                    ],
                    menus: [
                      {
                        id: 'filters',
                        label: _('backend.chrome.filters'),
                        items: [
                          {
                            id: 'status:active',
                            label: _('account_backend.active'),
                            path: withParam(url, 'status', status === 'active' ? null : 'active'),
                            active: status === 'active',
                          },
                          {
                            id: 'status:archived',
                            label: _('account_backend.archived'),
                            path: withParam(url, 'status', status === 'archived' ? null : 'archived'),
                            active: status === 'archived',
                          },
                          ...JOURNAL_TYPES.map((value) => ({
                            id: `type:${value}`,
                            label: labelOf(_, 'journalType', value),
                            path: withParam(url, 'type', type === value ? null : value),
                            active: type === value,
                          })),
                        ],
                      },
                    ],
                  },
                  pager: pager(url, page, journals.length, matching.length),
                },
              },
              rows: journals,
              accounts: data.accounts,
              createHref: journalModalPath(url),
              rowHref: (row) => journalModalPath(url, row.id),
              displayAccountName: (row) => accountName(_, row),
              summary: journalSummary(all),
            })
            if (!modalOpen) return workspace
            return modalWorkspace(
              workspace,
              journalFormModal(_, {
                frame,
                action: formPath,
                cancelHref: returnTo,
                editing,
                errors:
                  rejected?.messages ??
                  (url.searchParams.get('invalid') === '1'
                    ? [_('account_backend.error.invalid')]
                    : undefined),
                fields: await journalFields(ctx, url, req, _, data.accounts, editing, rejected),
              }),
            )
          },
        })
      },
    '/admin/accounting/journals/new':
      (ctx): Route =>
      async (url, req) => {
        if (req.method === 'POST') {
          if (crossSite(req)) return text('Forbidden', { status: 403 })
          const form = await readForm(req)
          const result = await saveJournal(ctx, url, req, form)
          if (succeeded(result)) return seeOther(safeJournalReturnTo(url))
          return seeOther(journalModalPath(url, editingId(url), true))
        } else if (req.method !== 'GET') return text('GET or POST', { status: 405 })
        return seeOther(journalModalPath(url, editingId(url), url.searchParams.get('invalid') === '1'))
      },
    '/admin/accounting/taxes':
      (ctx): Route =>
      async (url, req) => {
        let rejected: Rejection | undefined
        if (req.method === 'POST') {
          if (crossSite(req)) return text('Forbidden', { status: 403 })
          const form = await readForm(req)
          const result = await saveTax(ctx, url, req, form)
          if (succeeded(result)) return seeOther(taxListPath(url))
          rejected = rejection(result, ctx.translate(ctx.localeOf(url, req)), form)
        } else if (req.method !== 'GET') return text('GET or POST', { status: 405 })
        const data = await common(ctx, url, req)
        const all = (await ctx.call('account.listTaxes', { includeArchived: true }, url, req)) as AnyRow[]
        const editing = editTarget(all, url)
        const returnTo = taxListPath(url)
        const formPath = taxFormPath(url, returnTo, editing?.id ?? editingId(url))
        if (req.method === 'POST' || editingId(url)) {
          if (req.method === 'GET') return seeOther(formPath)
          return adminPage(ctx, url, req, {
            title: editing ? 'account_backend.tax.edit.title' : 'account_backend.tax.create.title',
            body: async (_, frame) =>
              taxFormScreen(_, {
                frame,
                action: formPath,
                cancelHref: returnTo,
                editing,
                errors: rejected?.messages,
                fields: await taxFields(ctx, url, req, _, data.accounts, editing, rejected),
              }),
          })
        }
        const page = pageOf(url)
        const search = searchOf(url)
        const status = ['active', 'archived'].includes(String(url.searchParams.get('status')))
          ? url.searchParams.get('status')
          : null
        const use = TAX_USES.includes(String(url.searchParams.get('use')) as never)
          ? url.searchParams.get('use')
          : null
        const computation = TAX_AMOUNT_TYPES.includes(String(url.searchParams.get('computation')) as never)
          ? url.searchParams.get('computation')
          : null
        const included = url.searchParams.get('included') === '1'
        const needle = search?.toLocaleLowerCase()
        const matching = all.filter((row) => {
          const active = row.active === true
          if (status === 'active' && !active) return false
          if (status === 'archived' && active) return false
          if (use && row.typeTaxUse !== use) return false
          if (computation && row.amountType !== computation) return false
          if (included && row.priceInclude !== true) return false
          return (
            !needle ||
            `${String(row.name)} ${String(row.description ?? '')} ${String(row.amount)}`
              .toLocaleLowerCase()
              .includes(needle)
          )
        })
        const taxes = matching.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
        return adminPage(ctx, url, req, {
          title: 'account_backend.taxes.title',
          body: (_, frame) =>
            taxesListScreen(_, {
              frame: {
                ...frame,
                chrome: {
                  search: {
                    name: 'q',
                    value: search ?? '',
                    placeholder: _('account_backend.taxes.title'),
                    keep: {
                      ...(status ? { status } : {}),
                      ...(use ? { use } : {}),
                      ...(computation ? { computation } : {}),
                      ...(included ? { included: '1' } : {}),
                      ...(url.searchParams.get('lang') ? { lang: String(url.searchParams.get('lang')) } : {}),
                    },
                    facets: [
                      ...(status
                        ? [
                            {
                              label:
                                status === 'active'
                                  ? _('account_backend.active')
                                  : _('account_backend.archived'),
                              without: withParam(url, 'status', null),
                            },
                          ]
                        : []),
                      ...(use
                        ? [
                            {
                              label: labelOf(_, 'taxUse', use),
                              without: withParam(url, 'use', null),
                            },
                          ]
                        : []),
                      ...(computation
                        ? [
                            {
                              label: labelOf(_, 'taxAmountType', computation),
                              without: withParam(url, 'computation', null),
                            },
                          ]
                        : []),
                      ...(included
                        ? [
                            {
                              label: _('account_backend.tax.summary.included'),
                              without: withParam(url, 'included', null),
                            },
                          ]
                        : []),
                    ],
                    menus: [
                      {
                        id: 'filters',
                        label: _('backend.chrome.filters'),
                        items: [
                          {
                            id: 'status:active',
                            label: _('account_backend.active'),
                            path: withParam(url, 'status', status === 'active' ? null : 'active'),
                            active: status === 'active',
                          },
                          {
                            id: 'status:archived',
                            label: _('account_backend.archived'),
                            path: withParam(url, 'status', status === 'archived' ? null : 'archived'),
                            active: status === 'archived',
                          },
                          ...TAX_USES.map((value) => ({
                            id: `use:${value}`,
                            label: labelOf(_, 'taxUse', value),
                            path: withParam(url, 'use', use === value ? null : value),
                            active: use === value,
                          })),
                          ...TAX_AMOUNT_TYPES.map((value) => ({
                            id: `computation:${value}`,
                            label: labelOf(_, 'taxAmountType', value),
                            path: withParam(url, 'computation', computation === value ? null : value),
                            active: computation === value,
                          })),
                          {
                            id: 'included',
                            label: _('account_backend.tax.summary.included'),
                            path: withParam(url, 'included', included ? null : '1'),
                            active: included,
                          },
                        ],
                      },
                    ],
                  },
                  pager: pager(url, page, taxes.length, matching.length),
                },
              },
              rows: taxes,
              accounts: data.accounts,
              currency: currencyOf(data.companies, frame),
              createHref: taxFormPath(url, returnTo),
              rowHref: (row) => taxFormPath(url, returnTo, row.id),
              summary: taxSummary(all),
            }),
        })
      },
    '/admin/accounting/taxes/new':
      (ctx): Route =>
      async (url, req) => {
        let rejected: Rejection | undefined
        if (req.method === 'POST') {
          if (crossSite(req)) return text('Forbidden', { status: 403 })
          const form = await readForm(req)
          const result = await saveTax(ctx, url, req, form)
          if (succeeded(result)) return seeOther(safeTaxReturnTo(url))
          rejected = rejection(result, ctx.translate(ctx.localeOf(url, req)), form)
        } else if (req.method !== 'GET') return text('GET or POST', { status: 405 })
        const data = await common(ctx, url, req)
        const taxes = (await ctx.call('account.listTaxes', { includeArchived: true }, url, req)) as AnyRow[]
        const editing = editTarget(taxes, url)
        const returnTo = safeTaxReturnTo(url)
        const formPath = taxFormPath(url, returnTo, editing?.id ?? editingId(url))
        return adminPage(ctx, url, req, {
          title: editing ? 'account_backend.tax.edit.title' : 'account_backend.tax.create.title',
          body: async (_, frame) =>
            taxFormScreen(_, {
              frame,
              action: formPath,
              cancelHref: returnTo,
              editing,
              errors: rejected?.messages,
              fields: await taxFields(ctx, url, req, _, data.accounts, editing, rejected),
            }),
        })
      },
    '/admin/accounting/terms':
      (ctx): Route =>
      async (url, req) => {
        // Two forms post here, so a refusal has to land on the one that caused it.
        let rejected: Rejection | undefined
        let rejectedLine: Rejection | undefined
        if (req.method === 'POST') {
          if (crossSite(req)) return text('Forbidden', { status: 403 })
          const form = await readForm(req)
          const line = form.action === 'line'
          const result = line
            ? await ctx.call(
                'account.savePaymentTermLine',
                {
                  id: url.searchParams.get('editLine') || randomUUID(),
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
          if (succeeded(result)) return seeOther(`/admin/accounting/terms${localeQuery(url)}`)
          const failure = rejection(result, ctx.translate(ctx.localeOf(url, req)), form)
          if (line) rejectedLine = failure
          else rejected = failure
        } else if (req.method !== 'GET') return text('GET or POST', { status: 405 })
        const rows = (await ctx.call(
          'account.listPaymentTerms',
          { includeArchived: true },
          url,
          req,
        )) as AnyRow[]
        const editing = editTarget(rows, url)
        const editingLine = termLineTarget(rows, url)
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
              errors: rejected?.messages,
              lineErrors: rejectedLine?.messages,
              editingLine,
              lineSubmit: editingLine
                ? _('account_backend.action.save')
                : _('account_backend.action.addTermLine'),
              lineHref: (line) => lineHref(url, line.id),
              lineCancelHref: `/admin/accounting/terms${localeQuery(url)}`,
              lineAction: lineFormAction(url),
              delayLabel: (line) => selectionLabel(_, 'account_backend', 'paymentTermDelay', line.delayType),
              valueLabel: (line) => selectionLabel(_, 'account_backend', 'paymentTermValue', line.value),
              termFields: formState(
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
                rejected,
              ),
              lineFields: rows.length
                ? formState(
                    [
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
                        help: _('account_backend.field.daysNextMonthHint'),
                      },
                      {
                        name: 'sequence',
                        label: _('account_backend.field.sequence'),
                        type: 'number',
                        value: 10,
                      },
                    ],
                    editingLine,
                    rejectedLine,
                  )
                : undefined,
            }),
        })
      },
    '/admin/accounting/defaults':
      (ctx): Route =>
      async (url, req) => {
        let rejected: Rejection | undefined
        let rejectedCategory: Rejection | undefined
        if (req.method === 'POST') {
          const form = await readForm(req)
          const category = form.action === 'category'
          const result = category
            ? await ctx.call(
                'account.saveCategoryAccount',
                {
                  categoryId: form.categoryId ?? '',
                  ...optional(form, 'incomeAccountId'),
                  ...optional(form, 'expenseAccountId'),
                },
                url,
                req,
              )
            : await ctx.call(
                'account.saveDefaults',
                {
                  ...optional(form, 'incomeAccountId'),
                  ...optional(form, 'expenseAccountId'),
                  ...optional(form, 'receivableAccountId'),
                  ...optional(form, 'payableAccountId'),
                },
                url,
                req,
              )
          if (succeeded(result)) return seeOther(`/admin/accounting/defaults${localeQuery(url)}`)
          const failure = rejection(result, ctx.translate(ctx.localeOf(url, req)), form)
          if (category) rejectedCategory = failure
          else rejected = failure
        } else if (req.method !== 'GET') return text('GET or POST', { status: 405 })

        const data = await common(ctx, url, req)
        const [defaults, rows, categories] = (await Promise.all([
          ctx.call('account.getDefaults', {}, url, req),
          ctx.call('account.listCategoryAccounts', {}, url, req),
          ctx.call('product.listCategories', {}, url, req),
        ])) as [AnyRow, AnyRow[], AnyRow[]]
        const editingCategory = (() => {
          const id = url.searchParams.get('editCategory') ?? ''
          return id ? (rows.find((row) => String(row.categoryId) === id) ?? null) : null
        })()
        const income = data.accounts.filter((row) =>
          ['income', 'income_other'].includes(String(row.accountType)),
        )
        const expense = data.accounts.filter((row) =>
          ['expense', 'expense_other', 'expense_depreciation', 'expense_direct_cost'].includes(
            String(row.accountType),
          ),
        )
        const receivable = data.accounts.filter((row) => row.accountType === 'asset_receivable')
        const payable = data.accounts.filter((row) => row.accountType === 'liability_payable')
        const categoryTarget = (id: unknown) => {
          const target = new URL('/admin/accounting/defaults', url)
          const lang = url.searchParams.get('lang')
          if (lang) target.searchParams.set('lang', lang)
          if (id) target.searchParams.set('editCategory', String(id))
          return `${target.pathname}${target.search}`
        }
        return adminPage(ctx, url, req, {
          title: 'account_backend.defaults.title',
          body: (_, frame) =>
            accountDefaultsScreen(_, {
              frame: frame,
              action: `/admin/accounting/defaults${localeQuery(url)}`,
              categoryAction: categoryTarget(url.searchParams.get('editCategory')),
              rows,
              accountLabel: (id) => accountLabel(_, data.accounts, id),
              editing: editingCategory,
              categorySubmit: editingCategory
                ? _('account_backend.action.save')
                : _('account_backend.action.create'),
              categoryHref: (row) => categoryTarget(row.categoryId),
              cancelHref: `/admin/accounting/defaults${localeQuery(url)}`,
              errors: rejected?.messages,
              categoryErrors: rejectedCategory?.messages,
              defaultsFields: formState(
                [
                  {
                    name: 'incomeAccountId',
                    label: _('account_backend.field.incomeAccountId'),
                    type: 'select',
                    options: accountChoices(_, income, true),
                    help: _('account_backend.field.incomeAccountIdHint'),
                  },
                  {
                    name: 'expenseAccountId',
                    label: _('account_backend.field.expenseAccountId'),
                    type: 'select',
                    options: accountChoices(_, expense, true),
                    help: _('account_backend.field.expenseAccountIdHint'),
                  },
                  {
                    name: 'receivableAccountId',
                    label: _('account_backend.field.receivableAccountId'),
                    type: 'select',
                    options: accountChoices(_, receivable, true),
                    help: _('account_backend.field.receivableAccountIdHint'),
                  },
                  {
                    name: 'payableAccountId',
                    label: _('account_backend.field.payableAccountId'),
                    type: 'select',
                    options: accountChoices(_, payable, true),
                    help: _('account_backend.field.payableAccountIdHint'),
                  },
                ],
                defaults,
                rejected,
              ),
              categoryFields: categories.length
                ? formState(
                    [
                      {
                        name: 'categoryId',
                        label: _('account_backend.field.categoryId'),
                        type: 'select',
                        options: choices(categories),
                        required: true,
                      },
                      {
                        name: 'incomeAccountId',
                        label: _('account_backend.field.incomeAccountId'),
                        type: 'select',
                        options: accountChoices(_, income, true),
                      },
                      {
                        name: 'expenseAccountId',
                        label: _('account_backend.field.expenseAccountId'),
                        type: 'select',
                        options: accountChoices(_, expense, true),
                      },
                    ],
                    editingCategory,
                    rejectedCategory,
                  )
                : undefined,
            }),
        })
      },
    '/admin/accounting/entries':
      (ctx): Route =>
      async (url, req) => {
        const data = await common(ctx, url, req)
        let rejected: Rejection | undefined
        if (req.method === 'POST') {
          if (crossSite(req)) return text('Forbidden', { status: 403 })
          const form = await readForm(req)
          const id = randomUUID()
          const result = await ctx.call(
            'account.createMove',
            {
              id,
              journalId: form.journalId ?? '',
              moveType: form.moveType || 'entry',
              ...optional(form, 'date'),
              ...optional(form, 'ref'),
              ...optional(form, 'partnerId'),
            },
            url,
            req,
          )
          // A new entry is empty, so the only useful next step is opening it to add
          // its lines. Landing back on the list left the reader to find it again.
          if (succeeded(result))
            return seeOther(`/admin/accounting/entries/${encodeURIComponent(id)}${localeQuery(url)}`)
          rejected = rejection(result, ctx.translate(ctx.localeOf(url, req)), form)
        } else if (req.method !== 'GET') return text('GET or POST', { status: 405 })
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
              fields: restore(await moveFields(ctx, url, req, _, data, ['entry']), rejected),
              rows,
              locale: localeQuery(url),
              errors: rejected?.messages,
            }),
        })
      },
    '/admin/accounting/customer-invoices':
      (ctx): Route =>
      async (url, req) => {
        const data = await common(ctx, url, req)
        let rejected: Rejection | undefined
        if (req.method === 'POST') {
          const outcome = await createInvoice(ctx, url, req)
          if ('done' in outcome) return outcome.done
          rejected = outcome.rejected
        } else if (req.method !== 'GET') return text('GET or POST', { status: 405 })
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
              fields: restore(
                await invoiceFields(ctx, url, req, _, data, ['out_invoice', 'out_refund', 'out_receipt']),
                rejected,
              ),
              rows,
              locale: localeQuery(url),
              errors: rejected?.messages,
            }),
        })
      },
    '/admin/accounting/vendor-bills':
      (ctx): Route =>
      async (url, req) => {
        const data = await common(ctx, url, req)
        let rejected: Rejection | undefined
        if (req.method === 'POST') {
          const outcome = await createInvoice(ctx, url, req)
          if ('done' in outcome) return outcome.done
          rejected = outcome.rejected
        } else if (req.method !== 'GET') return text('GET or POST', { status: 405 })
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
              fields: restore(
                await invoiceFields(ctx, url, req, _, data, ['in_invoice', 'in_refund', 'in_receipt']),
                rejected,
              ),
              rows,
              locale: localeQuery(url),
              errors: rejected?.messages,
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
        let rejected: Rejection | undefined
        if (req.method === 'POST') {
          if (crossSite(req)) return text('Forbidden', { status: 403 })
          const form = await readForm(req)
          const result = await ctx.call(
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
          )
          if (succeeded(result)) return seeOther(`/admin/accounting/payments${localeQuery(url)}`)
          rejected = rejection(result, ctx.translate(ctx.localeOf(url, req)), form)
        } else if (req.method !== 'GET') return text('GET or POST', { status: 405 })
        const rows = (await ctx.call('account.listPayments', { limit: LIST_PAGE }, url, req)) as AnyRow[]
        const settleable = controlAccounts(data.accounts)
        return adminPage(ctx, url, req, {
          title: 'account_backend.payments.title',
          body: async (_, frame) =>
            paymentsScreen(_, {
              frame: frame,
              action: `/admin/accounting/payments${localeQuery(url)}`,
              rows,
              openItems: openItems.length,
              entryHref: (row) =>
                `/admin/accounting/entries/${encodeURIComponent(String(row.moveId))}${localeQuery(url)}`,
              errors: rejected?.messages,
              fields: restore(
                [
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
                    // Only a control account can be settled, and which one depends on
                    // the partner type chosen alongside it. Offering the whole chart
                    // made the default selection a guaranteed refusal.
                    options: accountChoices(_, settleable),
                    required: true,
                    help: _('account_backend.field.destinationAccountIdHint'),
                    control: await accountRelationControl(ctx, url, req, _, {
                      id: 'payment-destination-account',
                      name: 'destinationAccountId',
                      label: _('account_backend.field.destinationAccountId'),
                      accounts: accountOptions(settleable),
                      accountTypes: CONTROL_TYPES,
                      required: true,
                    }),
                  },
                  {
                    name: 'amount',
                    label: _('account_backend.field.paymentAmount'),
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
                        label: `${String((line.move as AnyRow)?.name ?? line.moveId)} · ${accountLabel(_, data.accounts, line.accountId)} · ${formatMoney(_, line.amountResidual, (line.move as AnyRow)?.currency)}`,
                      })),
                    ],
                  },
                ],
                rejected,
              ),
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
              // The balance carries its own date window into the ledger, so the
              // rows opened are the ones that produced the number.
              ledgerHref: (row) => {
                const target = new URL('/admin/accounting/general-ledger', url)
                target.searchParams.set('accountId', String(row.accountId))
                if (dateFrom) target.searchParams.set('dateFrom', dateFrom)
                if (dateTo) target.searchParams.set('dateTo', dateTo)
                const lang = url.searchParams.get('lang')
                if (lang) target.searchParams.set('lang', lang)
                return `${target.pathname}${target.search}`
              },
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
              accountLabel: (id) => accountLabel(_, data.accounts, id),
              entryHref: (row) =>
                `/admin/accounting/entries/${encodeURIComponent(String(row.moveId))}${localeQuery(url)}`,
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
              entryHref: (row) =>
                `/admin/accounting/entries/${encodeURIComponent(String(row.moveId))}${localeQuery(url)}`,
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
  'menu.defaults': 'Tài khoản mặc định',
  'defaults.title': 'Tài khoản mặc định',
  'defaults.kicker': 'Cấu hình hạch toán',
  'defaults.subtitle': 'Quyết định trước tài khoản cho hoá đơn, để chứng từ khỏi phải hỏi lại mỗi lần.',
  'defaults.summary.categories': 'Nhóm đã cấu hình',
  'defaults.company.title': 'Mặc định của công ty',
  'defaults.company.hint': 'Dùng khi nhóm sản phẩm và đối tác không có cấu hình riêng.',
  'defaults.category.title': 'Đặt tài khoản cho nhóm sản phẩm',
  'defaults.category.edit.title': 'Sửa tài khoản của nhóm sản phẩm',
  'defaults.category.hint': 'Nhóm sản phẩm quyết định tài khoản doanh thu và chi phí cho hàng thuộc nhóm đó.',
  'defaults.categories.title': 'Nhóm sản phẩm đã cấu hình',
  'defaults.categories.hint': 'Mở một dòng để sửa. Nhóm không có ở đây sẽ dùng mặc định của công ty.',
  'defaults.categories.empty': 'Chưa nhóm nào có tài khoản riêng',
  'defaults.categories.emptyHint': 'Mọi hàng hoá đang hạch toán theo mặc định của công ty.',
  'overview.title': 'Tổng quan kế toán',
  'overview.subtitle': 'Kết quả kinh doanh, tình hình tài chính và công nợ lấy thẳng từ sổ đã ghi.',
  'overview.period': 'Kỳ báo cáo',
  'overview.periodHint':
    'Chọn một khoảng có sẵn, hoặc chọn năm rồi thu hẹp bằng ngày cụ thể. Số liệu kết quả tính trong kỳ; số dư tính đến ngày cuối kỳ. Kỳ so sánh là khoảng thời gian cùng độ dài liền trước.',
  'overview.preset.today': 'Hôm nay',
  'overview.preset.yesterday': 'Hôm qua',
  'overview.preset.last7': '7 ngày qua',
  'overview.preset.last14': '14 ngày qua',
  'overview.preset.last30': '30 ngày qua',
  'overview.preset.month': 'Tháng này',
  'overview.preset.lastMonth': 'Tháng trước',
  'overview.preset.last90': '90 ngày qua',
  'overview.byYear': 'Theo năm',
  'overview.custom': 'Thu hẹp trong năm',
  'overview.headline': 'Chỉ số chính',
  'overview.headlineHint': 'So với kỳ liền trước cùng độ dài.',
  'overview.revenue': 'Doanh thu thuần',
  'overview.profit': 'Lợi nhuận trước thuế',
  'overview.cash': 'Tiền và tương đương tiền',
  'overview.assets': 'Tổng tài sản',
  'overview.liabilities': 'Tổng nợ phải trả',
  'overview.versusPrevious': 'so với kỳ trước',
  'overview.noComparison': 'chưa có kỳ so sánh',
  'overview.previous': 'kỳ trước',
  'overview.thisPeriod': 'Kỳ này',
  'overview.lastPeriod': 'Kỳ trước',
  'overview.revenueTrend': 'Doanh thu theo thời gian',
  'overview.revenueTrendHint': 'Mỗi điểm là doanh thu phát sinh trong khoảng đó, không phải luỹ kế.',
  'overview.mix': 'Cơ cấu doanh thu',
  'overview.otherRevenue': 'Doanh thu khác',
  'overview.expenses': 'Chi phí theo tài khoản',
  'overview.totalExpense': 'Tổng chi phí',
  'overview.grossMargin': 'Tỷ lệ lợi nhuận gộp',
  'overview.receivable': 'Công nợ phải thu',
  'overview.payable': 'Công nợ phải trả',
  'overview.partner': 'Đối tác',
  'overview.outstanding': 'Còn phải thanh toán',
  'overview.notYetDue': 'Trong hạn',
  'overview.overdue': 'Quá hạn',
  'overview.cashFlow': 'Dòng tiền',
  'overview.cashFlowHint':
    'Tiền thực tế đi qua tài khoản tiền mặt và ngân hàng, phân loại theo tài khoản đối ứng.',
  'overview.movement': 'Khoản mục',
  'overview.cashSales': 'Tiền thu từ bán hàng',
  'overview.cashPurchases': 'Tiền chi cho mua hàng',
  'overview.cashOperating': 'Tiền chi phí hoạt động',
  'overview.cashOther': 'Tiền thu chi khác',
  'overview.cashNet': 'Lưu chuyển tiền thuần',
  'overview.noRevenue': 'Kỳ này chưa có doanh thu ghi sổ.',
  'overview.noExpense': 'Kỳ này chưa có chi phí ghi sổ.',
  'overview.noReceivable': 'Không còn khoản phải thu nào đang mở.',
  'overview.noPayable': 'Không còn khoản phải trả nào đang mở.',
  'overview.unitBillion': ' tỷ',
  'overview.unitMillion': ' tr',
  'overview.unitThousand': ' ng',
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
  'term.line.edit.title': 'Sửa mốc đến hạn',
  'term.milestones.title': 'Các mốc đã cấu hình',
  'term.milestones.hint': 'Mở một mốc để sửa tỷ lệ, cách tính hạn và số ngày.',
  'term.milestones.empty': 'Chưa có mốc nào',
  'term.milestones.emptyHint': 'Một điều khoản chưa có mốc thì hoá đơn đến hạn ngay trong ngày lập.',
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
  'move.refused': 'Không thực hiện được',
  'move.draftTitle': 'Bút toán nháp',
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
  'field.lineAccountIdHint': 'Để trống để lấy theo nhóm sản phẩm, hoặc mặc định của công ty.',
  'field.counterpartAccountIdHint': 'Để trống để lấy theo đối tác, hoặc mặc định của công ty.',
  'field.categoryId': 'Nhóm sản phẩm',
  'field.incomeAccountId': 'Tài khoản doanh thu',
  'field.incomeAccountIdHint': 'Ghi có khi bán hàng, nếu nhóm sản phẩm không chỉ định khác.',
  'field.expenseAccountId': 'Tài khoản chi phí',
  'field.expenseAccountIdHint': 'Ghi nợ khi mua hàng, nếu nhóm sản phẩm không chỉ định khác.',
  'field.receivableAccountId': 'Tài khoản phải thu',
  'field.receivableAccountIdHint': 'Công nợ khách hàng, nếu đối tác không chỉ định khác.',
  'field.payableAccountId': 'Tài khoản phải trả',
  'field.payableAccountIdHint': 'Công nợ nhà cung cấp, nếu đối tác không chỉ định khác.',
  'field.taxId': 'Thuế',
  'field.secondTaxId': 'Thuế thứ hai',
  'field.secondTaxIdHint': 'Để trống nếu dòng chỉ chịu một loại thuế.',
  'field.taxAccountId': 'Tài khoản thuế',
  'field.taxAccountIdHint':
    'Chỉ dùng khi dòng có đúng một loại thuế. Với nhiều thuế, mỗi thuế hạch toán vào tài khoản đã cấu hình của nó.',
  'field.paymentType': 'Loại thanh toán',
  'field.partnerType': 'Loại đối tác',
  'field.destinationAccountId': 'Tài khoản đối ứng',
  'field.destinationAccountIdHint':
    'Tài khoản công nợ mà khoản thu/chi này tất toán: phải thu với khách hàng, phải trả với nhà cung cấp.',
  'field.memo': 'Nội dung',
  'field.paymentReference': 'Tham chiếu thanh toán',
  'field.reconcileLineId': 'Đối soát với khoản mở',
  'field.termValue': 'Kiểu giá trị',
  'field.valueAmount': 'Giá trị',
  'field.delayType': 'Cách tính hạn',
  'field.nbDays': 'Số ngày',
  'field.daysNextMonth': 'Ngày trong tháng sau',
  'field.daysNextMonthHint': 'Chỉ dùng với cách tính “ngày cố định của tháng sau”.',
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
  'overview.title': 'Accounting overview',
  'overview.subtitle': 'Result, position, and what is still owed, read straight from the posted ledger.',
  'overview.period': 'Reporting period',
  'overview.periodHint':
    'Pick a named window, or pick a year and narrow it to exact dates. Results are for the window; balances are as at its last day. The comparison is the window of equal length immediately before it.',
  'overview.preset.today': 'Today',
  'overview.preset.yesterday': 'Yesterday',
  'overview.preset.last7': 'Last 7 days',
  'overview.preset.last14': 'Last 14 days',
  'overview.preset.last30': 'Last 30 days',
  'overview.preset.month': 'This month',
  'overview.preset.lastMonth': 'Last month',
  'overview.preset.last90': 'Last 90 days',
  'overview.byYear': 'By year',
  'overview.custom': 'Narrow to exact dates',
  'overview.headline': 'Headline figures',
  'overview.headlineHint': 'Against the preceding window of equal length.',
  'overview.revenue': 'Net revenue',
  'overview.profit': 'Profit before tax',
  'overview.cash': 'Cash and equivalents',
  'overview.assets': 'Total assets',
  'overview.liabilities': 'Total liabilities',
  'overview.versusPrevious': 'against the previous period',
  'overview.noComparison': 'no period to compare',
  'overview.previous': 'previous',
  'overview.thisPeriod': 'This period',
  'overview.lastPeriod': 'Previous period',
  'overview.revenueTrend': 'Revenue over time',
  'overview.revenueTrendHint': 'Each point is what was earned in that bucket, not a running total.',
  'overview.mix': 'Revenue mix',
  'overview.otherRevenue': 'Other revenue',
  'overview.expenses': 'Expenses by account',
  'overview.totalExpense': 'Total expense',
  'overview.grossMargin': 'Gross margin',
  'overview.receivable': 'Receivables',
  'overview.payable': 'Payables',
  'overview.partner': 'Partner',
  'overview.outstanding': 'Outstanding',
  'overview.notYetDue': 'Not yet due',
  'overview.overdue': 'Overdue',
  'overview.cashFlow': 'Cash flow',
  'overview.cashFlowHint':
    'Money that actually moved through cash and bank accounts, filed by its counterpart.',
  'overview.movement': 'Movement',
  'overview.cashSales': 'Received from sales',
  'overview.cashPurchases': 'Paid for purchases',
  'overview.cashOperating': 'Paid for operating expenses',
  'overview.cashOther': 'Other movements',
  'overview.cashNet': 'Net cash movement',
  'overview.noRevenue': 'No revenue was posted in this period.',
  'overview.noExpense': 'No expense was posted in this period.',
  'overview.noReceivable': 'Nothing is outstanding from customers.',
  'overview.noPayable': 'Nothing is outstanding to suppliers.',
  'overview.unitBillion': 'B',
  'overview.unitMillion': 'M',
  'overview.unitThousand': 'K',
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
  'menu.defaults': 'Default accounts',
  'defaults.title': 'Default accounts',
  'defaults.kicker': 'Posting configuration',
  'defaults.subtitle': 'Decide the accounts once, so a document stops asking on every line.',
  'defaults.summary.categories': 'Configured categories',
  'defaults.company.title': 'Company defaults',
  'defaults.company.hint': 'Used when neither the product category nor the partner says otherwise.',
  'defaults.category.title': 'Set the accounts for a product category',
  'defaults.category.edit.title': 'Edit a product category',
  'defaults.category.hint': 'A category decides the revenue and expense accounts for what it holds.',
  'defaults.categories.title': 'Configured categories',
  'defaults.categories.hint': 'Open a row to change it. A category absent here uses the company defaults.',
  'defaults.categories.empty': 'No category has its own accounts yet',
  'defaults.categories.emptyHint': 'Everything posts to the company defaults.',
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
  'term.line.edit.title': 'Edit a due milestone',
  'term.milestones.title': 'Configured milestones',
  'term.milestones.hint': 'Open a milestone to change its share, due-date rule and number of days.',
  'term.milestones.empty': 'No milestones yet',
  'term.milestones.emptyHint': 'A term with no milestone makes its invoices due on the day they are issued.',
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
  'move.refused': 'That did not go through',
  'move.draftTitle': 'Draft entry',
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
  'field.destinationAccountIdHint':
    'The control account this payment settles: a receivable for a customer, a payable for a supplier.',
  'field.lineAccountIdHint': 'Leave empty to take it from the product category, or the company default.',
  'field.counterpartAccountIdHint': 'Leave empty to take it from the partner, or the company default.',
  'field.categoryId': 'Product category',
  'field.incomeAccountId': 'Revenue account',
  'field.incomeAccountIdHint': 'Credited on a sale, unless the product category says otherwise.',
  'field.expenseAccountId': 'Expense account',
  'field.expenseAccountIdHint': 'Debited on a purchase, unless the product category says otherwise.',
  'field.receivableAccountId': 'Receivable account',
  'field.receivableAccountIdHint': 'Customer balances, unless the partner says otherwise.',
  'field.payableAccountId': 'Payable account',
  'field.payableAccountIdHint': 'Supplier balances, unless the partner says otherwise.',
  'field.paymentReference': 'Payment reference',
  'field.reconcileLineId': 'Reconcile with open item',
  'field.termValue': 'Value type',
  'field.valueAmount': 'Value',
  'field.delayType': 'Due computation',
  'field.nbDays': 'Days',
  'field.daysNextMonth': 'Day of next month',
  'field.dateFrom': 'Date from',
  'field.daysNextMonthHint': 'Only used by the “fixed day of the next month” rule.',
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
    paid: 'Paid',
    partial: 'Partially Paid',
    reversed: 'Reversed',
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
    paid: 'Đã thanh toán',
    partial: 'Thanh toán một phần',
    reversed: 'Đã đảo',
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
