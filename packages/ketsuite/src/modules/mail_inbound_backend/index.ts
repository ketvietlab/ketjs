import { defineModule } from 'ketjs'
import { routes } from './routes.ts'

export default defineModule({
  name: 'mail_inbound_backend',
  version: '0.1.0',
  depends: ['mail_inbound', 'backend'],
  install: 'auto',
  app: true,
  title: 'Email đến',
  summary: 'Chẩn đoán webhook, routing reply, bounce và alias.',
  category: 'Năng suất',
  routes,
  menus: {
    inbound: {
      label: 'menu.app',
      icon: 'download',
      path: '/admin/inbound-email',
      sequence: 17,
      needs: 'mail_inbound.listEvents',
    },
  },
  messages: {
    vi: {
      'app.title': 'Email đến',
      'app.summary': 'Chẩn đoán webhook, routing reply, bounce và alias.',
      'app.category': 'Năng suất',
      'menu.app': 'Email đến',
      title: 'Nhật ký email đến',
      empty: 'Chưa nhận email nào.',
      emptyHint: 'Webhook đã xác thực, reply và bounce sẽ xuất hiện tại đây.',
      system: 'Provider',
      diagnostic: 'Chẩn đoán',
      target: 'Bản ghi',
      'state.processed': 'Đã xử lý',
      'state.pending_alias': 'Chờ bridge alias',
      'state.failed': 'Không định tuyến được',
      'state.ignored': 'Đã bỏ qua',
    },
    en: {
      'app.title': 'Inbound email',
      'app.summary': 'Webhook, reply, bounce and alias routing diagnostics.',
      'app.category': 'Productivity',
      'menu.app': 'Inbound email',
      title: 'Inbound email log',
      empty: 'No inbound email has arrived.',
      emptyHint: 'Verified webhooks, replies and bounces appear here.',
      system: 'Provider',
      diagnostic: 'Diagnostic',
      target: 'Record',
      'state.processed': 'Processed',
      'state.pending_alias': 'Alias bridge pending',
      'state.failed': 'Routing failed',
      'state.ignored': 'Ignored',
    },
  },
})

export { routes } from './routes.ts'
export { inboundScreen } from './screens.tsx'
