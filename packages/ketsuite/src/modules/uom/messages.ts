import type { Message } from '@ketvietlab/ketjs'

export const messages: Record<string, Record<string, Message>> = {
  vi: {
    'app.title': 'Đơn vị tính',
    'app.summary': 'Cây đơn vị tương đối và quy đổi.',
    'app.category': 'Bán hàng',
    'type.reference': 'Đơn vị gốc',
    'type.bigger': 'Lớn hơn gốc',
    'type.smaller': 'Nhỏ hơn gốc',
  },
  en: {
    'app.title': 'Units of measure',
    'app.summary': 'Relative unit trees and conversions.',
    'app.category': 'Sales',
    'type.reference': 'Reference unit',
    'type.bigger': 'Bigger than reference',
    'type.smaller': 'Smaller than reference',
  },
}
