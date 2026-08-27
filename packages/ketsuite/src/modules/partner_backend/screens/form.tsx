import type { JSXChild, TemplateResult } from '@ketvietlab/ketjs-view'
import type { Translator } from '@ketvietlab/ketjs'
import {
  badge,
  button,
  FormCluster,
  FormPage,
  linkButton,
  modalWorkspace,
  RecordForm,
  RecordMore,
  Section,
  shell,
  stack,
  Surface,
} from '../../../ui/index.ts'
import type { FormOption, Frame } from '../../../ui/index.ts'
import { localized } from '../../backend/screen.ts'
import type { PartnerDetail } from './types.ts'

export const partnerFormScreen = (
  _: Translator,
  row: PartnerDetail,
  options: {
    parents: FormOption[]
    parentControl?: JSXChild
    terms?: { creditLimit?: string | number | null; note?: string | null } | null
    errors?: string[]
    integration?: JSXChild
    collaboration: JSXChild
    addressForms: Array<{ title: string; body: JSXChild }>
    overlay?: JSXChild
  },
  frame: Frame,
  locale = '',
): TemplateResult => {
  const heldRoles = new Set(row.roles.map((role) => role.role))
  const status = badge(
    row.active ? _('partner_backend.state.active') : _('partner_backend.state.archived'),
    row.active ? 'positive' : 'neutral',
  )
  const identityForm = (
    <RecordForm
      id="partner-identity-form"
      scope="partner-identity"
      action={localized(`/admin/partner/partners/${row.id}`, locale)}
      submit={_('partner_backend.action.save')}
      submitVariant="primary"
      submitPlacement="external"
      errors={options.errors}
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
            checked: heldRoles.has(role),
          })),
        },
        {
          name: 'name',
          label: _('partner_backend.field.name'),
          value: row.name,
          required: true,
          span: 'full',
        },
        {
          name: 'kind',
          label: _('partner_backend.field.kind'),
          type: 'select',
          value: row.kind,
          options: ['person', 'company'].map((value) => ({ value, label: _(`partner.kind.${value}`) })),
        },
        {
          name: 'parentId',
          label: _('partner_backend.field.parent'),
          type: 'select',
          control: options.parentControl,
          value: row.parentId,
          options: [{ value: '', label: '—' }, ...options.parents],
        },
        { name: 'ref', label: _('partner_backend.field.ref'), value: row.ref },
        { name: 'vat', label: _('partner_backend.field.vat'), value: row.vat },
        { name: 'email', label: _('partner_backend.field.email'), type: 'email', value: row.email },
        { name: 'phone', label: _('partner_backend.field.phone'), type: 'tel', value: row.phone },
        { name: 'lang', label: _('partner_backend.field.lang'), value: row.lang },
      ]}
    />
  )
  const body = stack([
    <Section
      title={_('partner_backend.detail.identity')}
      description={_('partner_backend.detail.identityHint')}
      body={<Surface body={identityForm} />}
    />,
    <Section
      title={_('partner_backend.addresses.title')}
      description={_('partner_backend.addresses.hint')}
      body={stack(
        options.addressForms.map((address) => (
          <Section title={address.title} body={<Surface body={address.body} />} />
        )),
      )}
    />,
    <Section
      title={_('partner_backend.terms.title')}
      description={_('partner_backend.terms.hint')}
      body={
        <Surface
          body={
            <RecordForm
              action={localized(`/admin/partner/partners/${row.id}/terms`, locale)}
              submit={_('partner_backend.action.saveTerms')}
              submitVariant="secondary"
              fields={[
                {
                  name: 'creditLimit',
                  label: _('partner_backend.terms.creditLimit'),
                  type: 'decimal',
                  value: options.terms?.creditLimit,
                },
                {
                  name: 'note',
                  label: _('partner_backend.terms.note'),
                  type: 'textarea',
                  value: options.terms?.note,
                  span: 'full',
                },
              ]}
            />
          }
        />
      }
    />,
  ])
  const actions = (
    <FormCluster
      label={_('partner_backend.detail.actions')}
      forms={[
        button({
          label: _('partner_backend.action.save'),
          type: 'submit',
          form: 'partner-identity-form',
          variant: 'primary',
        }),
        <RecordMore
          label={_('partner_backend.action.more')}
          body={
            <FormCluster
              label={_('partner_backend.action.more')}
              forms={[
                ...(options.integration ? [options.integration] : []),
                ...(row.email
                  ? [
                      linkButton({
                        label: _('partner_backend.action.email'),
                        href: `mailto:${row.email}`,
                        icon: 'mail',
                        variant: 'secondary',
                      }),
                    ]
                  : []),
                ...(row.phone
                  ? [
                      linkButton({
                        label: _('partner_backend.action.call'),
                        href: `tel:${row.phone}`,
                        icon: 'phone',
                        variant: 'secondary',
                      }),
                    ]
                  : []),
              ]}
            />
          }
        />,
      ]}
    />
  )
  const workspace = shell(
    _,
    row.name,
    <FormPage
      title={row.name}
      description={row.ref || _(`partner.kind.${row.kind}`)}
      status={status}
      actions={actions}
      body={body}
      aside={options.collaboration}
      asideLabel={_('partner_backend.collaboration.label')}
    />,
    { ...frame, topbar: false, titled: false },
  )
  return options.overlay ? modalWorkspace(workspace, options.overlay) : workspace
}
