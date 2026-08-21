import type { SectionDef } from 'ketjs'

export const sections: Record<string, SectionDef> = {
  'website_form.form': {
    title: 'Biểu mẫu',
    settings: { formId: 'id', heading: 'text?', description: 'text?' },
  },
}
