import type { JSXChild, TemplateResult } from '@ketvietlab/ketjs-view'
import type { Translator } from '@ketvietlab/ketjs'
import {
  badge,
  code,
  dataTable,
  emptyState,
  Framed,
  inline,
  linkButton,
  Notice,
  person,
  RecordForm,
  Section,
  stack,
  Surface,
} from '../../ui/index.ts'
import type { FormOption, Frame } from '../../ui/index.ts'
import { localized } from '../backend/screen.ts'

import { sessionsScreen } from './screens/index.ts'
import type { SessionRow, UserRow } from './screens/index.ts'

export type { SessionRow, UserRow } from './screens/index.ts'

export type PermissionRow = {
  key: string
  module: string
  moduleLabel: string
  task: string
  label: string
  checked: boolean
}

export type RoleRow = {
  id: string
  name: string
  description?: string | null
  grants?: Array<{ fnKey: string }>
}

export const rolesScreen = (_: Translator, rows: RoleRow[], frame: Frame, locale = ''): TemplateResult => (
  <Framed
    translator={_}
    title={_('user_backend.roles.title')}
    frame={frame}
    body={stack([
      inline([
        linkButton({
          label: _('user_backend.action.createRole'),
          href: localized('/admin/roles/new', locale),
          variant: 'primary',
        }),
        linkButton({
          label: _('user_backend.action.presets'),
          href: localized('/admin/permission-presets', locale),
          variant: 'secondary',
        }),
      ]),
      rows.length === 0
        ? emptyState(_('user_backend.roles.empty'), _('user_backend.roles.emptyHint'))
        : dataTable(_, {
            rows,
            id: (row) => row.id,
            columns: [
              {
                key: 'name',
                label: _('user_backend.field.name'),
                cell: (row) =>
                  linkButton({
                    label: row.name,
                    href: localized(`/admin/roles/${row.id}`, locale),
                    variant: 'tertiary',
                  }),
              },
              {
                key: 'description',
                label: _('user_backend.field.description'),
                cell: (row) => row.description || '—',
              },
            ],
          }),
    ])}
  />
)

export const roleScreen = (
  _: Translator,
  row: Partial<RoleRow>,
  permissions: PermissionRow[],
  frame: Frame,
  locale = '',
  errors?: string[],
): TemplateResult => {
  const create = !row.id
  const groups = new Map<string, PermissionRow[]>()
  for (const permission of permissions)
    groups.set(permission.module, [...(groups.get(permission.module) ?? []), permission])
  return (
    <Framed
      translator={_}
      title={create ? _('user_backend.roles.create') : (row.name ?? '')}
      frame={frame}
      body={stack([
        <Section
          title={_('user_backend.roles.identity')}
          body={
            <Surface
              body={
                <RecordForm
                  action={localized(create ? '/admin/roles/new' : `/admin/roles/${row.id}`, locale)}
                  submit={_('user_backend.action.save')}
                  submitVariant="primary"
                  cancelHref={localized('/admin/roles', locale)}
                  cancelLabel={_('user_backend.action.cancel')}
                  errors={errors}
                  fields={[
                    { name: 'name', label: _('user_backend.field.name'), value: row.name, required: true },
                    {
                      name: 'description',
                      label: _('user_backend.field.description'),
                      value: row.description,
                      type: 'textarea',
                      span: 'full',
                    },
                  ]}
                />
              }
            />
          }
        />,
        ...(!create
          ? [...groups.entries()].map(([moduleName, items]) => (
              <Section
                title={items[0]?.moduleLabel ?? moduleName}
                description={_('user_backend.roles.permissionHint')}
                body={
                  <Surface
                    body={
                      <RecordForm
                        action={localized(`/admin/roles/${row.id}/permissions`, locale)}
                        submit={_('user_backend.action.savePermissions')}
                        submitVariant="secondary"
                        hidden={{ module: moduleName }}
                        fields={items.map((permission) => ({
                          name: `permission.${permission.key}`,
                          label: permission.label,
                          type: 'checkbox' as const,
                          value: permission.checked,
                        }))}
                      />
                    }
                  />
                }
              />
            ))
          : []),
      ])}
    />
  )
}

