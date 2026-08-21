import { defineModule } from 'ketjs'
import { islands } from './islands.ts'
import { routes } from './routes.ts'

export default defineModule({
  name: 'mail_backend',
  version: '0.1.0',
  depends: ['mail', 'backend'],
  install: 'auto',
  app: true,
  title: 'Thảo luận trong quản trị',
  summary: 'Chatter trên bản ghi và hộp thư thông báo.',
  category: 'Năng suất',
  assets: new URL('../../ui/client/', import.meta.url),
  styles: ['mail.css'],
  islands,
  routes,
  menus: {
    mail: {
      label: 'menu.app',
      icon: 'message-circle',
      path: '/admin/inbox',
      sequence: 15,
      needs: 'mail.listInbox',
    },
  },
  fills: {
    'backend:sidebar.foot': `{% island "mail.inbox-indicator" %}`,
  },
  messages: {
    vi: {
      'app.title': 'Thảo luận trong quản trị',
      'app.summary': 'Chatter trên bản ghi và hộp thư thông báo.',
      'app.category': 'Năng suất',
      'menu.app': 'Thảo luận',
      'inbox.title': 'Hộp thư thông báo',
      'inbox.empty': 'Không có thông báo chưa đọc.',
      'inbox.emptyHint': 'Tin nhắn mới từ các bản ghi bạn theo dõi sẽ xuất hiện tại đây.',
      'inbox.message': 'Tin nhắn',
      'inbox.markRead': 'Đánh dấu đã đọc',
    },
    en: {
      'app.title': 'Discuss in admin',
      'app.summary': 'Record chatter and the notification inbox.',
      'app.category': 'Productivity',
      'menu.app': 'Discuss',
      'inbox.title': 'Notification inbox',
      'inbox.empty': 'No unread notifications.',
      'inbox.emptyHint': 'New messages from records you follow will appear here.',
      'inbox.message': 'Message',
      'inbox.markRead': 'Mark as read',
    },
  },
})

export { islands } from './islands.ts'
export { inboxScreen } from './screens.tsx'
