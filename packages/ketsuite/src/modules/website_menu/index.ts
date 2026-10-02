import { defineModule } from '@ketvietlab/ketjs'
import { models } from './models.ts'
import { sections } from './sections.ts'
import { views } from './views.ts'
import { functions } from './functions.ts'
import { menuState, saveMenu } from './studio-menu.ts'

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
      'error.invalidDirection': 'Chỉ di chuyển lên hoặc xuống.',
      'error.menuInUse': 'Không thể xóa mục menu đang có mục con.',
      'error.menuTooLarge': 'Menu có tối đa 100 mục.',
      'error.invalidItem': 'Mục menu không hợp lệ.',
      'error.invalidParent': 'Mục cha không có trong menu này.',
      'error.invalidLink': 'Liên kết phải là đường dẫn trong website hoặc địa chỉ http(s).',
      'error.invalidLabel': 'Tên mục menu không được để trống và tối đa 200 ký tự.',
    },
    en: {
      'app.title': 'Navigation',
      'app.summary': 'A menu bar for the website.',
      'app.category': 'Website',
      'error.menuCycle': 'The menu structure would form a cycle.',
      'error.menuTooDeep': 'The menu is nested too deeply.',
      'error.invalidDirection': 'A move is up or down.',
      'error.menuInUse': 'A menu item with children cannot be deleted.',
      'error.menuTooLarge': 'A menu has at most 100 items.',
      'error.invalidItem': 'A menu item is not valid.',
      'error.invalidParent': 'The parent item is not in this menu.',
      'error.invalidLink': 'A link is a path on this site or an http(s) address.',
      'error.invalidLabel': 'A menu label is required and at most 200 characters.',
    },
  },
  depends: ['website'],
  models,
  sections,
  views,
  functions: { ...functions, menuState, saveMenu },
})
