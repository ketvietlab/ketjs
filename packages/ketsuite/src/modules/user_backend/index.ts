import { defineModule } from '@ketvietlab/ketjs'
import { USER_MODAL_ISLANDS, islands } from './islands.ts'
import { menus } from './menus.ts'
import { messages } from './messages.ts'
import { routes } from './routes.ts'
import { searchFilterFunctions } from './search-functions.ts'

export default defineModule({
  name: 'user_backend',
  version: '0.1.0',
  depends: ['user', 'company', 'backend'],
  title: 'Người dùng và phân quyền',
  summary: 'Quản lý tài khoản, vai trò, session và vòng đời truy cập.',
  category: 'Hệ thống',
  assets: new URL('./client/', import.meta.url),
  routes,
  functions: searchFilterFunctions,
  menus,
  messages,
  islands,
  fills: {
    // The user record modal: a closed host that opens a person from their link.
    'backend:runtime': Object.keys(USER_MODAL_ISLANDS)
      .map((name) => `{% island "${name}" %}`)
      .join(''),
    'user_backend:user.record-page': '{% island "user.user-page" %}',
  },
  joints: {
    'user.external-identities': { props: { userId: 'id' } },
    'profile.external-identities': { props: { userId: 'id' } },
    /** A person's own page: the record page island, with the context already read. */
    'user.record-page': {
      props: {
        id: 'id',
        title: 'text',
        loadingLabel: 'text',
        trail: 'json?',
        trailLabel: 'text?',
        envelope: 'json?',
      },
    },
  },
})

export { routes } from './routes.ts'
export {
  accessPoliciesGrid,
  accessPoliciesScreen,
  profileScreen,
  rolesGrid,
  rolesScreen,
  sessionsScreen,
  usersGrid,
  usersScreen,
} from './screens/index.ts'

export { accessError, accessOptions } from './access-options.ts'
