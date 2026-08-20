import type { JSXChild, TemplateResult } from 'ketjs-view'
import type { Translator } from 'ketjs'
import {
  badge,
  code,
  dataTable,
  emptyState,
  framed,
  inline,
  linkButton,
  recordActions,
  recordForm,
  section,
  stack,
  surface,
} from '../../ui/index.ts'
import type { DataTable, FormOption, Frame } from '../../ui/index.ts'

const localized = (path: string, locale: string): string =>
  !locale ? path : path.includes('?') ? `${path}&${locale.slice(1)}` : `${path}${locale}`

export type PartnerListRow = {
  id: string
  kind: string
  name: string
  ref?: string | null
  email?: string | null
  phone?: string | null
  active: boolean
}

export const partnersScreen = (
  _: Translator,
  rows: PartnerListRow[],
  frame: Frame,
  table: Partial<DataTable<PartnerListRow>> = {},
  locale = '',
  includeArchived = false,
): TemplateResult =>
  framed(
    _,
    _('partner_backend.screen.title'),
    frame,
    stack([
      inline([
        linkButton({
          label: _('partner_backend.action.create'),
          href: localized('/admin/partners/new', locale),
          variant: 'primary',
        }),
        linkButton({
          label: _('partner_backend.filter.customers'),
          href: localized('/admin/partners?role=customer', locale),
        }),
        linkButton({
          label: _('partner_backend.filter.suppliers'),
          href: localized('/admin/partners?role=supplier', locale),
        }),
        linkButton({
          label: includeArchived
            ? _('partner_backend.filter.activeOnly')
            : _('partner_backend.filter.includeArchived'),
          href: localized(includeArchived ? '/admin/partners' : '/admin/partners?archived=1', locale),
          variant: 'tertiary',
        }),
      ]),
      rows.length === 0
        ? emptyState(_('partner_backend.screen.empty'), _('partner_backend.screen.emptyHint'))
        : dataTable(_, {
            rows,
            id: (row) => row.id,
            columns: [
              {
                key: 'name',
                label: _('partner_backend.field.name'),
                priority: 'primary',
                cell: (row) =>
                  linkButton({
                    label: row.name,
                    href: localized(`/admin/partners/${row.id}`, locale),
                    variant: 'tertiary',
                  }),
              },
              {
                key: 'kind',
                label: _('partner_backend.field.kind'),
                kind: 'status',
                cell: (row) =>
                  badge(_(`partner.kind.${row.kind}`), row.kind === 'company' ? 'info' : 'neutral'),
              },
              { key: 'email', label: _('partner_backend.field.email'), cell: (row) => row.email || '—' },
              { key: 'phone', label: _('partner_backend.field.phone'), cell: (row) => row.phone || '—' },
              {
                key: 'ref',
                label: _('partner_backend.field.ref'),
                kind: 'identifier',
                optional: true,
                cell: (row) => (row.ref ? code(row.ref, 'identifier') : '—'),
              },
              {
                key: 'state',
                label: _('partner_backend.field.state'),
                kind: 'status',
                cell: (row) =>
                  badge(
                    row.active ? _('partner_backend.state.active') : _('partner_backend.state.archived'),
                    row.active ? 'positive' : 'neutral',
                  ),
              },
            ],
            ...table,
          }),
    ]),
  )

type AddressRow = {
  id: string
  use: string
  street: string
  street2?: string | null
  city: string
  zip?: string | null
  state?: string | null
  country: string
  isDefault?: boolean
}

type PartnerDetail = PartnerListRow & {
  parentId?: string | null
  vat?: string | null
  lang?: string | null
  addresses: AddressRow[]
  roles: Array<{ role: string }>
}

const addressFields = (_: Translator, address: Partial<AddressRow>) => [
  {
    name: 'use',
    label: _('partner_backend.address.use'),
    type: 'select' as const,
    value: address.use ?? 'contact',
    options: ['contact', 'invoice', 'delivery', 'other'].map((value) => ({
      value,
      label: _(`partner.use.${value}`),
    })),
  },
  { name: 'street', label: _('partner_backend.address.street'), value: address.street, required: true },
  { name: 'street2', label: _('partner_backend.address.street2'), value: address.street2 },
  { name: 'city', label: _('partner_backend.address.city'), value: address.city, required: true },
  { name: 'state', label: _('partner_backend.address.state'), value: address.state },
  { name: 'zip', label: _('partner_backend.address.zip'), value: address.zip },
  { name: 'country', label: _('partner_backend.address.country'), value: address.country, required: true },
  {
    name: 'isDefault',
    label: _('partner_backend.address.default'),
    type: 'checkbox' as const,
    value: address.isDefault,
  },
]

