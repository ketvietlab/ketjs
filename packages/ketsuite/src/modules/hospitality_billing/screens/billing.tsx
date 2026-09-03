import {
  dataTable,
  emptyState,
  feedback,
  type FolioBillingRow,
  folioColumns,
  type Frame,
  ListScreen,
  linkButton,
  RecordForm,
  stack,
  type TemplateResult,
  type Translator,
} from './shared.tsx'

export const billingScreen = (
  _: Translator,
  rows: FolioBillingRow[],
  frame: Frame,
  state?: string | null,
): TemplateResult => (
  <ListScreen
    translator={_}
    title={_('hospitality_billing.screen.title')}
    subtitle={_('hospitality_billing.screen.subtitle')}
    frame={frame}
    body={stack([
      feedback(_, state),
      rows.length
        ? dataTable(_, { columns: folioColumns(_), rows, id: (row) => row.folioId })
        : // A dead end that names the next step and does not link to it is the
          // defect the hospitality review filed seven times; the rules screen is
          // where an operator has to go from here.
          emptyState(_('hospitality_billing.screen.empty'), _('hospitality_billing.screen.emptyHint'), {
            actions: linkButton({
              label: _('hospitality_billing.menu.chargeRules'),
              href: '/admin/hospitality/billing/rules',
            }),
          }),
      // A hotel closes folios all night with nobody at the desk. One press bills
      // everything that is only waiting for one.
      rows.some((row) => !row.moveId && !row.blockers.length) ? (
        <RecordForm
          action="/admin/hospitality/billing"
          method="post"
          submit={_('hospitality_billing.action.invoiceAll')}
          submitVariant="secondary"
          hidden={{ operation: 'queue-closed' }}
          fields={[]}
        />
      ) : null,
    ])}
  />
)
