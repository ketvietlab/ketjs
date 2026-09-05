import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Translator } from '@ketvietlab/ketjs'
import { renderToString } from '@ketvietlab/ketjs-view'
import {
  journalEntryCreateModal,
  journalEntryCreateScreen,
} from '../packages/ketsuite/src/modules/account_backend/screens/journal-entry-create.tsx'
import { journalEntriesListScreen } from '../packages/ketsuite/src/modules/account_backend/screens/journal-entries-list.tsx'

const messages: Record<string, string> = {
  'account_backend.action.cancelEdit': 'Huỷ',
  'account_backend.action.create': 'Tạo',
  'account_backend.entries.title': 'Bút toán',
  'account_backend.entry.create.hint': 'Tạo phần đầu rồi bổ sung các dòng bút toán.',
  'account_backend.entry.create.title': 'Tạo bút toán',
  'account_backend.entry.empty': 'Chưa có bút toán',
  'account_backend.entry.emptyHint': 'Tạo bút toán đầu tiên.',
  'account_backend.entry.subtitle': 'Theo dõi các bút toán nháp và đã ghi sổ.',
  'account_backend.entry.summary.draft': 'Nháp',
  'account_backend.entry.summary.posted': 'Đã ghi sổ',
  'account_backend.entry.summary.total': 'Tổng bút toán',
  'account_backend.field.date': 'Ngày',
  'account_backend.field.name': 'Tên',
  'account_backend.field.ref': 'Tham chiếu',
  'account_backend.field.state': 'Trạng thái',
  'account_backend.moveState.draft': 'Nháp',
  'account_backend.moveState.posted': 'Đã ghi sổ',
  'backend.chrome.next': 'Trang sau',
  'backend.chrome.previous': 'Trang trước',
}

const translate = ((key: string) => messages[key] ?? key) as Translator
translate.locale = 'vi'
translate.has = (key) => key in messages
translate.resolves = translate.has

test('journal entries ListPage keeps command controls, lifecycle summary, row links and paging', () => {
  const html = renderToString(
    journalEntriesListScreen(translate, {
      frame: {
        chrome: {
          search: {
            name: 'q',
            value: 'tham chiếu',
            placeholder: 'Bút toán',
            facets: [{ label: 'Nháp', without: '/admin/accounting/entries?lang=vi' }],
            menus: [],
          },
          pager: { from: 1, to: 1, total: 1, prev: null, next: null },
        },
      },
      rows: [
        {
          id: 'entry-1',
          name: 'MISC/2026/00001',
          date: '2026-08-27T00:00:00.000Z',
          ref: 'Tham chiếu HTTP',
          state: 'posted',
        },
      ],
      createHref: '/admin/accounting/entries?lang=vi&state=draft&create=1',
      rowHref: (row) => `/admin/accounting/entries/${String(row.id)}?lang=vi`,
      summary: { total: 4, draft: 3, posted: 1 },
    }),
  )

  assert.match(html, /data-ui="list-page"/)
  assert.match(html, /href="\/admin\/accounting\/entries\?lang=vi&amp;state=draft&amp;create=1"/)
  assert.match(html, /data-ui="chrome-search"[\s\S]*?name="q"[\s\S]*?value="tham chiếu"/)
  assert.match(html, /data-ui="facet"[\s\S]*?Nháp/)
  assert.match(html, /Tổng bút toán: 4[\s\S]*?Nháp: 3[\s\S]*?Đã ghi sổ: 1/)
  assert.match(html, /data-row-href="\/admin\/accounting\/entries\/entry-1\?lang=vi"/)
  assert.match(html, /data-col="state"[\s\S]*?data-tone="positive"[\s\S]*?Đã ghi sổ/)
  assert.doesNotMatch(html, /id="journal-entry-create-form"|data-ui="record-workspace"|mail\.chatter/)
})

test('journal entry FormPage preserves validation, relation value and idempotency key', () => {
  const html = renderToString(
    journalEntryCreateScreen(translate, {
      frame: {},
      action: '/admin/accounting/entries?lang=vi&create=1',
      cancelHref: '/admin/accounting/entries?lang=vi',
      idempotencyKey: 'entry-request-1',
      errors: ['Sổ nhật ký không tồn tại'],
      fields: [
        {
          name: 'journalId',
          label: 'Sổ nhật ký',
          type: 'select',
          value: 'missing',
          error: 'Sổ nhật ký không tồn tại',
          options: [{ value: 'general', label: 'MISC · Nhật ký chung' }],
        },
        { name: 'ref', label: 'Tham chiếu', value: 'Giá trị bị từ chối' },
        {
          name: 'partnerId',
          label: 'Đối tác',
          control: <div data-island="backend.relation-select" data-selected="partner-1" />,
        },
      ],
    }),
  )

  assert.match(html, /data-ui="form-page" data-scope="account-journal-entry-form-page"/)
  assert.match(html, /id="journal-entry-create-form"/)
  assert.match(html, /type="hidden" name="id" value="entry-request-1"/)
  assert.match(html, /name="journalId"[\s\S]*?aria-invalid="true"/)
  assert.match(html, /name="ref"[^>]*value="Giá trị bị từ chối"/)
  assert.match(html, /data-island="backend\.relation-select"[^>]*data-selected="partner-1"/)
  assert.match(html, /form="journal-entry-create-form"[\s\S]*?Tạo/)
  assert.doesNotMatch(html, /data-ui="list-page"|mail\.chatter/)
})

test('journal entry modal is URL-addressable and keeps list return state', () => {
  const html = renderToString(
    journalEntryCreateModal(translate, {
      frame: {},
      action: '/admin/accounting/entries?lang=vi&state=draft&create=1',
      cancelHref: '/admin/accounting/entries?lang=vi&state=draft',
      idempotencyKey: 'entry-request-modal',
      fields: [{ name: 'ref', label: 'Tham chiếu' }],
    }),
  )

  assert.match(html, /data-ui="modal-layer" data-route-modal="true" data-presentation="sheet"/)
  assert.match(html, /action="\/admin\/accounting\/entries\?lang=vi&amp;state=draft&amp;create=1"/)
  assert.match(html, /href="\/admin\/accounting\/entries\?lang=vi&amp;state=draft"/)
  assert.match(html, /type="hidden" name="id" value="entry-request-modal"/)
})
