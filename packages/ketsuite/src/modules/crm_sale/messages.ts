const vi = {
  'app.title': 'CRM · Bán hàng',
  'app.summary': 'Tạo báo giá từ cơ hội bán hàng.',
  'app.category': 'Bán hàng',
  'error.opportunityRequired': 'Chỉ cơ hội bán hàng mới tạo được báo giá.',
} as const

const en: Record<keyof typeof vi, string> = {
  'app.title': 'CRM · Sales',
  'app.summary': 'Create quotations from sales opportunities.',
  'app.category': 'Sales',
  'error.opportunityRequired': 'Only an opportunity can create a quotation.',
}

export const messages = { vi, en }
