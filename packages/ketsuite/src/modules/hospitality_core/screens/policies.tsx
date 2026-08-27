import { ListScreenFrame } from './page-frame.tsx'
import { dataTable, emptyState, feedback, type Frame, policyColumns, type PolicyRow, RecordForm, Section, stack, type TemplateResult, type Translator } from './shared.tsx'

export const policiesScreen = (
  _: Translator,
  rows: PolicyRow[],
  frame: Frame,
  state?: string | null,
): TemplateResult => (
  <ListScreenFrame
    translator={_}
    title={_('hospitality_core.screen.policies.title')}
    frame={frame}
    body={stack([
      feedback(_, state),
      <Section
        title={_('hospitality_core.screen.policies.create')}
        description={_('hospitality_core.screen.policies.createHint')}
        body={
          <RecordForm
            action="/admin/hospitality/policies"
            method="post"
            submit={_('hospitality_core.action.savePolicy')}
            submitVariant="primary"
            hidden={{ operation: 'save-policy' }}
            fields={[
              { name: 'code', label: _('hospitality_core.col.code'), required: true },
              { name: 'name', label: _('hospitality_core.col.name'), required: true },
              {
                name: 'type',
                label: _('hospitality_core.col.policyType'),
                type: 'select',
                value: 'flexible',
                options: ['flexible', 'moderate', 'strict', 'non_refundable'].map((value) => ({
                  value,
                  label: _(`hospitality_core.policy.${value}`),
                })),
                required: true,
              },
              {
                name: 'freeCancellationHours',
                label: _('hospitality_core.col.freeCancellation'),
                type: 'number',
                value: 24,
                help: _('hospitality_core.field.freeCancellationHint'),
              },
              {
                name: 'penaltyPercent',
                label: _('hospitality_core.col.penalty'),
                type: 'decimal',
                value: '0',
                help: _('hospitality_core.field.penaltyHint'),
              },
              { name: 'description', label: _('hospitality_core.field.description'), type: 'textarea' },
            ]}
          />
        }
      />,
      rows.length
        ? dataTable(_, { columns: policyColumns(_), rows, id: (row) => row.id })
        : emptyState(
            _('hospitality_core.screen.policies.empty'),
            _('hospitality_core.screen.policies.emptyHint'),
          ),
    ])}
  />
)
