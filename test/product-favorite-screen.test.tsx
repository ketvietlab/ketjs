import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Translator } from '@ketvietlab/ketjs'
import { renderToString } from '@ketvietlab/ketjs-view'
import { favoriteScreen } from '../packages/ketsuite/src/modules/product_backend/screens/favorite.tsx'

const messages: Record<string, string> = {
  'product_backend.favorite.create': 'Lưu tìm kiếm hiện tại',
  'product_backend.favorite.save': 'Lưu yêu thích',
  'product_backend.favorite.name': 'Tên',
  'product_backend.favorite.default': 'Dùng làm mặc định cho danh sách này',
  'product_backend.action.cancel': 'Hủy',
}

const translate = ((key: string) => messages[key] ?? key) as Translator
translate.locale = 'vi'
translate.has = (key) => key in messages
translate.resolves = translate.has

test('product favorite: uses FormPage while preserving query state, fields and errors', () => {
  const returnTo = '/admin/product/templates?view=list&q=denim&lang=vi'
  const html = renderToString(
    favoriteScreen(translate, {}, returnTo, '?lang=vi', ['Không thể lưu tìm kiếm này']),
  )

  assert.equal(html.match(/data-ui="form-page"/g)?.length, 1)
  assert.match(html, /data-ui="form-page-title"[^>]*>[\s\S]*?Lưu tìm kiếm hiện tại/)
  assert.match(
    html,
    /data-ui="form-page-actions"[\s\S]*?type="submit"[^>]*form="product-favorite-create-form"/,
  )
  assert.match(
    html,
    /href="\/admin\/product\/templates\?view=list&amp;q=denim&amp;lang=vi"[^>]*data-variant="secondary"|data-variant="secondary"[^>]*href="\/admin\/product\/templates\?view=list&amp;q=denim&amp;lang=vi"/,
  )
  assert.match(html, /id="product-favorite-create-form"/)
  assert.match(html, /data-scope="product-favorite-create"/)
  assert.match(html, /action="\/admin\/product\/templates\/favorites\/new\?lang=vi"/)
  assert.match(
    html,
    /type="hidden"[^>]*name="returnTo"[^>]*value="\/admin\/product\/templates\?view=list&amp;q=denim&amp;lang=vi"/,
  )
  assert.match(html, /name="name"[^>]*required/)
  assert.match(html, /name="default"[^>]*type="checkbox"|type="checkbox"[^>]*name="default"/)
  assert.match(html, /data-ui="form-errors"[^>]*role="alert"[\s\S]*?Không thể lưu tìm kiếm này/)
  assert.doesNotMatch(html, /data-ui="form-actions"/)
  assert.doesNotMatch(html, /data-ui="record-workspace"|data-ui="form-page-aside"|data-ui="chatter"/)
  assert.doesNotMatch(html, /data-ui="topbar"/)
})

test('product favorite: adds the active locale to a plain cancel destination', () => {
  const html = renderToString(
    favoriteScreen(translate, {}, '/admin/product/templates?view=kanban', '?lang=vi'),
  )

  assert.match(html, /href="\/admin\/product\/templates\?view=kanban&amp;lang=vi"/)
  assert.match(html, /name="returnTo"[^>]*value="\/admin\/product\/templates\?view=kanban"/)
})
