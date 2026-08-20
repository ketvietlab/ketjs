import { defineModule } from 'ketjs'
import { menus } from './menus.ts'
import { messages } from './messages.ts'
import { routes } from './routes.ts'

export default defineModule({
  name: 'user_backend',
  version: '0.1.0',
  depends: ['user', 'company', 'backend'],
  install: 'auto',
  app: true,
  title: 'Người dùng và phân quyền',
  summary: 'Quản lý tài khoản, vai trò, session và vòng đời truy cập.',
  category: 'Hệ thống',
  routes,
  menus,
  messages,
})

export { routes } from './routes.ts'
export {
  presetsScreen,
  profileScreen,
  roleScreen,
  rolesScreen,
  userFormScreen,
  usersScreen,
} from './screens.ts'
