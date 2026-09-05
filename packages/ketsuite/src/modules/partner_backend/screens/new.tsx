import type { JSXChild, TemplateResult } from '@ketvietlab/ketjs-view'
import type { Translator } from '@ketvietlab/ketjs'
import {
  button,
  FormCluster,
  FormPage,
  linkButton,
  RecordForm,
  Section,
  shell,
  Surface,
} from '../../../ui/index.ts'
import type { FormOption, Frame } from '../../../ui/index.ts'
import { localized } from '../../backend/screen.ts'

export const newPartnerScreen = (
  _: Translator,
  parents: FormOption[],
  frame: Frame,
  errors?: string[],
  locale = '',
  parentControl?: JSXChild,
): TemplateResult =>
  shell(
    _,
    _('partner_backend.create.title'),
    <FormPage
      variant="operational"
      frame={frame}
      title={_('partner_backend.create.title')}
      description={_('partner_backend.create.subtitle')}
      actions={
        <FormCluster
          label={_('partner_backend.create.actions')}
          forms={[
            button({
              label: _('partner_backend.action.create'),
              type: 'submit',
              form: 'partner-create-form',
              variant: 'primary',
            }),
            linkButton({
              label: _('partner_backend.action.cancel'),
              href: localized('/admin/partner/partners', locale),
              variant: 'tertiary',
            }),
          ]}
        />
      }
      body={
        <Section
          title={_('partner_backend.detail.identity')}
          description={_('partner_backend.detail.identityHint')}
          body={
            <Surface
              body={
                <RecordForm
                  id="partner-create-form"
                  scope="partner-create"
                  action={localized('/admin/partner/partners/new', locale)}
                  submit={_('partner_backend.action.create')}
                  submitVariant="primary"
                  submitPlacement="external"
                  errors={errors}
                  fields={[
                    {
                      name: 'roles',
                      label: _('partner_backend.roles.title'),
                      type: 'checkbox-group',
                      span: 'full',
                      options: ['customer', 'supplier', 'employee'].map((role) => ({
                        name: role,
                        value: '1',
                        label: _(`partner.role.${role}`),
                      })),
                    },
                    {
                      name: 'name',
                      label: _('partner_backend.field.name'),
                      required: true,
                      span: 'full',
                    },
                    {
                      name: 'kind',
                      label: _('partner_backend.field.kind'),
                      type: 'radio',
                      value: 'company',
                      span: 'full',
                      options: ['company', 'person'].map((value) => ({
                        value,
                        label: _(`partner.kind.${value}`),
                      })),
                    },
                    {
                      name: 'parentId',
                      label: _('partner_backend.field.parent'),
                      type: 'select',
                      control: parentControl,
                      options: [{ value: '', label: '—' }, ...parents],
                      span: 'full',
                    },
                    { name: 'ref', label: _('partner_backend.field.ref') },
                    { name: 'vat', label: _('partner_backend.field.vat') },
                    { name: 'email', label: _('partner_backend.field.email'), type: 'email' },
                    { name: 'phone', label: _('partner_backend.field.phone'), type: 'tel' },
                  ]}
                />
              }
            />
          }
        />
      }
    />,
    { ...frame, topbar: false, titled: false },
  )
