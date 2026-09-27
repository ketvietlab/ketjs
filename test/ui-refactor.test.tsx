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

test('topbar exposes a native GET search, accessible brand and mobile drawer trigger', () => {
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
})

test('media labels preserve alignment only when requested and hide decorative images from speech', () => {
  assert.doesNotMatch(renderToString(<MediaLabel label="No image" />), /data-ui="media-label-image"|<img/)
  const reserved = renderToString(<MediaLabel label="Empty" reserveImage />)
  assert.match(reserved, /data-ui="media-label-image" aria-hidden="true"/)
  assert.doesNotMatch(reserved, /<img/)
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
