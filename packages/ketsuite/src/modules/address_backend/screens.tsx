import type { Translator } from 'ketjs'
import type { TemplateResult } from 'ketjs-view'
import {
  badge,
  dataTable,
  emptyState,
  framedPage as Framed,
  inline,
  linkButton,
  metric,
  notice,
  recordActions,
  section as Section,
  stack,
} from '../../ui/index.ts'
import type { Frame } from '../../ui/index.ts'

export type CatalogRow = {
  countryCode: string
  version: string
  recommended: boolean
  installed?: boolean
  status?: string | null
  recordCount?: number | null
  codeSystem?: string | null
  effectiveFrom?: string | null
}
export type DivisionRow = {
  id: string
  code: string
  parentId?: string | null
  officialName: string
  shortName?: string | null
  kind: string
  level: number
}

const localized = (path: string, locale: string): string =>
  !locale ? path : path.includes('?') ? `${path}&${locale.slice(1)}` : `${path}${locale}`

export const catalogsScreen = (
  _: Translator,
  rows: CatalogRow[],
  frame: Frame,
  locale = '',
): TemplateResult => (
  <Framed
    translator={_}
    title={_('address_backend.title')}
    frame={frame}
    body={stack([
      <Section
        title={_('address_backend.title')}
        description={_('address_backend.hint')}
        body={
          rows.length === 0
            ? emptyState(_('address_backend.empty'), _('address_backend.emptyHint'))
            : dataTable(_, {
                rows,
                id: (row) => `${row.countryCode}:${row.version}`,
                columns: [
                  {
                    key: 'country',
                    label: _('address_backend.field.country'),
                    priority: 'primary',
                    cell: (row) =>
                      linkButton({
                        label: row.countryCode === 'VN' ? _('address_backend.country.VN') : row.countryCode,
                        href: localized(`/admin/addresses/${row.countryCode}`, locale),
                        variant: 'tertiary',
                      }),
                  },
                  {
                    key: 'version',
                    label: _('address_backend.field.version'),
                    priority: 'tertiary',
                    cell: (row) => row.version,
                  },
                  {
                    key: 'status',
                    label: _('address_backend.field.status'),
                    kind: 'status',
                    cell: (row) =>
                      badge(
                        row.installed
                          ? _('address_backend.state.installed')
                          : _('address_backend.state.available'),
                        row.installed ? 'positive' : 'neutral',
                      ),
                  },
                  {
                    key: 'records',
                    label: _('address_backend.field.records'),
                    priority: 'tertiary',
                    cell: (row) => (row.recordCount == null ? '—' : String(row.recordCount)),
                  },
                  {
                    key: 'actions',
                    label: _('address_backend.field.actions'),
                    priority: 'primary',
                    cell: (row) =>
                      row.installed
                        ? linkButton({
                            label: _('address_backend.action.open'),
                            href: localized(`/admin/addresses/${row.countryCode}`, locale),
                            variant: 'secondary',
                          })
                        : recordActions({
                            action: localized(`/admin/addresses/${row.countryCode}/install`, locale),
                            actions: [
                              {
                                value: row.version,
                                label: _('address_backend.action.install'),
                                variant: 'primary',
                              },
                            ],
                          }),
                  },
                ],
              })
        }
      />,
    ])}
  />
)

export const countryScreen = (
  _: Translator,
  options: {
    countryCode: string
    status?: CatalogRow | null
    divisions: DivisionRow[]
    parent?: DivisionRow | null
    errors?: string[]
  },
  frame: Frame,
  locale = '',
): TemplateResult => {
  const countryName = options.countryCode === 'VN' ? _('address_backend.country.VN') : options.countryCode
  const back = options.parent
    ? localized(`/admin/addresses/${options.countryCode}`, locale)
    : localized('/admin/addresses', locale)
  return (
    <Framed
      translator={_}
      title={countryName}
      frame={frame}
      body={stack([
        inline([
          linkButton({ label: _('address_backend.action.back'), href: back, variant: 'tertiary' }),
          ...(!options.status?.installed
            ? [
                recordActions({
                  action: localized(`/admin/addresses/${options.countryCode}/install`, locale),
                  actions: [
                    {
                      value: options.status?.version ?? '2025-07-01',
                      label: _('address_backend.action.install'),
                      variant: 'primary',
                    },
                  ],
                }),
              ]
            : []),
        ]),
        ...(options.errors?.length
          ? [
              notice({
                title: _('address_backend.error.title'),
                message: options.errors.join(' · '),
                tone: 'danger',
              }),
            ]
          : []),
        <Section
          title={options.parent?.officialName ?? countryName}
          description={
            options.parent
              ? _('address_backend.divisions.childrenHint')
              : _('address_backend.divisions.rootHint')
          }
          body={stack([
            inline([
              metric({ label: _('address_backend.field.version'), value: options.status?.version ?? '—' }),
              metric({
                label: _('address_backend.field.records'),
                value: options.status?.recordCount == null ? '—' : String(options.status.recordCount),
              }),
              metric({
                label: _('address_backend.field.codeSystem'),
                value: options.status?.codeSystem ?? '—',
              }),
            ]),
            !options.status?.installed
              ? emptyState(_('address_backend.notInstalled'), _('address_backend.notInstalledHint'))
              : options.divisions.length === 0
                ? emptyState(_('address_backend.divisions.empty'), _('address_backend.divisions.emptyHint'))
                : dataTable(_, {
                    rows: options.divisions,
                    id: (row) => row.id,
                    columns: [
                      {
                        key: 'name',
                        label: _('address_backend.field.name'),
                        priority: 'primary',
                        cell: (row) =>
                          linkButton({
                            label: row.officialName,
                            href: localized(
                              `/admin/addresses/${options.countryCode}?parentId=${encodeURIComponent(row.id)}`,
                              locale,
                            ),
                            variant: 'tertiary',
                          }),
                      },
                      {
                        key: 'code',
                        label: _('address_backend.field.code'),
                        priority: 'tertiary',
                        cell: (row) => row.code,
                      },
                      {
                        key: 'kind',
                        label: _('address_backend.field.kind'),
                        kind: 'status',
                        priority: 'tertiary',
                        cell: (row) => badge(_(`address.kind.${row.kind}`), 'neutral'),
                      },
                    ],
                  }),
          ])}
        />,
      ])}
    />
  )
}
