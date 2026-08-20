import assert from 'node:assert/strict'
import { performance } from 'node:perf_hooks'
import { collaborationEvidenceApp } from '../tools/collaboration-evidence-fixture.ts'

type Sample = { elapsed: number; bytes: number }
type Summary = { mean: number; p50: number; p95: number; bytes: number }

const percentile = (values: number[], point: number): number => {
  const ordered = [...values].sort((a, b) => a - b)
  return ordered[Math.min(ordered.length - 1, Math.floor(ordered.length * point))] ?? 0
}

const summarize = (samples: Sample[]): Summary => {
  const times = samples.map((sample) => sample.elapsed)
  return {
    mean: times.reduce((sum, value) => sum + value, 0) / times.length,
    p50: percentile(times, 0.5),
    p95: percentile(times, 0.95),
    bytes: samples[0]?.bytes ?? 0,
  }
}

const delta = (before: number, after: number): string => `${((after / before - 1) * 100).toFixed(1)}%`

const report = (label: string, summary: Summary, suffix = ''): void =>
  console.log(
    `  ${label.padEnd(9)} mean=${summary.mean.toFixed(2).padStart(6)} ms  p50=${summary.p50.toFixed(2).padStart(6)} ms  p95=${summary.p95.toFixed(2).padStart(6)} ms  html=${String(summary.bytes).padStart(6)} B${suffix}`,
  )

