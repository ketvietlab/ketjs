import type { Translator } from '@ketvietlab/ketjs'
import type { TemplateResult } from '@ketvietlab/ketjs-view'
import {
  cardGrid,
  contentCard,
  framedPage as Framed,
  icon,
  metric,
  recordWorkspace as RecordWorkspace,
  section as Section,
  stack,
} from '../../ui/index.ts'
import type { Frame } from '../../ui/index.ts'

type Counts = {
  accounts: number
  journals: number
  draft: number
  posted: number
  unpaid: number
}

type OverviewCard = {
  id: string
  title: string
  summary: string
  href: string
  value?: number
}

const cards = (_: Translator, locale: string, items: OverviewCard[]): TemplateResult =>
  cardGrid({
    items,
    id: (item) => item.id,
    card: (item) =>
      contentCard({
        title: item.title,
        summary: item.summary,
        href: `${item.href}${locale}`,
        body:
          item.value === undefined
            ? undefined
            : metric({
                label: _('account_backend.dashboard.records'),
                value: String(item.value),
              }),
      }),
  })

export const accountingOverviewScreen = (
  _: Translator,
  options: { counts: Counts; frame: Frame; locale: string; standard: string },
): TemplateResult => {
  const { counts } = options
  return (
    <Framed
      translator={_}
      title={_('account_backend.dashboard.title')}
      frame={options.frame}
      body={
        <RecordWorkspace
          kicker={_('account_backend.dashboard.kicker')}
          title={_('account_backend.dashboard.title')}
          subtitle={`${_('account_backend.dashboard.subtitle')} · ${options.standard}`}
          imageFallback={icon('banknote')}
          summary={[
            { id: 'draft', label: _('account_backend.dashboard.draft'), value: counts.draft },
            { id: 'posted', label: _('account_backend.dashboard.posted'), value: counts.posted },
            { id: 'unpaid', label: _('account_backend.dashboard.unpaid'), value: counts.unpaid },
            { id: 'accounts', label: _('account_backend.menu.accounts'), value: counts.accounts },
          ]}
          body={stack(
            [
              <Section
                title={_('account_backend.dashboard.operations')}
                description={_('account_backend.dashboard.operationsHint')}
                body={cards(_, options.locale, [
                  {
                    id: 'customer-invoices',
                    title: _('account_backend.menu.customerInvoices'),
                    summary: _('account_backend.dashboard.customerInvoicesHint'),
                    href: '/admin/customer-invoices',
                    value: counts.unpaid,
                  },
                  {
                    id: 'vendor-bills',
                    title: _('account_backend.menu.vendorBills'),
                    summary: _('account_backend.dashboard.vendorBillsHint'),
                    href: '/admin/vendor-bills',
                  },
                  {
                    id: 'entries',
                    title: _('account_backend.menu.entries'),
                    summary: _('account_backend.dashboard.entriesHint'),
                    href: '/admin/journal-entries',
                    value: counts.draft + counts.posted,
                  },
                  {
                    id: 'payments',
                    title: _('account_backend.menu.payments'),
                    summary: _('account_backend.dashboard.paymentsHint'),
                    href: '/admin/payments',
                  },
                ])}
              />,
              <Section
                title={_('account_backend.dashboard.reports')}
                description={_('account_backend.dashboard.reportsHint')}
                body={cards(_, options.locale, [
                  {
                    id: 'trial',
                    title: _('account_backend.menu.trialBalance'),
                    summary: _('account_backend.dashboard.trialBalanceHint'),
                    href: '/admin/trial-balance',
                  },
                  {
                    id: 'ledger',
                    title: _('account_backend.menu.generalLedger'),
                    summary: _('account_backend.dashboard.generalLedgerHint'),
                    href: '/admin/general-ledger',
                  },
                  {
                    id: 'partner',
                    title: _('account_backend.menu.partnerStatement'),
                    summary: _('account_backend.dashboard.partnerLedgerHint'),
                    href: '/admin/partner-statement',
                  },
                ])}
              />,
              <Section
                title={_('account_backend.menu.configuration')}
                description={_('account_backend.dashboard.configurationHint')}
                body={cards(_, options.locale, [
                  {
                    id: 'accounts',
                    title: _('account_backend.menu.accounts'),
                    summary: _('account_backend.dashboard.accountsHint'),
                    href: '/admin/accounts',
                    value: counts.accounts,
                  },
                  {
                    id: 'journals',
                    title: _('account_backend.menu.journals'),
                    summary: _('account_backend.dashboard.journalsHint'),
                    href: '/admin/journals',
                    value: counts.journals,
                  },
                  {
                    id: 'taxes',
                    title: _('account_backend.menu.taxes'),
                    summary: _('account_backend.dashboard.taxesHint'),
                    href: '/admin/taxes',
                  },
                  {
                    id: 'terms',
                    title: _('account_backend.menu.paymentTerms'),
                    summary: _('account_backend.dashboard.paymentTermsHint'),
                    href: '/admin/payment-terms',
                  },
                ])}
              />,
            ],
            'loose',
          )}
        />
      }
    />
  )
}
