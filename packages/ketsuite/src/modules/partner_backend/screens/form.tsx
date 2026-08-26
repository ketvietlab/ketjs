import type { JSXChild, TemplateResult } from '@ketvietlab/ketjs-view'
import type { Translator } from '@ketvietlab/ketjs'
import {
  badge,
  button,
  FormCluster,
  linkButton,
  PartnerFacts,
  PartnerInitials,
  PartnerPanel,
  RecordForm,
  RecordWorkspace,
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
    addressForms: Array<{ title: string; body: JSXChild }>
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
      action={localized(`/admin/partner/partners/${row.id}`, locale)}
      submit={_('partner_backend.action.save')}
      submitVariant="primary"
      submitPlacement="external"
      errors={options.errors}
      fields={[
        { name: 'name', label: _('partner_backend.field.name'), value: row.name, required: true },
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
        { name: 'email', label: _('partner_backend.field.email'), value: row.email },
        { name: 'phone', label: _('partner_backend.field.phone'), value: row.phone },
        { name: 'lang', label: _('partner_backend.field.lang'), value: row.lang },
      ]}
    />
  )
  const rolesForm = (
    <RecordForm
      action={localized(`/admin/partner/partners/${row.id}/roles`, locale)}
      submit={_('partner_backend.action.saveRoles')}
      submitVariant="secondary"
      fields={['customer', 'supplier', 'employee'].map((role) => ({
        name: role,
        label: _(`partner.role.${role}`),
        type: 'checkbox' as const,
        value: heldRoles.has(role),
      }))}
    />
  )
  const body = stack([
    <Section title={_('partner_backend.detail.identity')} body={<Surface body={identityForm} />} />,
    <Section
      title={_('partner_backend.roles.title')}
      description={_('partner_backend.roles.hint')}
      body={<Surface body={rolesForm} />}
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
        button({
          label: _('partner_backend.action.save'),
          type: 'submit',
          form: 'partner-identity-form',
          variant: 'primary',
        }),
      ]}
    />
  )
  const quickFacts = (
    <PartnerPanel
      title={_('partner_backend.detail.quick')}
      body={
        <PartnerFacts
          items={[
            { label: _('partner_backend.field.kind'), value: _(`partner.kind.${row.kind}`) },
            { label: _('partner_backend.field.ref'), value: row.ref || '—' },
            { label: _('partner_backend.field.vat'), value: row.vat || '—' },
            { label: _('partner_backend.field.phone'), value: row.phone || '—' },
            { label: _('partner_backend.field.email'), value: row.email || '—' },
            { label: _('partner_backend.field.state'), value: status },
          ]}
        />
      }
    />
  )
  return shell(
    _,
    row.name,
    <RecordWorkspace
      breadcrumbs={{
        label: _('partner_backend.detail.navigation'),
        items: [
          {
            label: _('partner_backend.menu.app'),
            href: localized('/admin/partner/partners', locale),
          },
          {
            label: _('partner_backend.menu.directory'),
            href: localized('/admin/partner/partners', locale),
          },
          { label: row.name },
        ],
      }}
      kicker={_('partner_backend.menu.app')}
      title={row.name}
      subtitle={row.ref || _(`partner.kind.${row.kind}`)}
      imageFallback={<PartnerInitials name={row.name} />}
      badges={[status]}
      summary={[
        { id: 'roles', label: _('partner_backend.roles.title'), value: row.roles.length },
        { id: 'addresses', label: _('partner_backend.addresses.title'), value: row.addresses.length },
      ]}
      controller={actions}
      body={body}
      aside={quickFacts}
    />,
    { ...frame, topbar: false, titled: false },
  )
}
