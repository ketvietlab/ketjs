import type { Translator } from '@ketvietlab/ketjs'
import type { TemplateResult } from '@ketvietlab/ketjs-view'
import {
  badge,
  dataTable,
  emptyState,
  ListScreen,
  inline,
  linkButton,
  Metric,
  Notice,
  RecordActions,
  Section,
  stack,
} from '../../../ui/index.ts'
import type { Frame } from '../../../ui/index.ts'
import { localized } from '../../backend/screen.ts'
import type { CatalogRow, DivisionRow } from './types.ts'

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
  const countryCode = encodeURIComponent(options.countryCode)
  const back = options.parent
    ? localized(`/admin/addresses/${countryCode}`, locale)
    : localized('/admin/addresses', locale)
  return (
    <ListScreen
      translator={_}
      title={countryName}
      frame={frame}
      body={stack([
        inline([
          linkButton({ label: _('address_backend.action.back'), href: back, variant: 'tertiary' }),
          ...(!options.status?.installed
            ? [
                <RecordActions
                  action={localized(`/admin/addresses/${countryCode}/install`, locale)}
                  actions={[
                    {
                      value: options.status?.version ?? '2025-07-01',
                      label: _('address_backend.action.install'),
                      variant: 'primary',
                    },
                  ]}
                />,
              ]
            : []),
        ]),
        ...(options.errors?.length
          ? [
              <Notice
                title={_('address_backend.error.title')}
                message={options.errors.join(' · ')}
                tone="danger"
              />,
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
              <Metric label={_('address_backend.field.version')} value={options.status?.version ?? '—'} />,
              <Metric
                label={_('address_backend.field.records')}
                value={options.status?.recordCount == null ? '—' : String(options.status.recordCount)}
              />,
              <Metric
                label={_('address_backend.field.codeSystem')}
                value={options.status?.codeSystem ?? '—'}
              />,
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
                              `/admin/addresses/${countryCode}?parentId=${encodeURIComponent(row.id)}`,
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
