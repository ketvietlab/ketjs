import type { Translator } from '@ketvietlab/ketjs'
import type { TemplateResult } from '@ketvietlab/ketjs-view'
import {
  button,
  FormCluster,
  FormPage,
  linkButton,
  modalForm,
  RecordForm,
  shell,
  Surface,
} from '../../../ui/index.ts'
import type { FormField, Frame } from '../../../ui/index.ts'

export type JournalEntryCreateScreenOptions = {
  frame: Frame
  fields: FormField[]
  action: string
  cancelHref: string
  idempotencyKey: string
  errors?: string[]
}

export const journalEntryCreateModal = (
  _: Translator,
  options: JournalEntryCreateScreenOptions,
): TemplateResult =>
  modalForm({
    id: 'account-journal-entry-form',
    title: _('account_backend.entry.create.title'),
    description: _('account_backend.entry.create.hint'),
    closeHref: options.cancelHref,
    closeLabel: _('account_backend.action.cancelEdit'),
    presentation: 'sheet',
    size: 'large',
    form: {
      id: 'journal-entry-create-form',
      scope: 'account-journal-entry',
      action: options.action,
      submit: _('account_backend.action.create'),
      submitVariant: 'primary',
      cancelHref: options.cancelHref,
      cancelLabel: _('account_backend.action.cancelEdit'),
      fields: options.fields,
      errors: options.errors,
      hidden: { id: options.idempotencyKey },
    },
  })

export const journalEntryCreateScreen = (
  _: Translator,
  options: JournalEntryCreateScreenOptions,
): TemplateResult => {
  const formId = 'journal-entry-create-form'
  const title = _('account_backend.entry.create.title')

  return shell(
    _,
    title,
    <FormPage
      variant="operational"
      frame={options.frame}
      scope="account-journal-entry-form-page"
      title={title}
      description={_('account_backend.entry.create.hint')}
      actions={
        <FormCluster
          label={title}
          forms={[
            button({
              label: _('account_backend.action.create'),
              type: 'submit',
              form: formId,
              variant: 'primary',
            }),
            linkButton({
              label: _('account_backend.action.cancelEdit'),
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
              scope="account-journal-entry"
              action={options.action}
              submit={_('account_backend.action.create')}
              submitVariant="primary"
              submitPlacement="external"
              fields={options.fields}
              errors={options.errors}
              hidden={{ id: options.idempotencyKey }}
            />
          }
        />
      }
    />,
    { ...options.frame, topbar: false, titled: false },
  )
}
