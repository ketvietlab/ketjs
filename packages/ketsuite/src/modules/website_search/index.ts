import { defineModule } from 'ketjs'
import { islands } from './islands.ts'

export default defineModule({
  name: 'website_search',
  version: '0.1.0',
  app: true,
  title: 'Tìm kiếm',
  summary: 'Ô tìm kiếm đặt được vào bất kỳ theme nào.',
  category: 'Website',
  depends: ['website'],
  islands,
})
