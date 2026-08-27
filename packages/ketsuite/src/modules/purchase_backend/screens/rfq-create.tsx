import type { Translator } from '@ketvietlab/ketjs'
import type { TemplateResult } from '@ketvietlab/ketjs-view'
import {
  button,
  FormCluster,
  FormPage,
  linkButton,
  RecordForm,
  shell,
  stack,
  Surface,
} from '../../../ui/index.ts'
import type { FormField, Frame } from '../../../ui/index.ts'
import { missingSetup, rejection } from './shared.tsx'

export type RfqCreateScreenOptions = {
  frame: Frame
  fields: FormField[]
  action: string
  cancelHref: string
  invalid?: string | null
  setup?: { pickingTypes: number; vendors: number }
}

export const rfqCreateScreen = (_: Translator, options: RfqCreateScreenOptions): TemplateResult => {
  const formId = 'purchase-rfq-create'
  return shell(
    _,
    _('purchase_backend.action.createRfq'),
    <FormPage
      scope="purchase-rfq-create-form-page"
      title={_('purchase_backend.action.createRfq')}
      description={_('purchase_backend.rfqs.title')}
      actions={
        <FormCluster
          label={_('purchase_backend.action.createRfq')}
          forms={[
            button({
              label: _('purchase_backend.action.createRfq'),
              type: 'submit',
              form: formId,
              variant: 'primary',
            }),
            linkButton({
              label: _('purchase_backend.action.cancel'),
              href: options.cancelHref,
              variant: 'secondary',
            }),
          ]}
        />
      }
      body={stack([
        rejection(_, options.invalid),
        options.setup ? missingSetup(_, options.setup) : null,
        <Surface
          body={
            <RecordForm
              id={formId}
              scope="purchase-rfq-create"
              action={options.action}
              submit={_('purchase_backend.action.createRfq')}
              submitVariant="primary"
              submitPlacement="external"
              fields={options.fields}
            />
          }
        />,
      ])}
    />,
    { ...options.frame, topbar: false, titled: false },
  )
}
