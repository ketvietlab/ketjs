import { defineModule } from '@ketvietlab/ketjs'
import { customerRoutes } from './customer.ts'

export default defineModule({
  name: 'channel_api',
  version: '1.0.0',
  app: true,
  depends: ['website'],
  title: 'Channel API',
  summary: 'Contract API ổn định cho website, mobile, POS và tích hợp.',
  category: 'Kỹ thuật',
  removable: false,
  reserves: ['/api/customer/v1/', '/api/staff/v1/', '/api/pos/v1/', '/api/integration/v1/', '/internal/v1/'],
  routes: customerRoutes,
  messages: {
    vi: {
      'app.title': 'Channel API',
      'app.summary': 'Contract API ổn định cho website, mobile, POS và tích hợp.',
      'app.category': 'Kỹ thuật',
      'error.methodNotAllowed': 'Phương thức không hợp lệ; hãy dùng {method}.',
      'error.internal': 'Không thể xử lý yêu cầu lúc này.',
      'error.unauthenticated': 'Bạn cần đăng nhập để tiếp tục.',
      'error.idempotencyRequired': 'Yêu cầu cần khóa chống xử lý lặp.',
      'error.idempotencyConflict': 'Khóa chống xử lý lặp đã được dùng cho một yêu cầu khác.',
      'error.invalidRefreshToken': 'Refresh token không hợp lệ hoặc đã hết hạn.',
      'unsupportedMediaType.error': 'Nội dung yêu cầu phải dùng application/json.',
      'payloadTooLarge.error': 'Nội dung yêu cầu vượt quá giới hạn cho phép.',
      'invalidBody.error': 'Nội dung JSON của yêu cầu không hợp lệ.',
    },
    en: {
      'app.title': 'Channel API',
      'app.summary': 'Stable contracts for websites, mobile, POS and integrations.',
      'app.category': 'Technical',
      'error.methodNotAllowed': 'Method not allowed; use {method}.',
      'error.internal': 'The request cannot be processed right now.',
      'error.unauthenticated': 'Sign in to continue.',
      'error.idempotencyRequired': 'This request requires an idempotency key.',
      'error.idempotencyConflict': 'The idempotency key was already used for another request.',
      'error.invalidRefreshToken': 'The refresh token is invalid or expired.',
      'unsupportedMediaType.error': 'The request content type must be application/json.',
      'payloadTooLarge.error': 'The request body exceeds the allowed size.',
      'invalidBody.error': 'The request body is not valid JSON.',
    },
  },
})

export { defineChannelRoute, routesOf } from './core.ts'
export { openApiDocument } from './openapi.ts'
export type { ChannelProfile, ChannelRouteSpec } from './core.ts'
