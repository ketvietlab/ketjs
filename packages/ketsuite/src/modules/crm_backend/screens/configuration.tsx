import type { Translator } from '@ketvietlab/ketjs'
import type { TemplateResult } from '@ketvietlab/ketjs-view'
import {
  badge,
  dataTable,
  emptyState,
  Framed,
  linkButton,
  RecordForm,
  Section,
  stack,
  Surface,
  Tabs,
} from '../../../ui/index.ts'
import type { FormField, Frame } from '../../../ui/index.ts'
import { localized } from '../../backend/screen.ts'

type AnyRow = Record<string, unknown>
const empty = (_: Translator) => emptyState(_('crm_backend.empty.title'), _('crm_backend.empty.hint'))

export const CONFIGURATION_TABS = [
  'teams',
  'members',
  'stages',
  'tags',
  'assignmentRules',
  'scoreRules',
] as const
export type ConfigurationTab = (typeof CONFIGURATION_TABS)[number]

/**
 * Configuration, editable.
 *
 * Every tab used to render a create-only form and a read-only table: the form
 * minted a fresh id on each submit and the table offered no way back into a
 * row, so a team could be created and then never renamed, retired or even
 * looked at again. Each row now links to itself for editing and carries the
 * toggle that archives it.
 */
export const configurationScreen = (
  _: Translator,
  frame: Frame,
  options: {
    tab: ConfigurationTab
    rows: AnyRow[]
    fields: FormField[]
    editing: AnyRow | null
    errors?: string[]
    locale?: string
    label?: (row: AnyRow) => string
    detail?: (row: AnyRow) => string
  },
): TemplateResult => {
  const endpoint = localized(`/admin/crm/configuration?tab=${options.tab}`, options.locale ?? '')
  const label = options.label ?? ((row: AnyRow) => String(row.name ?? row.code ?? row.id))
  return (
    <Framed
      translator={_}
      title={_('crm_backend.configuration.title')}
      frame={frame}
      body={stack([
        <Tabs
          label={_('crm_backend.configuration.title')}
          items={CONFIGURATION_TABS.map((id) => ({
            id,
            label: _(`crm_backend.configuration.${id}`),
            href: localized(`/admin/crm/configuration?tab=${id}`, options.locale ?? ''),
            active: options.tab === id,
          }))}
        />,
        <Section
          title={
            options.editing
              ? `${_('crm_backend.configuration.edit')} · ${label(options.editing)}`
              : _('crm_backend.configuration.create')
          }
          body={
            <Surface
              body={
                options.editing ? (
                  <RecordForm
                    action={endpoint}
                    hidden={{
                      id: String(options.editing.id),
                      ...(options.editing.version != null
                        ? { expectedVersion: String(options.editing.version) }
                        : {}),
                    }}
                    fields={options.fields}
                    errors={options.errors}
                    submit={_('crm_backend.action.save')}
                    submitVariant="primary"
                    cancelHref={endpoint}
                    cancelLabel={_('crm_backend.action.cancelEdit')}
                  />
                ) : (
                  <RecordForm
                    action={endpoint}
                    fields={options.fields}
                    errors={options.errors}
                    submit={_('crm_backend.configuration.create')}
                    submitVariant="primary"
                  />
                )
              }
            />
          }
        />,
        options.rows.length
          ? dataTable(_, {
              rows: options.rows,
              id: (row) => String(row.id),
              columns: [
                {
                  key: 'name',
                  label: _('crm_backend.field.name'),
                  priority: 'primary',
                  cell: (row) =>
                    linkButton({
                      href: localized(
                        `/admin/crm/configuration?tab=${options.tab}&edit=${encodeURIComponent(String(row.id))}`,
                        options.locale ?? '',
                      ),
                      label: label(row),
                      variant: 'tertiary',
                      size: 'compact',
                    }),
                },
                ...(options.detail
                  ? [
                      {
                        key: 'detail',
                        label: _('crm_backend.configuration.detail'),
                        cell: (row: AnyRow) => options.detail!(row),
                      },
                    ]
                  : []),
                {
                  key: 'active',
                  label: _('crm_backend.field.active'),
                  cell: (row) =>
                    row.active === false
                      ? badge(_('crm_backend.state.archived'), 'neutral', 'archived')
                      : badge(_('crm_backend.state.active'), 'positive', 'active'),
                },
                {
                  key: 'toggle',
                  label: _('crm_backend.field.actions'),
                  cell: (row: AnyRow) => (
                    <RecordForm
                      action={endpoint}
                      layout="inline"
                      hidden={{
                        action: row.active === false ? 'restore' : 'archive',
                        id: String(row.id),
                        ...(row.version != null ? { expectedVersion: String(row.version) } : {}),
                      }}
                      fields={[]}
                      submit={
                        row.active === false
                          ? _('crm_backend.action.restore')
                          : _('crm_backend.action.archive')
                      }
                      submitVariant={row.active === false ? 'secondary' : 'tertiary'}
                      submitSize="compact"
                    />
                  ),
                },
              ],
            })
          : empty(_),
      ])}
    />
  )
}
