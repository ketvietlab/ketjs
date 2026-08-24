import { defineModule } from '@ketvietlab/ketjs'
import { functions } from './functions.ts'
import { messages } from './messages.ts'
import { models } from './models.ts'
import { relations } from './relations.ts'
import { routes } from './routes.ts'

export default defineModule({
  name: 'oauth',
  group: 'system',
  version: '0.1.0',
  depends: ['user', 'company'],
  app: true,
  title: 'Đăng nhập OAuth',
  summary: 'Nhà cung cấp OIDC và liên kết danh tính ngoài cho KetSuite.',
  category: 'Hệ thống',
  models,
  relations,
  functions,
  messages,
  routes,
})

export {
  discoverOidc,
  exchangeOidcCode,
  oidcAuthorizationUrl,
  OauthProtocolError,
  pkceChallenge,
  verifyOidcIdToken,
} from './protocol.ts'
