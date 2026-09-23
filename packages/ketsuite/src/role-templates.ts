// The job roles each public KetSuite product starts with.
//
// A role template is what makes a role assignable: assignment accepts only
// managed roles, and a managed role is a template applied to the tenant. An
// install that declared none had nothing to give anybody, so every product ships
// its jobs, and `ketsuite serve` applies them before it listens
// (`user.syncRoleTemplates`).
//
// These are the private Két Việt product templates with every bundle owned by a
// private module taken out, under the same keys and the same meaning, so a role
// called `commerce.pos-cashier` is one job wherever it is read. A private role
// that had nothing public left (delivery and e-invoice integration, sale-channel
// migration, platform operation) is not here.
//
// Bump a template's `version` whenever its bundles change; roles built from the
// previous version are brought up to date by the next sync.

import type { RoleTemplateDef } from '@ketvietlab/ketjs'

const role = (
  en: string,
  vi: string,
  summaryEn: string,
  summaryVi: string,
  bundles: string[],
  version = 1,
): RoleTemplateDef => ({
  version,
  labels: { en, vi },
  summary: { en: summaryEn, vi: summaryVi },
  bundles,
})

const salesRepresentativeBundles = [
  'company.view',
  'partner.view',
  'pricing.view',
  'product.view',
  'sale.quote-operate',
  'sale.view',
]

const posCashierBundles = ['pos.order-operate', 'pos.shift-operate', 'pos.tender', 'pos.view']

const posManagerBundles = [
  ...posCashierBundles,
  'pos.cash-control',
  'pos.configure',
  'pos.reconcile',
  'pos.refund',
  'pos.shift-approve',
  'pos.sensitive',
  'pos.void',
]

const companyAdministratorBundles = [
  'company.configure',
  'company.view',
  'partner.configure',
  'partner.view',
  'product.configure',
  'product.view',
  'uom.configure',
  'uom.view',
]

const coreAuditorBundles = ['company.view', 'partner.view', 'product.view', 'user.sensitive', 'website.view']

/**
 * Everyday project work. `flow.author` is apart from `flow.operate`: writing an
 * issue or a wiki page is a different act from moving work across the board. The
 * `storage` bundles are how the issue screen lists and uploads attachments.
 */
const projectContributorBundles = [
  'flow.author',
  'flow.operate',
  'flow.view',
  'storage.operate',
  'storage.view',
]

const securityAdministratorBundles = ['oauth.security', 'user.security', 'user.sensitive']

