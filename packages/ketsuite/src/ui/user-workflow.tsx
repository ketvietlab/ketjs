import type { JSXChild } from '@ketvietlab/ketjs-view'
import { button, linkButton } from './actions.tsx'
import { formField, formFields } from './form.tsx'
import { icon } from './icons.ts'

export type UserRoleOption = {
  id: string
  name: string
  description?: string
  disabled?: boolean
  assignedScopes?: string[]
  assigned?: boolean
}
export type UserWorkflowValues = Record<string, string>
export type UserWorkflowOptions = {
  action: string
  cancelHref: string
  values: UserWorkflowValues
  step: number
  error?: string
  fieldErrors?: Readonly<Record<string, string | null | undefined>>
  companies: Array<{ id: string; name: string }>
  branches: Array<{ id: string; name: string; companyId: string; isRoot?: boolean }>
  roles: UserRoleOption[]
  emailCheckUrl: string
  review?: boolean
  revision?: number
  preview?: JSXChild
  mode?: 'create' | 'assign' | 'remove'
}
const hidden = (name: string, value: string) => (
  <input type="hidden" name={name} value={value} autocomplete="off" />
)
export const RoleSelection = ({
  roles,
  selected,
  error,
}: {
  roles: UserRoleOption[]
  selected: string[]
  error?: string | null
}) => (
  <div class="user-role-picker" data-invalid={String(!!error)}>
    <label class="user-role-search" data-ui="form-field" data-kind="search" data-span="full">
      <span data-ui="form-label">Tìm vai trò</span>
      <input
        data-ui="form-control"
        type="search"
        data-role-search
        placeholder="Tìm theo công việc"
        autocomplete="off"
      />
    </label>
    {roles.length === 0 ? (
      <p>Chưa có vai trò khả dụng. Có thể gán vai trò sau khi danh mục được cập nhật.</p>
    ) : null}
    <div class="user-role-grid" data-ui="form-options" role="group" aria-label="Vai trò công việc">
      {roles.map((r) => (
        <label class="user-role-option" data-ui="form-option" data-role-option>
          <input
            data-ui="form-option-input"
            type="checkbox"
            name={`role.${r.id}`}
            value="on"
            data-assigned-scopes={JSON.stringify(r.assignedScopes ?? [])}
            data-role-disabled={String(!!r.disabled)}
            checked={selected.includes(r.id)}
            disabled={r.disabled || r.assigned}
            autocomplete="off"
            aria-invalid={error ? 'true' : null}
            aria-describedby={error ? 'field-workflow-roleIds-error' : null}
          />
          <span>
            <strong>{r.name}</strong>
            <small data-role-assigned hidden={!r.assigned}>
              Đã gán tại đây
            </small>
            <small data-role-description hidden={!!r.assigned}>
              {r.description ?? ''}
            </small>
          </span>
        </label>
      ))}
    </div>
    <p data-role-empty hidden>
      Không có vai trò phù hợp.
    </p>
    {error ? (
      <small data-ui="form-error" id="field-workflow-roleIds-error">
        {error}
      </small>
    ) : null}
  </div>
)
export const UserSummary = ({
  rows,
}: {
  rows: Array<{ label: string; value: JSXChild; href?: string; step?: number }>
}) => (
  <div class="user-summary">
    {rows.map((r) =>
      r.href ? (
        <a class="user-summary-row" href={r.href}>
          <span>{r.label}</span>
          <strong>{r.value}</strong>
          {icon('chevron-right')}
        </a>
      ) : r.step !== undefined ? (
        <button class="user-summary-row" type="submit" name="step" value={String(r.step)} formNoValidate>
          <span>{r.label}</span>
          <strong>{r.value}</strong>
          {icon('chevron-right')}
        </button>
      ) : (
        <div class="user-summary-row">
          <span>{r.label}</span>
          <strong>{r.value}</strong>
        </div>
      ),
    )}
  </div>
)
export const UserWorkflow = (o: UserWorkflowOptions) => {
  const v = o.values,
    mode = o.mode ?? 'create',
    selected = Object.keys(v)
      .filter((k) => k.startsWith('role.'))
      .map((k) => k.slice(5))
  const selectedNames =
    o.roles
      .filter((r) => selected.includes(r.id))
      .map((r) => r.name)
      .join(', ') || 'Chưa gán vai trò'
  const scopeFields = (
    <div data-ui="form-grid" data-layout="record">
      {mode === 'assign'
        ? formField({
            name: 'scopeKind',
            label: 'Phạm vi',
            type: 'select',
            value: v.scopeKind ?? 'company',
            error: o.fieldErrors?.scopeKind,
            options: [
              { value: 'company', label: 'Công ty' },
              { value: 'branch', label: 'Chi nhánh' },
              { value: 'tenant', label: 'Toàn tổ chức' },
            ],
          })
        : null}
      {formField({
        name: 'companyId',
        label: 'Công ty',
        type: 'select',
        value: v.companyId,
        required: mode === 'create',
        error: o.fieldErrors?.companyId,
        options: [
          { value: '', label: 'Chọn công ty' },
          ...o.companies.map((company) => ({ value: company.id, label: company.name })),
        ],
      })}
      {formField({
        name: 'branchId',
        label: 'Chi nhánh',
        error: o.fieldErrors?.branchId,
        control: (
          <select
            data-ui="form-control"
            id="field-workflow-branchId"
            name="branchId"
            value={v.branchId ?? ''}
            aria-invalid={o.fieldErrors?.branchId ? 'true' : null}
            aria-describedby={o.fieldErrors?.branchId ? 'field-workflow-branchId-error' : null}
          >
            <option value="">Cấp công ty (không chọn chi nhánh)</option>
            {o.branches
              .filter((branch) => !branch.isRoot)
              .map((branch) => (
                <option
                  value={branch.id}
                  data-company-id={branch.companyId}
                  selected={branch.id === v.branchId}
                >
                  {branch.name}
                </option>
              ))}
          </select>
        ),
      })}
    </div>
  )
  const visible = new Set(
    mode === 'create'
      ? o.step === 0
        ? ['name', 'login', 'email']
        : o.step === 1
          ? ['companyId', 'branchId']
          : o.step === 2
            ? selected.map((x) => 'role.' + x)
            : []
      : o.review
        ? ['reason']
        : [
            'scopeKind',
            'companyId',
            'branchId',
            'addMembership',
            'reason',
            ...selected.map((x) => 'role.' + x),
          ],
  )
  return (
    <div class="user-workflow">
      <form method="post" action={o.action} data-user-workflow data-email-check={o.emailCheckUrl}>
        {Object.entries(v)
          .filter(
            ([k]) =>
              !visible.has(k) &&
              !['step', 'command', 'currentStep', 'expectedAuthorizationRevision'].includes(k),
          )
          .map(([k, value]) => hidden(k, value))}
        {hidden('currentStep', String(o.step))}
        {hidden('expectedAuthorizationRevision', String(o.revision ?? v.expectedAuthorizationRevision ?? 0))}
        {mode === 'create' ? (
          <ol class="user-steps" aria-label="Các bước tạo người dùng">
            {['Danh tính', 'Nơi làm việc', 'Vai trò', 'Xác nhận'].map((label, i) => (
              <li
                class={i === o.step ? 'current' : i < o.step ? 'complete' : ''}
                aria-current={i === o.step ? 'step' : undefined}
              >
                <span>{i < o.step ? '✓' : i + 1}</span>
                <div>
                  <strong>{label}</strong>
                  <small>
                    {i === o.step ? 'Đang thực hiện' : i < o.step ? 'Đã hoàn tất' : 'Chưa thực hiện'}
                  </small>
                </div>
              </li>
            ))}
          </ol>
        ) : null}
        {o.error ? (
          <div class="user-notice error" role="alert">
            {o.error}
          </div>
        ) : null}
        {mode === 'create' && o.step === 0 ? (
          <section>
            <h2>Danh tính</h2>
            {formFields(
              [
                {
                  name: 'name',
                  label: 'Họ và tên',
                  value: v.name ?? '',
                  required: true,
                  error: o.fieldErrors?.name,
                },
                {
                  name: 'login',
                  label: 'Tên đăng nhập',
                  value: v.login ?? '',
                  required: true,
                  error: o.fieldErrors?.login,
                },
                {
                  name: 'email',
                  label: 'Email',
                  value: v.email ?? '',
                  type: 'email',
                  required: true,
                  error: o.fieldErrors?.email,
                },
              ],
              'create-user',
              'record',
            )}
            <div class="user-email-status" data-email-status role="status" aria-live="polite" />
            <span data-email-retry hidden>
              {button({ label: 'Kiểm tra lại', name: 'emailRetry', variant: 'tertiary' })}
            </span>
          </section>
        ) : null}
        {(mode === 'create' && o.step === 1) || (mode === 'assign' && !o.review) ? (
          <section>
            <h2>Nơi áp dụng</h2>
            {scopeFields}
            {mode === 'assign' ? (
              <label
                class="user-check"
                data-ui="form-field"
                data-kind="checkbox"
                data-invalid={String(!!o.fieldErrors?.addMembership)}
              >
                <input
                  data-ui="form-control"
                  type="checkbox"
                  name="addMembership"
                  checked={v.addMembership === 'on'}
                  autocomplete="off"
                  aria-invalid={o.fieldErrors?.addMembership ? 'true' : null}
                  aria-describedby={
                    o.fieldErrors?.addMembership ? 'field-workflow-addMembership-error' : null
                  }
                />
                <span data-ui="form-label">Thêm nơi làm việc còn thiếu</span>
                {o.fieldErrors?.addMembership ? (
                  <small data-ui="form-error" id="field-workflow-addMembership-error">
                    {o.fieldErrors.addMembership}
                  </small>
                ) : null}
              </label>
            ) : (
              <p>Tư cách thành viên chưa đủ để sử dụng nghiệp vụ. Vai trò xác định công việc được phép.</p>
            )}
          </section>
        ) : null}
        {(mode === 'create' && o.step === 2) || (mode === 'assign' && !o.review) ? (
          <section>
            <h2>Vai trò công việc</h2>
            <p>Có thể chọn nhiều vai trò có sẵn cho cùng nơi làm việc.</p>
            <RoleSelection roles={o.roles} selected={selected} error={o.fieldErrors?.roleIds} />
          </section>
        ) : null}
        {mode === 'create' && o.step === 3 ? (
          <section>
            <h2>Tài khoản sẽ tạo</h2>
            <UserSummary
              rows={[
                { label: 'Họ và tên', value: v.name, step: 0 },
                { label: 'Tên đăng nhập', value: v.login, step: 0 },
                { label: 'Email', value: v.email, step: 0 },
                {
                  label: 'Công ty',
                  value: o.companies.find((c) => c.id === v.companyId)?.name ?? '',
                  step: 1,
                },
                {
                  label: 'Chi nhánh',
                  value: o.branches.find((b) => b.id === v.branchId)?.name ?? 'Không chọn',
                  step: 1,
                },
                { label: 'Vai trò', value: selectedNames, step: 2 },
              ]}
            />
          </section>
        ) : null}
        {mode === 'assign' && o.review ? (
          <UserSummary
            rows={[
              {
                label: 'Phạm vi',
                value:
                  v.scopeKind === 'tenant'
                    ? 'Toàn tổ chức'
                    : (o.companies.find((c) => c.id === v.companyId)?.name ?? 'Công ty'),
              },
              ...(v.scopeKind === 'branch'
                ? [{ label: 'Chi nhánh', value: o.branches.find((b) => b.id === v.branchId)?.name ?? '' }]
                : []),
              { label: 'Vai trò sẽ gán', value: selectedNames },
              {
                label: 'Nơi làm việc',
                value: v.addMembership === 'on' ? 'Bổ sung nếu còn thiếu' : 'Giữ nguyên',
              },
            ]}
          />
        ) : null}
        {o.preview}
        {mode !== 'create'
          ? formField({
              name: 'reason',
              label: 'Lý do thay đổi',
              type: 'textarea',
              value: v.reason ?? '',
              required: true,
              span: 'full',
              error: o.fieldErrors?.reason,
            })
          : null}
        <footer class="user-action-bar">
          <div>
            {mode === 'assign' && o.review
              ? button({
                  label: 'Quay lại',
                  type: 'submit',
                  name: 'command',
                  value: 'edit',
                  formNoValidate: true,
                })
              : null}
            {mode === 'create' && o.step > 0
              ? button({
                  label: 'Quay lại',
                  type: 'submit',
                  name: 'step',
                  value: String(o.step - 1),
                  formNoValidate: true,
                })
              : null}
          </div>
          <div>
            {linkButton({ label: 'Hủy', href: o.cancelHref })}
            {mode === 'create' && o.step < 3
              ? button({
                  label: 'Tiếp tục',
                  type: 'submit',
                  name: 'step',
                  value: String(o.step + 1),
                  variant: 'primary',
                })
              : button({
                  label:
                    mode === 'create'
                      ? 'Tạo người dùng'
                      : mode === 'assign'
                        ? o.review
                          ? 'Xác nhận gán vai trò'
                          : 'Tiếp tục'
                        : 'Xác nhận gỡ vai trò',
                  type: 'submit',
                  name: 'command',
                  value: mode === 'assign' && !o.review ? 'preview' : 'confirm',
                  variant: 'primary',
                })}
          </div>
        </footer>
      </form>
    </div>
  )
}
export const AccessScope = ({
  title,
  description,
  action,
  children,
}: {
  title: string
  description?: string
  action?: JSXChild
  children: JSXChild
}) => (
  <section class="user-access-scope">
    <header>
      <div>
        <h2>{title}</h2>
        {description ? <p>{description}</p> : null}
      </div>
      {action}
    </header>
    {children}
  </section>
)
export const AccessContext = (o: {
  action: string
  companyId: string
  branchId: string
  companies: Array<{ id: string; name: string }>
  branches: Array<{ id: string; name: string; companyId: string; isRoot?: boolean }>
}) => (
  <form method="get" action={o.action} class="user-access-context">
    <strong>Xem quyền tại</strong>
    <label>
      Công ty
      <select name="companyId">
        {o.companies.map((c) => (
          <option value={c.id} selected={c.id === o.companyId}>
            {c.name}
          </option>
        ))}
      </select>
    </label>
    <label>
      Chi nhánh
      <select name="branchId">
        <option value="">Cấp công ty</option>
        {o.branches
          .filter((b) => b.companyId === o.companyId && !b.isRoot)
          .map((b) => (
            <option value={b.id} selected={b.id === o.branchId}>
              {b.name}
            </option>
          ))}
      </select>
    </label>
    <button type="submit">Xem quyền</button>
    <small>Chỉ thay đổi phạm vi đang xem, không thay đổi quyền của người dùng.</small>
  </form>
)

export const CredentialDelivery = ({ password }: { password?: string }) => (
  <div class="user-workflow">
    {password ? (
      <section>
        <h2>Mật khẩu tạm — chỉ hiển thị một lần</h2>
        <code>{password}</code>
        <p>Lưu lại để bàn giao cho người dùng.</p>
      </section>
    ) : (
      <form method="post">
        <p>Chỉ người tạo tài khoản được nhận một lần, trong vòng 15 phút.</p>
        <footer class="user-action-bar">
          <div />
          <div>
            <button class="primary" name="command" value="claim" type="submit">
              Nhận mật khẩu tạm
            </button>
          </div>
        </footer>
      </form>
    )}
  </div>
)
