import type { Translator } from '@ketvietlab/ketjs'
import type { TemplateResult } from '@ketvietlab/ketjs-view'
import { button, FormCluster, FormPage, linkButton, RecordForm, shell, Surface } from '../../../ui/index.ts'
import type { FormOption, Frame } from '../../../ui/index.ts'

export type TransferCreateScreenOptions = {
  pickingTypes: FormOption[]
  /** Locale-aware endpoint supplied by the route. */
  action: string
  /** Locale-aware transfer-list destination supplied by the route. */
  cancelHref: string
  errors?: readonly string[]
}

export const transferCreateScreen = (
  _: Translator,
  options: TransferCreateScreenOptions,
  frame: Frame,
): TemplateResult => {
  const formId = 'transfer-create-form'

  return shell(
    _,
    _('stock_backend.transfer.create.title'),
    <FormPage
      variant="operational"
      frame={frame}
      scope="transfer-create"
      title={_('stock_backend.transfer.create.title')}
      description={_('stock_backend.transfer.create.hint')}
      actions={
        <FormCluster
          label={_('stock_backend.transfer.actions.label')}
          forms={[
            button({
              label: _('stock_backend.action.create'),
              type: 'submit',
              form: formId,
              variant: 'primary',
            }),
            linkButton({
              label: _('stock_backend.action.cancel'),
              href: options.cancelHref,
              variant: 'secondary',
            }),
          ]}
        />
      }
      body={
        <Surface
          body={
            <RecordForm
              id={formId}
              scope="transfer-create"
              action={options.action}
              submit={_('stock_backend.action.create')}
              submitVariant="primary"
              submitPlacement="external"
              errors={options.errors}
              fields={[
                {
                  name: 'name',
                  label: _('stock_backend.field.reference'),
                  required: true,
                  help: _('stock_backend.transfer.create.reference.help'),
                },
                {
                  name: 'pickingTypeId',
                  label: _('stock_backend.field.operationType'),
                  type: 'select',
                  options: options.pickingTypes,
                  required: true,
                },
                {
                  name: 'scheduledDate',
                  label: _('stock_backend.field.scheduledDate'),
                  type: 'datetime-local',
                },
              ]}
            />
          }
        />
      }
    />,
    { ...frame, topbar: false, titled: false },
  )
}