export const commerceRoleTemplates = {
  'commerce.company-administrator': role(
    'Company Administrator',
    'Quản trị công ty',
    'Maintain company and shared master data without identity, posting, or business approval authority.',
    'Quản lý công ty và dữ liệu danh mục dùng chung; không quản trị định danh, ghi sổ hoặc duyệt nghiệp vụ.',
    companyAdministratorBundles,
  ),
  'commerce.tenant-auditor': role(
    'Tenant Auditor',
    'Kiểm toán tenant',
    'Inspect authorization and commerce evidence without mutation.',
    'Kiểm tra bằng chứng phân quyền và thương mại mà không thay đổi dữ liệu.',
    [
      ...coreAuditorBundles,
      'account.sensitive',
      'pos.sensitive',
      'pos.view',
      'purchase.report',
      'purchase.sensitive',
      'purchase.view',
      'sale.report',
      'sale.view',
      'stock.report',
      'stock.sensitive',
      'stock.view',
    ],
  ),
  'commerce.sales-representative': role(
    'Sales Representative',
    'Nhân viên kinh doanh',
    'Create and maintain quotations without confirmation, cancellation, invoicing, or administration.',
    'Tạo và cập nhật báo giá, không có quyền xác nhận, hủy, lập hóa đơn hoặc quản trị.',
    salesRepresentativeBundles,
  ),
  'commerce.sales-manager': role(
    'Sales Manager',
    'Quản lý kinh doanh',
    'Supervise quotation lifecycle and sales reporting without identity or accounting administration.',
    'Quản lý vòng đời báo giá và báo cáo bán hàng, không quản trị định danh hoặc kế toán.',
    [...salesRepresentativeBundles, 'sale.cancel', 'sale.confirm', 'sale.fulfillment-sync', 'sale.report'],
  ),
  'commerce.purchasing-operator': role(
    'Purchasing Operator',
    'Nhân viên mua hàng',
    'Prepare requests for quotation and purchase orders.',
    'Chuẩn bị yêu cầu báo giá và đơn mua hàng.',
    ['company.view', 'partner.view', 'product.view', 'purchase.operate', 'purchase.view'],
  ),
  'commerce.purchasing-manager': role(
    'Purchasing Manager',
    'Quản lý mua hàng',
    'Approve purchasing and maintain purchasing policy.',
    'Duyệt mua hàng và quản lý chính sách mua hàng.',
    [
      'company.view',
      'partner.view',
      'product.view',
      'purchase.approve',
      'purchase.configure',
      'purchase.operate',
      'purchase.report',
      'purchase.view',
    ],
  ),
  'commerce.warehouse-operator': role(
    'Warehouse Operator',
    'Nhân viên kho',
    'Perform ordinary stock movements inside the assigned scope.',
    'Thực hiện nghiệp vụ kho thông thường trong phạm vi được giao.',
    ['company.view', 'product.view', 'stock.operate', 'stock.view'],
  ),
  'commerce.warehouse-manager': role(
    'Warehouse Manager',
    'Quản lý kho',
    'Approve stock operations and maintain stock configuration.',
    'Duyệt nghiệp vụ kho và quản lý cấu hình kho.',
    [
      'company.view',
      'product.view',
      'stock.approve',
      'stock.configure',
      'stock.operate',
      'stock.report',
      'stock.view',
    ],
  ),
  'commerce.pos-cashier': role(
    'POS Cashier',
    'Thu ngân POS',
    'Operate assigned POS orders, shifts, and tender without refund, void, cash-control, or configuration.',
    'Vận hành đơn, ca và nhận thanh toán được giao; không hoàn tiền, hủy thanh toán, kiểm soát tiền hoặc cấu hình.',
    posCashierBundles,
  ),
  'commerce.pos-manager': role(
    'POS Manager',
    'Quản lý POS',
    'Manage POS exceptions and reconciliation inside an assigned branch.',
    'Quản lý ngoại lệ và đối soát POS trong chi nhánh được giao.',
    posManagerBundles,
  ),
  'commerce.accountant': role(
    'Accountant',
    'Kế toán viên',
    'Prepare and post accounting documents and issue invoices under domain policy.',
    'Chuẩn bị, ghi sổ chứng từ và lập hóa đơn theo chính sách nghiệp vụ.',
    ['account.approve', 'account.operate', 'account.sensitive', 'sale.invoice'],
  ),
  'commerce.tenant-security-administrator': role(
    'Tenant Security Administrator',
    'Quản trị bảo mật tenant',
    'Manage KetSuite identities, roles, grants, and login links without business authority.',
    'Quản lý định danh, vai trò, quyền và liên kết đăng nhập KetSuite; không có quyền nghiệp vụ.',
    securityAdministratorBundles,
  ),
} satisfies Record<string, RoleTemplateDef>

