import type { Message } from 'ketjs'

export const messages: Record<string, Record<string, Message>> = {
  vi: {
    'app.openCatalogue': 'Mở danh mục',
    'app.title': 'Sản phẩm',
    'app.summary': 'Danh mục, mẫu sản phẩm và biến thể.',
    'app.category': 'Bán hàng',
    'type.goods': 'Hàng hoá',
    'type.service': 'Dịch vụ',
    'variant.count': { one: '{count} biến thể', other: '{count} biến thể' },
  },
  en: {
    'app.openCatalogue': 'Open catalogue',
    'app.title': 'Products',
    'app.summary': 'Categories, product templates and variants.',
    'app.category': 'Sales',
    'type.goods': 'Goods',
    'type.service': 'Service',
    'variant.count': { one: '{count} variant', other: '{count} variants' },
  },
}
