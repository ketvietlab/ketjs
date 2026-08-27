import type { JSXChild, TemplateResult } from '@ketvietlab/ketjs-view'
import type { Translator } from '@ketvietlab/ketjs'
import {
  badge,
  code,
  Framed,
  inline,
  person,
  RecordForm,
  Section,
  stack,
  Surface,
} from '../../ui/index.ts'
import type { Frame } from '../../ui/index.ts'
import { localized } from '../backend/screen.ts'

import { sessionsScreen } from './screens/index.ts'
import type { SessionRow, UserRow } from './screens/index.ts'

export type { PermissionRow, RoleRow, SessionRow, UserRow } from './screens/index.ts'

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
        body={sessionsScreen(_, sessions, (session) =>
          localized(`/admin/users/${row.id}/sessions/${encodeURIComponent(session.id)}`, locale),
        )}
      />,
    ])}
  />
)