export const hospitalityRoleTemplates = {
  'hospitality.company-administrator': role(
    'Company Administrator',
    'Quản trị công ty',
    'Maintain company and shared master data without identity, billing post, or stay approval authority.',
    'Quản lý công ty và dữ liệu danh mục dùng chung; không quản trị định danh, ghi sổ hoặc duyệt lưu trú.',
    companyAdministratorBundles,
  ),
  'hospitality.front-desk-operator': role(
    'Front Desk Operator',
    'Nhân viên lễ tân',
    'Operate reservations and stays without billing post or configuration.',
    'Vận hành đặt phòng và lưu trú, không ghi sổ thanh toán hoặc cấu hình.',
    ['hospitality_core.operate', 'hospitality_core.view', 'partner.view', 'product.view'],
  ),
  'hospitality.reservation-agent': role(
    'Reservation Agent',
    'Nhân viên đặt phòng',
    'Quote, enter, and amend reservations without cancellation approval or stay operations.',
    'Báo giá, nhập và sửa đặt phòng; không duyệt hủy hoặc vận hành lưu trú.',
    ['hospitality_core.reservation-input', 'partner.view'],
  ),
  'hospitality.reservation-manager': role(
    'Reservation Manager',
    'Quản lý đặt phòng',
    'Approve reservation and stay lifecycle changes and maintain hospitality policy.',
    'Duyệt thay đổi vòng đời đặt phòng, lưu trú và quản lý chính sách lưu trú.',
    [
      'hospitality_core.approve',
      'hospitality_core.configure',
      'hospitality_core.operate',
      'hospitality_core.sensitive',
      'hospitality_core.view',
      'partner.view',
      'product.view',
    ],
  ),
  'hospitality.billing-operator': role(
    'Hospitality Billing Operator',
    'Nhân viên thanh toán lưu trú',
    'Prepare hospitality billing records without accounting post.',
    'Chuẩn bị chứng từ thanh toán lưu trú, không ghi sổ kế toán.',
    ['hospitality_billing.operate', 'hospitality_billing.view', 'hospitality_core.view'],
  ),
  'hospitality.billing-accountant': role(
    'Hospitality Billing Accountant',
    'Kế toán lưu trú',
    'Approve hospitality billing and post accounting records under domain policy.',
    'Duyệt thanh toán lưu trú và ghi sổ theo chính sách nghiệp vụ.',
    [
      'account.approve',
      'account.operate',
      'account.sensitive',
      'hospitality_billing.approve',
      'hospitality_billing.configure',
      'hospitality_billing.operate',
      'hospitality_billing.view',
    ],
  ),
  'hospitality.housekeeping-attendant': role(
    'Housekeeping Attendant',
    'Nhân viên buồng phòng',
    'Read, start, and complete cleaning work without guest, folio, or room-status authority.',
    'Xem, bắt đầu và hoàn tất công việc buồng phòng; không xem hồ sơ khách, folio hoặc đổi trạng thái phòng.',
    ['hospitality_core.housekeeping-attend', 'hospitality_core.property-reference'],
  ),
  'hospitality.housekeeping-supervisor': role(
    'Housekeeping Supervisor',
    'Giám sát buồng phòng',
    'Assign and supervise cleaning work and room status without folio or guest-document access.',
    'Phân công, giám sát buồng phòng và trạng thái phòng; không xem folio hoặc giấy tờ khách.',
    [
      'hospitality_core.housekeeping-attend',
      'hospitality_core.housekeeping-supervise',
      'hospitality_core.property-reference',
    ],
  ),
  'hospitality.night-auditor': role(
    'Night Auditor',
    'Nhân viên kiểm toán đêm',
    'Inspect operational stays and folios and run night audit without charge, payment, or invoice authority.',
    'Kiểm tra lưu trú, folio và chạy kiểm toán đêm; không ghi charge, thu tiền hoặc lập hóa đơn.',
    ['hospitality_core.night-audit'],
  ),
  'hospitality.revenue-operator': role(
    'Revenue Operator',
    'Nhân viên doanh thu',
    'Maintain rates and inventory without charge authority.',
    'Quản lý giá và tồn phòng; không ghi charge.',
    ['hospitality_core.revenue-operate'],
  ),
  'hospitality.compliance-operator': role(
    'Hospitality Compliance Operator',
    'Nhân viên tuân thủ lưu trú',
    'Progress stay-notice submissions without reservation, guest-document, folio, or charge authority.',
    'Xử lý thông báo lưu trú; không sửa đặt phòng, xem giấy tờ khách, folio hoặc ghi charge.',
    ['hospitality_core.compliance-operate', 'hospitality_core.property-reference'],
  ),
  'hospitality.manager': role(
    'Hospitality Manager',
    'Quản lý lưu trú',
    'Manage reservation, stay, and billing workflows without identity administration.',
    'Quản lý đặt phòng, lưu trú và thanh toán; không quản trị định danh.',
    [
      'hospitality_billing.approve',
      'hospitality_billing.configure',
      'hospitality_billing.operate',
      'hospitality_billing.view',
      'hospitality_core.approve',
      'hospitality_core.configure',
      'hospitality_core.operate',
      'hospitality_core.sensitive',
      'hospitality_core.view',
    ],
  ),
  'hospitality.auditor': role(
    'Hospitality Auditor',
    'Kiểm toán lưu trú',
    'Inspect hospitality and accounting evidence without mutation.',
    'Kiểm tra bằng chứng lưu trú và kế toán mà không thay đổi dữ liệu.',
    [
      'account.sensitive',
      'hospitality_billing.view',
      'hospitality_core.sensitive',
      'hospitality_core.view',
      'user.sensitive',
    ],
  ),
  'hospitality.tenant-security-administrator': role(
    'Tenant Security Administrator',
    'Quản trị bảo mật tenant',
    'Manage KetSuite identities, roles, grants, and login links without hospitality authority.',
    'Quản lý định danh, vai trò, quyền và liên kết đăng nhập KetSuite; không có quyền lưu trú.',
    securityAdministratorBundles,
  ),
} satisfies Record<string, RoleTemplateDef>

