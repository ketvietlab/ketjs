import type { Translator } from '@ketvietlab/ketjs'
import type { TemplateResult } from '@ketvietlab/ketjs-view'
import {
  badge,
  button,
  FormCluster,
  FormPage,
  linkButton,
  modalForm,
  RecordForm,
  shell,
  stack,
  Surface,
} from '../../../ui/index.ts'
import type { FormField, Frame } from '../../../ui/index.ts'

export type JournalFormRow = Record<string, unknown>

export type JournalFormScreenOptions = {
  frame: Frame
  fields: FormField[]
  action: string
  cancelHref: string
  editing?: JournalFormRow | null
  errors?: string[]
}

export const journalFormModal = (_: Translator, options: JournalFormScreenOptions): TemplateResult => {
  const editing = options.editing ?? null
  const title = editing ? _('account_backend.journal.edit.title') : _('account_backend.journal.create.title')
  return modalForm({
    id: 'account-journal-form',
    title,
    description: editing
      ? `${String(editing.code)} · ${String(editing.name)}`
      : _('account_backend.journal.create.hint'),
    closeHref: options.cancelHref,
    closeLabel: _('account_backend.action.cancelEdit'),
    presentation: 'sheet',
    size: 'large',
    form: {
      id: 'journal-create-form',
      scope: 'account-journal',
      action: options.action,
      submit: editing ? _('account_backend.action.save') : _('account_backend.action.create'),
      submitVariant: 'primary',
      cancelHref: options.cancelHref,
      cancelLabel: _('account_backend.action.cancelEdit'),
      fields: options.fields,
      errors: options.errors,
    },
  })
}

export const journalFormScreen = (_: Translator, options: JournalFormScreenOptions): TemplateResult => {
  const editing = options.editing ?? null
  const formId = 'journal-create-form'
  const title = editing ? _('account_backend.journal.edit.title') : _('account_backend.journal.create.title')

  return shell(
    _,
    title,
    <FormPage
      scope="account-journal-form-page"
      title={title}
      description={
        editing
          ? `${String(editing.code)} · ${String(editing.name)}`
          : _('account_backend.journal.create.hint')
      }
      status={
        editing
          ? badge(
              editing.active ? _('account_backend.active') : _('account_backend.archived'),
              editing.active ? 'positive' : 'neutral',
              editing.active ? 'active' : 'archived',
            )
          : undefined
      }
      actions={
        <FormCluster
          label={title}
          forms={[
            button({
              label: editing ? _('account_backend.action.save') : _('account_backend.action.create'),
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
      body={stack([
        <Surface
          body={
            <RecordForm
              id={formId}
              scope="account-journal"
              action={options.action}
              submit={editing ? _('account_backend.action.save') : _('account_backend.action.create')}
              submitVariant="primary"
              submitPlacement="external"
              fields={options.fields}
              errors={options.errors}
            />
          }
        />,
      ])}
    />,
    { ...options.frame, topbar: false, titled: false },
  )
}
