import { defineModule } from '@ketvietlab/ketjs'
import { menus } from './menus.ts'
import { messages } from './messages.ts'
import { routes } from './routes.ts'

export default defineModule({
  name: 'oauth_backend',
  version: '0.1.0',
  depends: ['oauth', 'backend', 'user_backend'],
  title: 'OAuth trong quản trị',
  summary: 'Cấu hình đăng nhập OIDC và quản lý danh tính đã liên kết.',
  category: 'Hệ thống',
  routes,
  menus,
  messages,
  fills: {
    'user_backend:user.external-identities': `<a data-ui="action" data-variant="secondary" data-size="default" href="/admin/oauth/identities?user={{ userId }}">{{ 'oauth_backend.action.viewIdentities' | _ }}</a>`,
    'user_backend:profile.external-identities': `<a data-ui="action" data-variant="secondary" data-size="default" href="/admin/oauth/link">{{ 'oauth_backend.link.action' | _ }}</a>`,
  },
})

export { identitiesScreen, identityFormScreen, providerFormScreen, providersScreen } from './screens/index.tsx'
