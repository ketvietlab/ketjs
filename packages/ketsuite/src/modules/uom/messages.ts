import type { Message } from 'ketjs'

export const messages: Record<string, Record<string, Message>> = {
  vi: {
    'app.title': 'Đơn vị tính',
    'app.summary': 'Nhóm đơn vị và quy đổi giữa chúng.',
    'app.category': 'Bán hàng',
    'type.reference': 'Đơn vị gốc',
    'type.bigger': 'Lớn hơn gốc',
    'type.smaller': 'Nhỏ hơn gốc',
  },
  en: {
    'app.title': 'Units of measure',
    'app.summary': 'Unit categories and the conversions between them.',
    'app.category': 'Sales',
    'type.reference': 'Reference unit',
    'type.bigger': 'Bigger than reference',
    'type.smaller': 'Smaller than reference',
  },
}
