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

export type PaymentTermFormRow = Record<string, unknown>

export type PaymentTermFormScreenOptions = {
  frame: Frame
  fields: FormField[]
  action: string
  cancelHref: string
  editing?: PaymentTermFormRow | null
  errors?: string[]
}

export type PaymentTermLineFormScreenOptions = {
  frame: Frame
  fields: FormField[]
  action: string
  cancelHref: string
  editing?: PaymentTermFormRow | null
  errors?: string[]
}

const paymentTermTitle = (_: Translator, editing?: PaymentTermFormRow | null): string =>
  editing ? _('account_backend.term.edit.title') : _('account_backend.term.create.title')

const paymentTermLineTitle = (_: Translator, editing?: PaymentTermFormRow | null): string =>
  editing ? _('account_backend.term.line.edit.title') : _('account_backend.term.line.create.title')

export const paymentTermFormModal = (
  _: Translator,
  options: PaymentTermFormScreenOptions,
): TemplateResult => {
  const title = paymentTermTitle(_, options.editing)
  return modalForm({
    id: 'account-payment-term-form',
    title,
    description: options.editing ? String(options.editing.name) : _('account_backend.term.create.hint'),
    closeHref: options.cancelHref,
    closeLabel: _('account_backend.action.cancelEdit'),
    presentation: 'sheet',
    size: 'default',
    form: {
      id: 'payment-term-create-form',
      scope: 'account-payment-term',
      action: options.action,
      submit: options.editing ? _('account_backend.action.save') : _('account_backend.action.createTerm'),
      submitVariant: 'primary',
      cancelHref: options.cancelHref,
      cancelLabel: _('account_backend.action.cancelEdit'),
      fields: options.fields,
      errors: options.errors,
    },
  })
}

export const paymentTermLineFormModal = (
  _: Translator,
  options: PaymentTermLineFormScreenOptions,
): TemplateResult => {
  const title = paymentTermLineTitle(_, options.editing)
  return modalForm({
    id: 'account-payment-term-line-form',
    title,
    description: _('account_backend.term.line.create.hint'),
    closeHref: options.cancelHref,
    closeLabel: _('account_backend.action.cancelEdit'),
    presentation: 'sheet',
    size: 'large',
    form: {
      id: 'payment-term-line-form',
      scope: 'account-payment-term-line',
      action: options.action,
      submit: options.editing ? _('account_backend.action.save') : _('account_backend.action.addTermLine'),
      submitVariant: 'primary',
      cancelHref: options.cancelHref,
      cancelLabel: _('account_backend.action.cancelEdit'),
      hidden: { action: 'line' },
      fields: options.fields,
      errors: options.errors,
    },
  })
}

export const paymentTermFormScreen = (
  _: Translator,
  options: PaymentTermFormScreenOptions,
): TemplateResult => {
  const formId = 'payment-term-create-form'
  const title = paymentTermTitle(_, options.editing)
  return shell(
    _,
    title,
    <FormPage
      scope="account-payment-term-form-page"
      title={title}
      description={options.editing ? String(options.editing.name) : _('account_backend.term.create.hint')}
      status={
        options.editing
          ? badge(
              options.editing.active ? _('account_backend.active') : _('account_backend.archived'),
              options.editing.active ? 'positive' : 'neutral',
              options.editing.active ? 'active' : 'archived',
            )
          : undefined
      }
      actions={
        <FormCluster
          label={title}
          forms={[
            button({
              label: options.editing
                ? _('account_backend.action.save')
                : _('account_backend.action.createTerm'),
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
              scope="account-payment-term"
              action={options.action}
              submit={
                options.editing ? _('account_backend.action.save') : _('account_backend.action.createTerm')
              }
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

export const paymentTermLineFormScreen = (
  _: Translator,
  options: PaymentTermLineFormScreenOptions,
): TemplateResult => {
  const formId = 'payment-term-line-form'
  const title = paymentTermLineTitle(_, options.editing)
  return shell(
    _,
    title,
    <FormPage
      scope="account-payment-term-line-form-page"
      title={title}
      description={_('account_backend.term.line.create.hint')}
      actions={
        <FormCluster
          label={title}
          forms={[
            button({
              label: options.editing
                ? _('account_backend.action.save')
                : _('account_backend.action.addTermLine'),
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
              scope="account-payment-term-line"
              action={options.action}
              submit={
                options.editing ? _('account_backend.action.save') : _('account_backend.action.addTermLine')
              }
              submitVariant="primary"
              submitPlacement="external"
              hidden={{ action: 'line' }}
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
