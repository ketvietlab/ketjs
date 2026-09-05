import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Translator } from '@ketvietlab/ketjs'
import { renderToString } from '@ketvietlab/ketjs-view'
import { profileScreen } from '../packages/ketsuite/src/modules/user_backend/screens/index.ts'

const translate = ((key: string) => key) as Translator
translate.locale = 'en'
translate.has = () => true
translate.resolves = () => true

test('profile uses FormPage with security integrations and sessions in the aside', () => {
  const html = renderToString(
    profileScreen(
      translate,
      {
        id: 'user/a',
        login: 'ada',
        name: 'Ada',
        timezone: 'Asia/Ho_Chi_Minh',
        accessKind: 'internal',
        securityVersion: 1,
        passwordReady: true,
        active: true,
        superuser: false,
      },
      {
        sessions: [
          {
            id: 'session/a',
            current: false,
            company: 'acme',
            branch: 'root:acme',
            createdAt: 1,
            expiresAt: 2,
          },
        ],
        timezoneAction: '/admin/profile/timezone?lang=en',
        passwordAction: '/admin/profile/password?lang=en',
        sessionAction: (session) =>
          `/admin/users/user%2Fa/sessions/${encodeURIComponent(session.id)}?lang=en`,
        integration: <div data-integration="oauth">OAuth</div>,
      },
    ),
  )
  assert.match(html, /data-ui="form-page" data-scope="profile-form-page" data-has-aside="true"/)
  assert.match(html, /action="\/admin\/profile\/timezone\?lang=en"/)
  assert.match(html, /name="action" value="save"/)
  assert.match(html, /action="\/admin\/profile\/password\?lang=en"/)
  assert.match(html, /name="action" value="change"/)
  assert.match(html, /action="\/admin\/users\/user%2Fa\/sessions\/session%2Fa\?lang=en"/)
  assert.match(html, /data-integration="oauth"/)
})