export const presetsScreen = (
  _: Translator,
  modules: FormOption[],
  frame: Frame,
  locale = '',
  result?: string,
): TemplateResult => (
  <Framed
    translator={_}
    title={_('user_backend.presets.title')}
    frame={frame}
    body={stack([
      ...(result ? [<Notice tone="positive" title={_('user_backend.presets.done')} message={result} />] : []),
      <Section
        title={_('user_backend.presets.apply')}
        description={_('user_backend.presets.hint')}
        body={
          <Surface
            body={
              <RecordForm
                action={localized('/admin/permission-presets', locale)}
                submit={_('user_backend.action.applyPreset')}
                submitVariant="primary"
                fields={[
                  {
                    name: 'module',
                    label: _('user_backend.presets.module'),
                    type: 'select',
                    options: modules,
                    required: true,
                  },
                  {
                    name: 'level',
                    label: _('user_backend.presets.level'),
                    type: 'select',
                    options: [
                      { value: 'user', label: _('user_backend.presets.user') },
                      { value: 'manager', label: _('user_backend.presets.manager') },
                    ],
                    required: true,
                  },
                ]}
              />
            }
          />
        }
      />,
    ])}
  />
)

export const profileScreen = (
  _: Translator,
  row: UserRow,
  sessions: SessionRow[],
  frame: Frame,
  locale = '',
  errors?: string[],
  integration?: JSXChild,
): TemplateResult => (
  <Framed
    translator={_}
    title={_('user_backend.profile.title')}
    frame={frame}
    body={stack([
      ...(integration ? [integration] : []),
      <Section
        title={_('user_backend.profile.account')}
        body={
          <Surface
            body={inline([
              person(row.name),
              code(row.login),
              badge(_(`user_backend.access.${row.accessKind}`), 'info'),
            ])}
          />
        }
      />,
      <Section
        title={_('user_backend.profile.timezone')}
        body={
          <Surface
            body={
              <RecordForm
                action={localized('/admin/profile/timezone', locale)}
                submit={_('user_backend.profile.saveTimezone')}
                submitVariant="primary"
                fields={[
                  {
                    name: 'timezone',
                    label: _('user_backend.profile.timezone'),
                    type: 'select',
                    value: row.timezone ?? '',
                    options: [
                      { value: 'UTC', label: 'UTC' },
                      { value: 'Asia/Ho_Chi_Minh', label: 'Asia/Ho_Chi_Minh' },
                      { value: 'Asia/Singapore', label: 'Asia/Singapore' },
                      { value: 'Europe/London', label: 'Europe/London' },
                      { value: 'America/New_York', label: 'America/New_York' },
                    ],
                    required: true,
                  },
                ]}
              />
            }
          />
        }
      />,
      <Section
        title={_('user_backend.profile.password')}
        body={
          <Surface
            body={
              <RecordForm
                action={localized('/admin/profile/password', locale)}
                submit={_('user_backend.profile.changePassword')}
                submitVariant="primary"
                errors={errors}
                fields={[
                  {
                    name: 'currentPassword',
                    label: _('user_backend.profile.currentPassword'),
                    type: 'password',
                    required: true,
                  },
                  {
                    name: 'newPassword',
                    label: _('user_backend.profile.newPassword'),
                    type: 'password',
                    required: true,
                  },
                ]}
              />
            }
          />
        }
      />,
      <Section
        title={_('user_backend.sessions.title')}
        body={sessionsScreen(
          _,
          sessions,
          (session) =>
            localized(`/admin/users/${row.id}/sessions/${encodeURIComponent(session.id)}`, locale),
        )}
      />,
    ])}
  />
)
