import { setFlowLocale } from '../src/i18n.mjs'
setFlowLocale('vi')
import test from 'node:test'
import assert from 'node:assert/strict'
import { renderToStaticString } from '@ketvietlab/ketjs-view'
import { FlowUserPicker } from '../src/workspace.mjs'
import { FlowAvatarGroup } from '../src/index.mjs'
const options = [
  { id: 'a', name: 'Mai Anh', email: 'mai@example.test' },
  { id: 'b', name: 'Bảo', avatarUrl: '/bao.png' },
  { id: 'c', name: 'Hà', disabled: true },
]
test('shared user picker has explicit sidebar/list sizes and independent selected checkboxes', () => {
  for (const size of ['md', 'sm']) {
    const out = renderToStaticString(
      FlowUserPicker({
        id: 'users',
        label: 'Phụ trách',
        size,
        value: ['a', 'b'],
        options,
        onChange: () => {},
      }),
    )
    assert.match(out, new RegExp(`data-user-picker-size="${size}"`))
    assert.doesNotMatch(out, /<select/)
    assert.equal((out.match(/type="checkbox" checked="true"/g) ?? []).length, 2)
    assert.match(out, /aria-haspopup="dialog"/)
    assert.match(out, /aria-label="Có thể chọn nhiều người"/)
    assert.match(out, /data-flow="avatar"/)
    assert.match(out, /src="\/bao.png"/)
    assert.match(out, /2 người đã chọn/)
  }
})
test('readonly and unavailable users preserve identities; compact avatar overflow remains named', () => {
  const out = renderToStaticString(
    FlowUserPicker({
      id: 'readonly',
      label: 'Phụ trách',
      value: ['a', 'b'],
      options,
      disabled: true,
      onChange: () => {},
    }),
  )
  assert.equal((out.match(/disabled="true"/g) ?? []).length, 4)
  const missing = renderToStaticString(
    FlowUserPicker({
      id: 'missing',
      label: 'Phụ trách',
      value: ['removed'],
      options: [],
      onChange: () => {},
    }),
  )
  assert.match(missing, /Người dùng không còn khả dụng/)
  const group = renderToStaticString(FlowAvatarGroup({ users: options, limit: 2 }))
  assert.match(group, /aria-label="Mai Anh, Bảo, Hà"/)
  assert.match(group, />\+1</)
})
test('three and larger selections stay a single compact summary with complete accessible names', () => {
  const people = [
    ...options,
    { id: 'd', name: 'Nguyễn Thị Phương Linh' },
    { id: 'e', name: 'Đặng Hoàng Minh' },
  ]
  for (const count of [0, 1, 2, 3, 5])
    for (const size of ['md', 'sm']) {
      const chosen = people.slice(0, count),
        out = renderToStaticString(
          FlowUserPicker({
            id: 'many',
            label: 'Phụ trách',
            size,
            value: chosen.map((u) => u.id),
            options: people,
            onChange: () => {},
          }),
        )
      const trigger = out.slice(0, out.indexOf('</button>'))
      assert.equal((trigger.match(/data-flow="avatar"/g) ?? []).length, Math.min(count, 3))
      assert.match(
        trigger,
        new RegExp(
          `aria-label="Phụ trách: ${count ? chosen.map((u) => u.name).join(', ') : 'Chưa phân công'}"`,
        ),
      )
      assert.equal(trigger.includes('data-flow="user-selection-name"'), size === 'md' && count > 0)
      if (size === 'md' && count > 1)
        assert.match(trigger, new RegExp(`data-flow="user-selection-count">\\+${count - 1}<`))
      if (count > 3 && size === 'sm')
        assert.match(trigger, new RegExp(`data-flow="avatar-overflow">\\+${count - 3}<`))
    }
})
