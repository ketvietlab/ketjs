// Assembly only — each concern lives in its own file.

import { defineModule } from 'ketjs'
import { models } from './models.ts'
import { relations } from './relations.ts'
import { functions } from './functions.ts'
import { messages } from './messages.ts'
import { routes } from './routes.ts'

export default defineModule({
  name: 'user',
  version: '0.1.0',
  depends: ['partner', 'company'],
  app: true,
  title: 'Người dùng',
  summary: 'Tài khoản đăng nhập và những công ty mỗi tài khoản được vào.',
  category: 'Hệ thống',
  // Removing the accounts would remove every way back in.
  removable: false,
  models,
  relations,
  functions,
  messages,
  routes,
})

export { hashPassword, verifyPassword, needsRehash } from './password.ts'
export { routes } from './routes.ts'
export { loginScreen } from './login.ts'
export { permittedFor } from './roles.ts'
export { resolveUserSession } from './session-context.ts'
