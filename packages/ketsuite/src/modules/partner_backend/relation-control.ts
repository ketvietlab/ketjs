import type { Route, ServeContext, Translator } from '@ketvietlab/ketjs'
import type { JSXChild } from '@ketvietlab/ketjs-view'
import { relationControl, relationLabels } from '../backend/relation-select.ts'

type Req = Parameters<Route>[1]
type PartnerChoice = { id: string; name: string; ref?: string | null }

export const partnerRelationControl = (
  ctx: ServeContext,
  url: URL,
  req: Req,
  _: Translator,
  options: {
    id: string
    name?: string
    value?: string | null
    partners: PartnerChoice[]
    fieldLabel: string
    title: string
    required?: boolean
    allowEmpty?: boolean
    excludeIds?: string[]
    companiesOnly?: boolean
  },
): Promise<JSXChild> =>
  relationControl(ctx, url, req, options.id, {
    name: options.name ?? 'partnerId',
    ariaLabel: options.fieldLabel,
    value: options.value,
    required: options.required,
    options: [
      ...(options.allowEmpty ? [{ value: '', label: '—' }] : []),
      ...options.partners.map((partner) => ({
        value: String(partner.id),
        label: partner.ref ? `${partner.ref} · ${partner.name}` : String(partner.name),
      })),
    ],
    labels: relationLabels(_, options.title),
    manager: {
      listFunction: 'partner.listPartners',
      listInput: {
        includeArchived: false,
        ...(options.companiesOnly ? { kind: 'company' } : {}),
      },
      excludeIds: options.excludeIds,
      saveFunction: 'partner.savePartner',
      saveDefaults: { kind: 'company' },
      fields: [
        { name: 'name', label: _('partner_backend.field.name'), required: true },
        ...(options.companiesOnly
          ? []
          : [
              {
                name: 'kind',
                label: _('partner_backend.field.kind'),
                type: 'select' as const,
                required: true,
                options: ['company', 'person'].map((value) => ({
                  value,
                  label: _(`partner.kind.${value}`),
                })),
              },
            ]),
        { name: 'ref', label: _('partner_backend.field.ref') },
        { name: 'email', label: _('partner_backend.field.email'), type: 'email' },
        { name: 'phone', label: _('partner_backend.field.phone'), type: 'tel' },
      ],
    },
  })
