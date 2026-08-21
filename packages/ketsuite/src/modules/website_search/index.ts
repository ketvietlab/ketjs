import { defineModule } from 'ketjs'
import { fills } from './fills.ts'
import { islands } from './islands.ts'

export default defineModule({
  name: 'website_search',
  version: '0.1.0',
  app: true,
  title: 'Tìm kiếm',
  summary: 'Ô tìm kiếm đặt được vào bất kỳ theme nào.',
  category: 'Website',
  assets: new URL('./client/', import.meta.url),
  messages: {
    vi: {
      'app.title': 'Tìm kiếm',
      'app.summary': 'Ô tìm kiếm đặt được vào bất kỳ theme nào.',
      'app.category': 'Website',
    },
    en: {
      'app.title': 'Search',
      'app.summary': 'A search box any theme can place.',
      'app.category': 'Website',
    },
  },
  depends: ['website'],
  fills,
  islands,
})