export const partnerDetailScreen = (
  _: Translator,
  row: PartnerDetail,
  options: {
    parents: FormOption[]
    terms?: { creditLimit?: string | number | null; note?: string | null } | null
    errors?: string[]
    integration?: JSXChild
  },
  frame: Frame,
  locale = '',
): TemplateResult => {
  const heldRoles = new Set(row.roles.map((role) => role.role))
  return framed(
    _,
    row.name,
    frame,
    stack([
      options.integration ?? '',
      section({
        title: _('partner_backend.state.title'),
        body: surface({
          body: recordActions({
            action: localized(`/admin/partners/${row.id}/archive`, locale),
            actions: [
              row.active
                ? {
                    value: 'archive',
                    label: _('partner_backend.action.archive'),
                    variant: 'destructive',
                  }
                : {
                    value: 'restore',
                    label: _('partner_backend.action.restore'),
                    variant: 'secondary',
                  },
            ],
          }),
        }),
      }),
      section({
        title: _('partner_backend.detail.identity'),
        body: surface({
          body: recordForm({
            action: localized(`/admin/partners/${row.id}`, locale),
            submit: _('partner_backend.action.save'),
            submitVariant: 'primary',
            errors: options.errors,
            fields: [
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
                value: row.parentId,
                options: [{ value: '', label: '—' }, ...options.parents],
              },
              { name: 'ref', label: _('partner_backend.field.ref'), value: row.ref },
              { name: 'vat', label: _('partner_backend.field.vat'), value: row.vat },
              { name: 'email', label: _('partner_backend.field.email'), value: row.email },
              { name: 'phone', label: _('partner_backend.field.phone'), value: row.phone },
              { name: 'lang', label: _('partner_backend.field.lang'), value: row.lang },
            ],
          }),
        }),
      }),
      section({
        title: _('partner_backend.roles.title'),
        description: _('partner_backend.roles.hint'),
        body: surface({
          body: recordForm({
            action: localized(`/admin/partners/${row.id}/roles`, locale),
            submit: _('partner_backend.action.saveRoles'),
            submitVariant: 'secondary',
            fields: ['customer', 'supplier', 'employee'].map((role) => ({
              name: role,
              label: _(`partner.role.${role}`),
              type: 'checkbox' as const,
              value: heldRoles.has(role),
            })),
          }),
        }),
      }),
      section({
        title: _('partner_backend.addresses.title'),
        description: _('partner_backend.addresses.hint'),
        body: stack([
          ...row.addresses.map((address) =>
            section({
              title: `${_(`partner.use.${address.use}`)}${address.isDefault ? ` · ${_('partner_backend.address.default')}` : ''}`,
              body: surface({
                body: recordForm({
                  action: localized(`/admin/partners/${row.id}/addresses/${address.id}`, locale),
                  submit: _('partner_backend.action.saveAddress'),
                  submitVariant: 'secondary',
                  fields: addressFields(_, address),
                }),
              }),
            }),
          ),
          section({
            title: _('partner_backend.address.new'),
            body: surface({
              body: recordForm({
                action: localized(`/admin/partners/${row.id}/addresses`, locale),
                submit: _('partner_backend.action.addAddress'),
                submitVariant: 'secondary',
                fields: addressFields(_, { use: 'contact', country: 'VN' }),
              }),
            }),
          }),
        ]),
      }),
      section({
        title: _('partner_backend.terms.title'),
        description: _('partner_backend.terms.hint'),
        body: surface({
          body: recordForm({
            action: localized(`/admin/partners/${row.id}/terms`, locale),
            submit: _('partner_backend.action.saveTerms'),
            submitVariant: 'secondary',
            fields: [
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
            ],
          }),
        }),
      }),
    ]),
  )
}

export const newPartnerScreen = (
  _: Translator,
  parents: FormOption[],
  frame: Frame,
  errors?: string[],
  locale = '',
): TemplateResult =>
  framed(
    _,
    _('partner_backend.create.title'),
    frame,
    surface({
      body: recordForm({
        action: localized('/admin/partners/new', locale),
        submit: _('partner_backend.action.create'),
        submitVariant: 'primary',
        cancelHref: localized('/admin/partners', locale),
        cancelLabel: _('partner_backend.action.cancel'),
        errors,
        fields: [
          { name: 'name', label: _('partner_backend.field.name'), required: true },
          {
            name: 'kind',
            label: _('partner_backend.field.kind'),
            type: 'select',
            value: 'company',
            options: ['company', 'person'].map((value) => ({ value, label: _(`partner.kind.${value}`) })),
          },
          {
            name: 'parentId',
            label: _('partner_backend.field.parent'),
            type: 'select',
            options: [{ value: '', label: '—' }, ...parents],
          },
          { name: 'ref', label: _('partner_backend.field.ref') },
          { name: 'vat', label: _('partner_backend.field.vat') },
          { name: 'email', label: _('partner_backend.field.email') },
          { name: 'phone', label: _('partner_backend.field.phone') },
        ],
      }),
    }),
  )
