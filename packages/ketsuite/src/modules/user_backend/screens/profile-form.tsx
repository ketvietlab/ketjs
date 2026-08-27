import type { Translator } from '@ketvietlab/ketjs'
import type { JSXChild, TemplateResult } from '@ketvietlab/ketjs-view'
import {
  badge,
  code,
  FormPage,
  inline,
  person,
  RecordForm,
  Section,
  shell,
  stack,
  Surface,
} from '../../../ui/index.ts'
import type { Frame } from '../../../ui/index.ts'
import { sessionsScreen } from './sessions.tsx'
import type { SessionRow, UserRow } from './types.ts'

export type ProfileScreenOptions = {
  sessions: readonly SessionRow[]
  timezoneAction: string
  passwordAction: string
  sessionAction: (session: SessionRow) => string
  passwordErrors?: readonly string[]
  integration?: JSXChild
}

export const profileScreen = (
  _: Translator,
  row: UserRow,
  options: ProfileScreenOptions,
  frame: Frame = {},
): TemplateResult =>
  shell(
    _,
    _('user_backend.profile.title'),
    <FormPage
      scope="profile-form-page"
      title={_('user_backend.profile.title')}
      description={`${row.name} · ${row.login}`}
      status={badge(_(`user_backend.access.${row.accessKind}`), 'info', row.accessKind)}
      body={stack([
        <Section
          title={_('user_backend.profile.account')}
          body={<Surface body={inline([person(row.name), code(row.login)])} />}
        />,
        <Section
          title={_('user_backend.profile.timezone')}
          body={
            <Surface
              body={
                <RecordForm
                  action={options.timezoneAction}
                  submit={_('user_backend.profile.saveTimezone')}
                  submitVariant="primary"
                  hidden={{ action: 'save' }}
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
                  action={options.passwordAction}
                  submit={_('user_backend.profile.changePassword')}
                  submitVariant="primary"
                  hidden={{ action: 'change' }}
                  errors={options.passwordErrors}
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
      ])}
      aside={
        <>
          {options.integration}
          <Section
            title={_('user_backend.sessions.title')}
            body={sessionsScreen(_, options.sessions, options.sessionAction)}
          />
        </>
      }
    />,
    { ...frame, topbar: false },
  )
