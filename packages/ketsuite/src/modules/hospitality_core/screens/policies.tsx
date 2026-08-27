import { ListScreenFrame } from './page-frame.tsx'
import {
  dataTable,
  emptyState,
  feedback,
  type Frame,
  linkButton,
  modalForm,
  modalWorkspace,
  policyColumns,
  type PolicyRow,
  stack,
  type TemplateResult,
  type Translator,
} from './shared.tsx'

export const policiesScreen = (
  _: Translator,
  rows: PolicyRow[],
  frame: Frame,
  state?: string | null,
  modal?: {
    open: boolean
    createHref: string
    closeHref: string
    action: string
    errors?: readonly string[]
    values?: Record<string, string>
  },
): TemplateResult => {
  const list = (
    <ListScreenFrame
      translator={_}
      title={_('hospitality_core.screen.policies.title')}
      frame={frame}
      actions={linkButton({
        label: _('hospitality_core.screen.policies.create'),
        href: modal?.createHref ?? '/admin/hospitality/policies?create=1',
        variant: 'primary',
      })}
      body={stack([
        feedback(_, state),
        rows.length
          ? dataTable(_, { columns: policyColumns(_), rows, id: (row) => row.id })
          : emptyState(
              _('hospitality_core.screen.policies.empty'),
              _('hospitality_core.screen.policies.emptyHint'),
            ),
      ])}
    />
  )
  if (!modal?.open) return list
  return modalWorkspace(
    list,
    modalForm({
      id: 'hospitality-policy-create',
      title: _('hospitality_core.screen.policies.create'),
      description: _('hospitality_core.screen.policies.createHint'),
      closeHref: modal.closeHref,
      closeLabel: _('hospitality_core.action.cancel'),
      presentation: 'dialog',
      form: {
        id: 'hospitality-policy-create-form',
        scope: 'hospitality-policy-create',
        action: modal.action,
        submit: _('hospitality_core.action.savePolicy'),
        submitVariant: 'primary',
        errors: modal.errors,
        cancelHref: modal.closeHref,
        cancelLabel: _('hospitality_core.action.cancel'),
        hidden: { operation: 'save-policy' },
        fields: [
          { name: 'code', label: _('hospitality_core.col.code'), value: modal.values?.code, required: true },
          { name: 'name', label: _('hospitality_core.col.name'), value: modal.values?.name, required: true },
          {
            name: 'type',
            label: _('hospitality_core.col.policyType'),
            type: 'select',
            value: modal.values?.type ?? 'flexible',
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
            value: modal.values?.freeCancellationHours ?? 24,
            help: _('hospitality_core.field.freeCancellationHint'),
          },
          {
            name: 'penaltyPercent',
            label: _('hospitality_core.col.penalty'),
            type: 'decimal',
            value: modal.values?.penaltyPercent ?? '0',
            help: _('hospitality_core.field.penaltyHint'),
          },
          {
            name: 'description',
            label: _('hospitality_core.field.description'),
            type: 'textarea',
            value: modal.values?.description,
          },
        ],
      },
    }),
  )
}
