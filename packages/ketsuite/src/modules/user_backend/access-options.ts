// Compatibility helpers for deployment-owned account creation workflows.
// Reads retain the caller's authorization and tenant/company scope.
import type { Route, ServeContext } from '@ketvietlab/ketjs'
type Req = Parameters<Route>[1]
type Row = Record<string, any>
const messages: Record<string, string> = {
  E_ROLE_NOT_ASSIGNABLE: 'Có vai trò không còn khả dụng. Vui lòng chọn lại.',
  E_ROLE_ALREADY_ASSIGNED: 'Vai trò đã được gán tại phạm vi này.',
  E_ROLE_SELECTION_INVALID: 'Chọn một hoặc nhiều vai trò khác nhau.',
  E_ASSIGNMENT_MEMBERSHIP_REQUIRED: 'Chưa có nơi làm việc. Chọn thêm nơi làm việc còn thiếu.',
  E_ASSIGNMENT_SCOPE_INVALID: 'Chọn công ty và chi nhánh phù hợp.',
  E_MEMBERSHIP_FORBIDDEN: 'Bạn không có quyền bổ sung nơi làm việc.',
  E_AUTHORIZATION_REVISION_CONFLICT: 'Quyền vừa thay đổi. Kiểm tra lại nội dung trước khi xác nhận.',
  E_EMAIL_UNAVAILABLE: 'Email đã được sử dụng.',
  email_check_unavailable: 'Chưa kiểm tra được email. Vui lòng thử lại.',
  'user.error.loginUnique': 'Tên đăng nhập đã được sử dụng.',
  unique: 'Tên đăng nhập đã được sử dụng.',
}
export const accessError = (result: { errors?: Array<{ field?: string; code: string }> }) =>
  result.errors
    ?.map(
      (e) =>
        messages[e.code] ??
        (e.code === 'user.error.required'
          ? 'Vui lòng điền đầy đủ thông tin và lý do.'
          : 'Không thể lưu thay đổi. Kiểm tra lại thông tin.'),
    )
    .join(' ') ?? 'Không thể lưu thay đổi.'
export async function accessOptions(ctx: ServeContext, url: URL, req: Req) {
  const [companies, roles] = (await Promise.all([
    ctx.call('company.listCompanies', { includeArchived: false }, url, req),
    ctx.call('user.listRoles', {}, url, req),
  ])) as [Row[], Row[]]
  const branches = (
    await Promise.all(
      companies.map((c) =>
        ctx.call('company.listBranches', { companyId: c.id, includeArchived: false }, url, req),
      ),
    )
  ).flat() as Row[]
  return {
    translate: ctx.translate(ctx.localeOf(url, req)),
    companies: companies.map((c) => ({ id: String(c.id), name: String(c.name) })),
    branches: branches.map((b) => ({
      id: String(b.id),
      name: String(b.name),
      companyId: String(b.companyId),
      isRoot: b.isRoot === true,
    })),
    roles,
  }
}
