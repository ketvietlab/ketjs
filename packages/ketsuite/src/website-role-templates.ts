import type { RoleTemplateDef } from '@ketvietlab/ketjs'

const read = ['website_backend.view', 'website.view', 'website_menu.view', 'website_form.view']
/** Editors arrange navigation and forms as well as content, as the Studio editors expect. */
const author = [...read, 'website.author', 'website_menu.configure', 'website_form.configure']
/** ERP-managed roles; Website owns no parallel member or role assignment store. */
export const websiteRoleTemplates = {
  'website.designer': {
    version: 4,
    labels: { vi: 'Website · Thiết kế và cấu hình', en: 'Website · Designer' },
    bundles: [...author, 'website.configure'],
  },
  'website.reader': {
    version: 4,
    labels: { vi: 'Website · Chỉ xem', en: 'Website · Reader' },
    bundles: read,
  },
  'website.editor': {
    version: 4,
    labels: { vi: 'Website · Biên tập', en: 'Website · Editor' },
    bundles: author,
  },
  'website.publisher': {
    version: 4,
    labels: { vi: 'Website · Xuất bản', en: 'Website · Publisher' },
    // Reading, holding and exporting what visitors sent is personal data, so it stays with publishers.
    bundles: [...author, 'website.publish', 'website_form.operate', 'website_form.sensitive'],
  },
} satisfies Record<string, RoleTemplateDef>