const databaseUrl = process.env.KET_BENCH_PG?.trim()
const onlyScreen = process.env.KET_BENCH_SCREEN?.trim()
const e2e = await collaborationEvidenceApp(databaseUrl ? { databaseUrl } : {})
try {
  await e2e.client.login({ login: 'admin', password: 'correct horse' })
  const screens = [
    {
      label: 'Product collaboration',
      path: '/admin/products/tpl-collab?lang=vi',
      markers: ['mail.chatter', 'activity.record'],
    },
    {
      label: 'Product variant',
      path: '/admin/products/tpl-collab/variants/variant-collab?lang=vi',
      markers: ['mail.chatter', 'activity.record', 'product-variant-form'],
    },
    {
      label: 'Product attributes',
      path: '/admin/product-attributes?lang=vi',
      markers: ['product-attribute-create', 'product-attribute-value'],
    },
    {
      label: 'Product create',
      path: '/admin/products/new?lang=vi',
      markers: ['product-create-form', 'product-create'],
    },
    {
      label: 'Transfer collaboration',
      path: '/admin/transfers/pick-collab?lang=vi',
      markers: ['mail.chatter', 'activity.record', 'record-workspace', 'stock.editor'],
    },
    {
      label: 'Inventory adjustment',
      path: '/admin/inventory?lang=vi',
      markers: ['inventory-adjustment-form', 'record-workspace', 'Tồn kho hiện tại'],
    },
    {
      label: 'Transfer list',
      path: '/admin/transfers?lang=vi',
      markers: ['transfer-create-form', 'record-workspace', 'Phiếu chuyển kho'],
    },
    {
      label: 'Warehouse list',
      path: '/admin/warehouses?lang=vi',
      markers: ['warehouse-create-form', 'record-workspace', 'Kho đã cấu hình'],
    },
    {
      label: 'Location list',
      path: '/admin/locations?lang=vi',
      markers: ['location-create-form', 'record-workspace', 'Cây vị trí'],
    },
    {
      label: 'Operation type list',
      path: '/admin/picking-types?lang=vi',
      markers: ['picking-type-create-form', 'record-workspace', 'Loại hoạt động đã cấu hình'],
    },
    {
      label: 'Route list',
      path: '/admin/stock-routes?lang=vi',
      markers: ['stock-route-create-form', 'record-workspace', 'Tuyến cung ứng đã cấu hình'],
    },
    {
      label: 'Route detail',
      path: '/admin/stock-routes/wh:receipt-route?lang=vi',
      markers: ['stock-route-detail-form', 'stock-route-rule-form', 'record-workspace'],
    },
    {
      label: 'Replenishment',
      path: '/admin/replenishment?lang=vi',
      markers: ['replenishment-create-form', 'record-workspace', 'Đề xuất bổ sung'],
    },
    {
      label: 'Forecast',
      path: '/admin/forecast?productId=variant-collab&warehouseId=wh&locationId=wh:stock&lang=vi',
      markers: ['forecast-filter-form', 'record-workspace', 'Khả năng đáp ứng'],
    },
    {
      label: 'Quotation list',
      path: '/admin/sales/quotations?lang=vi',
      markers: ['quotation-create-form', 'record-workspace', 'Báo giá hiện có'],
    },
    {
      label: 'Sales order detail',
      path: '/admin/sales/quotations/quotation-collab?lang=vi',
      markers: ['sale-order-line-form', 'sale.editor', 'mail.chatter', 'activity.record'],
    },
    {
      label: 'Sales order list',
      path: '/admin/sales/orders?lang=vi',
      markers: ['record-workspace', 'Đơn bán đã xác nhận', 'sales-order-collab'],
    },
    {
      label: 'Sales invoicing policy',
      path: '/admin/sales/invoicing-policies?lang=vi',
      markers: ['record-workspace', 'invoicing-policy-form', 'Chính sách theo sản phẩm'],
    },
    {
      label: 'Accounting customer invoice',
      path: '/admin/customer-invoices/invoice-collab?lang=vi',
      markers: ['record-workspace', 'mail.chatter', 'activity.record'],
    },
    {
      label: 'Accounting vendor bills',
      path: '/admin/vendor-bills?lang=vi',
      markers: ['record-workspace', 'vendor-bill-create-form', 'vendor-bill-collab'],
    },
    {
      label: 'Accounting journal entries',
      path: '/admin/journal-entries?lang=vi',
      markers: ['record-workspace', 'journal-entry-create-form', 'journal-entry-collab'],
    },
    {
      label: 'Accounting payments',
      path: '/admin/payments?lang=vi',
      markers: ['record-workspace', 'payment-register-form', 'payment-collab'],
    },
    {
      label: 'Accounting chart of accounts',
      path: '/admin/accounts?lang=vi',
      markers: ['record-workspace', 'account-create-form', 'account-receivable-collab'],
    },
    {
      label: 'Lot list',
      path: '/admin/lots?lang=vi',
      markers: ['lot-create-form', 'record-workspace', 'Lô và số sê-ri đã cấu hình'],
    },
    {
      label: 'Lot collaboration',
      path: '/admin/lots/lot-collab?lang=vi',
      markers: ['lot-detail-form', 'mail.chatter', 'activity.record', 'record-workspace'],
    },
    {
      label: 'My activities',
      path: '/admin/activities?lang=vi&today=2026-08-20',
      markers: ['Hoạt động của tôi'],
    },
    { label: 'Calendar agenda', path: '/admin/calendar?lang=vi&view=agenda', markers: ['calendar.board'] },
    {
      label: 'Calendar week',
      path: '/admin/calendar?lang=vi&view=week',
      markers: ['calendar.board', '&quot;view&quot;:&quot;week&quot;'],
    },
    {
      label: 'Calendar month',
      path: '/admin/calendar?lang=vi&view=month',
      markers: ['calendar.board', '&quot;view&quot;:&quot;month&quot;'],
    },
    { label: 'Notification inbox', path: '/admin/inbox?lang=vi', markers: ['Hộp thư thông báo'] },
    {
      label: 'Transactional outbox',
      path: '/admin/outbox?lang=vi',
      markers: ['Hộp thư đi', 'Gửi lỗi', 'Đã gửi'],
    },
    {
      label: 'Inbound email log',
      path: '/admin/inbound-email?lang=vi',
      markers: ['Nhật ký email đến', 'Đã xử lý', 'Không định tuyến được', 'Đã bỏ qua'],
    },
  ].filter((screen) => !onlyScreen || screen.label === onlyScreen)
  assert.ok(screens.length > 0, `unknown collaboration benchmark screen: ${String(onlyScreen)}`)
  console.log('collaboration screen HTTP benchmark (30 interleaved warm renders per response mode)')
  for (const screen of screens) {
    await e2e.client.get(screen.path)
    await e2e.client.get(screen.path, { headers: { 'x-ket-navigation': 'fragment-v1' } })
    const full: Sample[] = []
    const fragment: Sample[] = []
    const variants: Array<{
      label: 'full' | 'fragment'
      headers: Record<string, string>
      samples: Sample[]
    }> = [
      { label: 'full', headers: { accept: 'text/html' }, samples: full },
      {
        label: 'fragment',
        headers: { 'x-ket-navigation': 'fragment-v1' },
        samples: fragment,
      },
    ]
    for (let index = 0; index < 30; index++) {
      const ordered = index % 2 === 0 ? variants : [...variants].reverse()
      for (const variant of ordered) {
        const started = performance.now()
        const response = await e2e.client.get(screen.path, { headers: variant.headers })
        const body = await response.text()
        variant.samples.push({ elapsed: performance.now() - started, bytes: Buffer.byteLength(body) })
        assert.equal(response.status, 200, `${screen.label} ${variant.label}: ${body}`)
        if (variant.label === 'fragment') {
          assert.match(response.headers.get('content-type') ?? '', /^text\/vnd\.ket\.fragments\+html/)
          assert.match(body, /^<ket-fragments /)
        }
        for (const marker of screen.markers)
          assert.ok(body.includes(marker), `${screen.label} ${variant.label} omitted ${marker}`)
      }
    }
    const fullSummary = summarize(full)
    const fragmentSummary = summarize(fragment)
    console.log(screen.label)
    report('full', fullSummary)
    report(
      'fragment',
      fragmentSummary,
      `  delta mean=${delta(fullSummary.mean, fragmentSummary.mean)} p50=${delta(fullSummary.p50, fragmentSummary.p50)} bytes=${delta(fullSummary.bytes, fragmentSummary.bytes)}`,
    )
  }
} finally {
  await e2e.close()
}
