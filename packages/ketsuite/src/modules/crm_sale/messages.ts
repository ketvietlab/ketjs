const vi = {
  'app.title': 'CRM · Bán hàng',
  'app.summary': 'Tạo báo giá từ cơ hội bán hàng.',
  'app.category': 'Bán hàng',
  'error.opportunityRequired': 'Chỉ cơ hội bán hàng mới tạo được báo giá.',
  'error.productRequired': 'Cần chọn ít nhất một sản phẩm cho báo giá.',
  'error.partnerRequired': 'Cơ hội cần có đối tác trước khi tạo báo giá.',
} as const

const en: Record<keyof typeof vi, string> = {
  'app.title': 'CRM · Sales',
  'app.summary': 'Create quotations from sales opportunities.',
  'app.category': 'Sales',
  'error.opportunityRequired': 'Only an opportunity can create a quotation.',
  'error.productRequired': 'A quotation needs at least one product.',
  'error.partnerRequired': 'The opportunity needs a partner before it can be quoted.',
}

export const messages = { vi, en }