export const officeRoleTemplates = {
  'office.company-administrator': role(
    'Company Administrator',
    'Quản trị công ty',
    'Maintain company and shared master data without identity or accounting authority.',
    'Quản lý công ty và dữ liệu danh mục dùng chung; không có quyền định danh hoặc kế toán.',
    companyAdministratorBundles,
  ),
  'office.tenant-auditor': role(
    'Tenant Auditor',
    'Kiểm toán tenant',
    'Inspect back-office business and authorization evidence without mutation.',
    'Kiểm tra bằng chứng nghiệp vụ back-office và phân quyền mà không thay đổi dữ liệu.',
    [
      ...coreAuditorBundles,
      'account.sensitive',
      'crm.report',
      'crm.view',
      // Reading project work is all this role gets: no bundle here reaches a Flow key that writes.
      'flow.view',
      'purchase.report',
      'purchase.sensitive',
      'purchase.view',
      'sale.report',
      'sale.view',
      'stock.report',
      'stock.sensitive',
      'stock.view',
    ],
  ),
  'office.project-contributor': role(
    'Project Contributor',
    'Thành viên dự án',
    'Work issues and write project documents without changing how a project is configured.',
    'Làm việc trên công việc và soạn tài liệu dự án, không đổi cấu hình dự án.',
    projectContributorBundles,
  ),
  'office.project-administrator': role(
    'Project Administrator',
    'Quản trị dự án',
    'Define columns, issue types, fields and tags on top of everyday project work.',
    'Định nghĩa cột, loại công việc, trường và nhãn, ngoài công việc hằng ngày.',
    // `flow.configure` decides which column means "done", and with it every progress figure.
    [...projectContributorBundles, 'flow.configure'],
  ),
  'office.identity-administrator': role(
    'Identity Administrator',
    'Quản trị định danh',
    'Link external login identities and administer KetSuite roles and grants without business authority.',
    'Liên kết định danh đăng nhập ngoài và quản trị role/grant KetSuite, không có quyền nghiệp vụ.',
    ['oauth.security', 'oauth.sensitive', 'user.security', 'user.sensitive'],
  ),
} satisfies Record<string, RoleTemplateDef>

/** Role templates by public product deployment. */
export const ketsuiteRoleTemplates = {
  commerce: commerceRoleTemplates,
  hospitality: hospitalityRoleTemplates,
  office: officeRoleTemplates,
} satisfies Record<string, Record<string, RoleTemplateDef>>
