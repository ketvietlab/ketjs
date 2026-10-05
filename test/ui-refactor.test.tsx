import { withoutGlobalSearchDialog } from './helpers/shell.ts'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { renderToString } from '@ketvietlab/ketjs-view'
import {
  AppShell,
  AppTopbar,
  MediaLabel,
  NavigationToggle,
  Text,
  searchFilterRuleLabel,
} from '@ketvietlab/design-system'

test('topbar exposes a compact dialog launcher and a native GET fallback', () => {
  const output = renderToString(
    <AppShell
      sidebar="Menu"
      main="Content"
      topbar={
        <AppTopbar
          brand={{ label: 'KétSuite', href: '/admin', image: '/logo.png' }}
          navigation={<NavigationToggle controls="drawer" label="Mở menu" />}
          search={{
            action: '/admin/search',
            query: '<script>',
            locale: 'vi',
            label: 'Tìm toàn hệ thống',
            placeholder: 'Tìm…',
            submitLabel: 'Tìm',
          }}
        />
      }
    />,
  )
  assert.match(output, /data-has-topbar="true"/)
  assert.match(output, /data-ui="app-shell-topbar"[\s\S]*?data-ui="app-sidebar"[\s\S]*?data-ui="app-main"/)
  assert.match(output, /role="search"[^>]*action="\/admin\/search" method="get"/)
  assert.match(output, /name="lang" value="vi"/)
  assert.match(output, /name="q" value="&lt;script&gt;"/)
  assert.match(output, /aria-controls="drawer"/)
  assert.match(output, /alt="KétSuite"/)
  const header = output.match(/<header data-ui="app-topbar">([\s\S]*?)<\/header>/)?.[1] ?? ''
  assert.match(
    header,
    /data-ui="global-search-trigger"[^>]*href="\/admin\/search\?lang=vi&amp;q=%3Cscript%3E"/,
  )
  assert.match(header, /aria-haspopup="dialog" aria-controls="app-global-search" aria-expanded="false"/)
  assert.doesNotMatch(header, /<input|<form/)
  assert.match(
    output,
    /<dialog data-ui="global-search-dialog" id="app-global-search" aria-labelledby="app-global-search-sheet-title">/,
  )
  assert.match(output, /<noscript>[\s\S]*?<form data-ui="global-search"/)
  assert.doesNotMatch(output, /data-route-modal="true"/)
  const liveHtml = output.replace(/<template[^>]*>[\s\S]*?<\/template>/g, '')
  assert.doesNotMatch(liveHtml, /data-ui="modal-layer"/)
  assert.match(liveHtml, /data-ui="global-search-input"/)
})

test('record assertions exclude only closed shell search markup, preserving record modal failures', () => {
  const record = '<section data-ui="modal-layer" data-client-modal="true"></section>'
  const search =
    '<dialog data-ui="global-search-dialog"><template><section data-ui="modal-layer"></section></template></dialog>'
  assert.equal(withoutGlobalSearchDialog(search + record), record)
  const openSearch = search.replace('global-search-dialog"', 'global-search-dialog" open')
  assert.equal(withoutGlobalSearchDialog(openSearch), openSearch)
})

test('media labels preserve alignment only when requested and hide decorative images from speech', () => {
  assert.doesNotMatch(renderToString(<MediaLabel label="No image" />), /data-ui="media-label-image"|<img/)
  const reserved = renderToString(<MediaLabel label="Empty" reserveImage />)
  assert.match(reserved, /data-ui="media-label-image" data-empty="true" aria-hidden="true"/)
  assert.doesNotMatch(reserved, /<img/)
  // A reserved slot without a photo draws a placeholder icon, the default or the one asked for.
  assert.match(reserved, /data-ui="media-label-image"[^>]*>(?:<!--[^>]*-->)*<svg data-ui="icon"/)
  const named = renderToString(<MediaLabel label="Empty" reserveImage placeholder="package" />)
  assert.notEqual(named, reserved)
  assert.match(named, /<svg data-ui="icon"/)
  const photo = renderToString(
    <MediaLabel label="Photo" src="/photo.png" reserveImage placeholder="package" />,
  )
  assert.doesNotMatch(photo, /data-ui="icon"|data-empty/)
  assert.match(renderToString(<MediaLabel label="Product" src="/photo.png" />), /alt=""/)
  assert.match(renderToString(<Text tone="muted">Không</Text>), /data-tone="muted"[^>]*>[\s\S]*?Không/)
})

test('one rule formatter localizes operators and choices while preserving commas in text', () => {
  const base = {
    fieldLabel: 'Loại',
    operator: 'anyOf' as const,
    choices: [
      { value: 'goods', label: 'Hàng hoá' },
      { value: 'service', label: 'Dịch vụ' },
    ],
    operatorLabels: { anyOf: 'thuộc', contains: 'chứa', isNotSet: 'trống' },
  }
  assert.equal(searchFilterRuleLabel({ ...base, value: 'goods,service' }), 'Loại thuộc: Hàng hoá, Dịch vụ')
  assert.equal(
    searchFilterRuleLabel({ ...base, value: ['goods', 'service'] }),
    'Loại thuộc: Hàng hoá, Dịch vụ',
  )
  assert.equal(
    searchFilterRuleLabel({ ...base, operator: 'contains', value: 'áo, quần' }),
    'Loại chứa: áo, quần',
  )
  assert.equal(searchFilterRuleLabel({ ...base, operator: 'isNotSet', value: 'ignored' }), 'Loại trống')
})
