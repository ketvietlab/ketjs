import assert from 'node:assert/strict'
import { performance } from 'node:perf_hooks'
import { collaborationEvidenceApp } from '../tools/collaboration-evidence-fixture.ts'

type Sample = { elapsed: number; bytes: number }

const percentile = (values: number[], point: number): number => {
  const ordered = [...values].sort((a, b) => a - b)
  return ordered[Math.min(ordered.length - 1, Math.floor(ordered.length * point))] ?? 0
}

const e2e = await collaborationEvidenceApp()
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
      label: 'Transfer collaboration',
      path: '/admin/transfers/pick-collab?lang=vi',
      markers: ['mail.chatter', 'activity.record'],
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
  ]
  console.log('collaboration screen HTTP benchmark (30 warm authenticated renders)')
  for (const screen of screens) {
    await e2e.client.get(screen.path)
    const samples: Sample[] = []
    for (let index = 0; index < 30; index++) {
      const started = performance.now()
      const response = await e2e.client.get(screen.path, { headers: { accept: 'text/html' } })
      const body = await response.text()
      samples.push({ elapsed: performance.now() - started, bytes: Buffer.byteLength(body) })
      assert.equal(response.status, 200)
      for (const marker of screen.markers)
        assert.ok(body.includes(marker), `${screen.label} omitted ${marker}`)
    }
    const times = samples.map((sample) => sample.elapsed)
    const mean = times.reduce((sum, value) => sum + value, 0) / times.length
    const bytes = samples[0]?.bytes ?? 0
    console.log(
      `${screen.label.padEnd(24)} mean=${mean.toFixed(2).padStart(6)} ms  p50=${percentile(times, 0.5).toFixed(2).padStart(6)} ms  p95=${percentile(times, 0.95).toFixed(2).padStart(6)} ms  html=${String(bytes).padStart(6)} B`,
    )
  }
} finally {
  await e2e.close()
}
