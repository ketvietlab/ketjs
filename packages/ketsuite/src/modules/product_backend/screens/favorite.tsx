import type { TemplateResult } from '@ketvietlab/ketjs-view'
import type { Translator } from '@ketvietlab/ketjs'
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
import { localized } from '../../backend/screen.ts'

const favoriteFields = (_: Translator): FormField[] => [
  { name: 'name', label: _('product_backend.favorite.name'), required: true },
  { name: 'default', label: _('product_backend.favorite.default'), type: 'checkbox' },
]

export const favoriteModal = (
  _: Translator,
  returnTo: string,
  locale = '',
  errors?: readonly string[],
): TemplateResult =>
  modalForm({
    id: 'product-favorite-create',
    title: _('product_backend.favorite.create'),
    closeHref: localized(returnTo, locale),
    closeLabel: _('product_backend.action.cancel'),
    presentation: 'dialog',
    form: {
      id: 'product-favorite-create-form',
      scope: 'product-favorite-create',
      action: localized('/admin/product/templates/favorites/new', locale),
      submit: _('product_backend.favorite.save'),
      submitVariant: 'primary',
      errors,
      hidden: { returnTo },
      fields: favoriteFields(_),
      cancelHref: localized(returnTo, locale),
      cancelLabel: _('product_backend.action.cancel'),
    },
  })

export const favoriteScreen = (
  _: Translator,
  frame: Frame,
  returnTo: string,
  locale = '',
  errors?: readonly string[],
): TemplateResult => {
  const formId = 'product-favorite-create-form'

  return shell(
    _,
    _('product_backend.favorite.create'),
    <FormPage
      variant="operational"
      frame={frame}
      scope="product-favorite-create"
      title={_('product_backend.favorite.create')}
      actions={
        <FormCluster
          label={_('product_backend.favorite.create')}
          forms={[
            button({
              label: _('product_backend.favorite.save'),
              type: 'submit',
              form: formId,
              variant: 'primary',
            }),
            linkButton({
              label: _('product_backend.action.cancel'),
              href: localized(returnTo, locale),
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
              scope="product-favorite-create"
              action={localized('/admin/product/templates/favorites/new', locale)}
              submit={_('product_backend.favorite.save')}
              submitVariant="primary"
              submitPlacement="external"
              errors={errors}
              hidden={{ returnTo }}
              fields={favoriteFields(_)}
            />
          }
        />
      }
    />,
    { ...frame, topbar: false, titled: false },
  )
}
