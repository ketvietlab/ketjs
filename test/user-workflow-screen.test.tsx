import assert from 'node:assert/strict'
import { test } from 'node:test'
import { renderToString } from '@ketvietlab/ketjs-view'
import { UserWorkflow } from '@ketvietlab/ketsuite/ui'

const base = {
  action: '/admin/users/new/account',
  cancelHref: '/admin/users',
  companies: [{ id: 'company', name: 'Công ty' }],
  branches: [{ id: 'branch', name: 'Chi nhánh', companyId: 'company' }],
  roles: [],
  emailCheckUrl: '/admin/users/new/account/check-email',
}

test('create-user workflow renders server refusals on the responsible controls', () => {
  const identity = renderToString(
    <UserWorkflow
      {...base}
      values={{ id: 'draft', name: 'Tên đang nhập', login: '', email: 'invalid' }}
      step={0}
      fieldErrors={{ login: 'Trường này là bắt buộc.', email: 'Giá trị không đúng định dạng.' }}
    />,
  )
  assert.match(identity, /name="name"[^>]*value="Tên đang nhập"/)
  assert.match(identity, /name="login"[^>]*aria-invalid="true"/)
  assert.match(identity, /name="email"[^>]*aria-invalid="true"/)
  assert.match(identity, /id="field-create-user-login-error"[^>]*>[\s\S]*?Trường này là bắt buộc/)

  const workplace = renderToString(
    <UserWorkflow
      {...base}
      values={{ id: 'draft', companyId: 'company', branchId: 'branch' }}
      step={1}
      fieldErrors={{ branchId: 'Chi nhánh không thuộc công ty.' }}
    />,
  )
  assert.match(
    workplace,
    /id="field-workflow-branchId"[^>]*aria-invalid="true"[^>]*aria-describedby="field-workflow-branchId-error"/,
  )
  assert.match(workplace, /id="field-workflow-branchId-error"[^>]*>[\s\S]*?Chi nhánh không thuộc công ty/)
})
