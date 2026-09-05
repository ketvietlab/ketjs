import { defineModule } from '@ketvietlab/ketjs'
import { models } from './models.ts'
import { sections } from './sections.ts'
import { views } from './views.ts'
import { functions } from './functions.ts'

export default defineModule({
  name: 'website_menu',
  version: '0.1.0',
  title: 'Menu điều hướng',
  summary: 'Thanh menu cho website.',
  category: 'Website',
  messages: {
    vi: {
      'app.title': 'Menu điều hướng',
      'app.summary': 'Thanh menu cho website.',
      'app.category': 'Website',
      'error.menuCycle': 'Cấu trúc menu tạo thành vòng lặp.',
      'error.menuTooDeep': 'Menu lồng nhau quá sâu.',
      'error.menuInUse': 'Không thể xóa mục menu đang có mục con.',
    },
    en: {
      'app.title': 'Navigation',
      'app.summary': 'A menu bar for the website.',
      'app.category': 'Website',
      'error.menuCycle': 'The menu structure would form a cycle.',
      'error.menuTooDeep': 'The menu is nested too deeply.',
      'error.menuInUse': 'A menu item with children cannot be deleted.',
    },
  },
  depends: ['website'],
  models,
  sections,
  views,
  functions,
})
