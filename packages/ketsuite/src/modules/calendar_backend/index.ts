import { defineModule } from '@ketvietlab/ketjs'
import { islands } from './islands.ts'
import { routes } from './routes.ts'

export default defineModule({
  name: 'calendar_backend',
  group: 'system',
  version: '0.1.0',
  depends: ['calendar', 'backend'],
  install: 'auto',
  app: true,
  title: 'Lịch trong quản trị',
  summary: 'Lịch biểu, tuần và tháng với sự kiện theo múi giờ.',
  category: 'Năng suất',
  assets: new URL('../../ui/client/', import.meta.url),
  styles: ['calendar.css'],
  islands,
  routes,
  joints: { 'screen.board': { props: { lang: 'text?', view: 'text?' } } },
  fills: { 'calendar_backend:screen.board': `{% island "calendar.board" %}` },
  menus: {
    calendar: {
      label: 'menu.app',
      icon: 'calendar',
      path: '/admin/calendar',
      sequence: 13,
      needs: 'calendar.listAgenda',
    },
  },
  messages: {
    vi: {
      'app.title': 'Lịch trong quản trị',
      'app.summary': 'Lịch biểu, tuần và tháng với sự kiện theo múi giờ.',
      'app.category': 'Năng suất',
      'menu.app': 'Lịch',
      title: 'Lịch làm việc',
    },
    en: {
      'app.title': 'Calendar in admin',
      'app.summary': 'Timezone-aware agenda, week and month views.',
      'app.category': 'Productivity',
      'menu.app': 'Calendar',
      title: 'Work calendar',
    },
  },
})

export { islands } from './islands.ts'
export { calendarScreen } from './screens.tsx'
