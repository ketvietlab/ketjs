const vi = {
  'issue.title': 'Công việc',
  'issue.description': 'Mô tả',
  'issue.notFound': 'Không tìm thấy công việc.',
} as const

const en: Record<keyof typeof vi, string> = {
  'issue.title': 'Issue',
  'issue.description': 'Description',
  'issue.notFound': 'Issue not found.',
}

export const messages = { vi, en }
