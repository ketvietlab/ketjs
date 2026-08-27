import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Translator } from '@ketvietlab/ketjs'
import { renderToString } from '@ketvietlab/ketjs-view'
import { accountingOverviewScreen } from '../packages/ketsuite/src/modules/account_backend/screens/overview.tsx'

const messages: Record<string, string> = {
  'account_backend.action.calculate': 'Tính toán',
  'account_backend.dashboard.kicker': 'Không gian tài chính',
  'account_backend.field.balance': 'Số dư',
  'account_backend.overview.assets': 'Tổng tài sản',
  'account_backend.overview.byYear': 'Theo năm',
  'account_backend.overview.cash': 'Tiền và tương đương tiền',
  'account_backend.overview.cashFlow': 'Dòng tiền',
  'account_backend.overview.cashFlowHint': 'Tiền thực tế đi qua tài khoản tiền mặt và ngân hàng.',
  'account_backend.overview.cashNet': 'Lưu chuyển tiền thuần',
  'account_backend.overview.cashOperating': 'Tiền chi phí hoạt động',
  'account_backend.overview.cashOther': 'Tiền thu chi khác',
  'account_backend.overview.cashPurchases': 'Tiền chi cho mua hàng',
  'account_backend.overview.cashSales': 'Tiền thu từ bán hàng',
  'account_backend.overview.custom': 'Thu hẹp trong năm',
  'account_backend.overview.expenses': 'Chi phí theo tài khoản',
  'account_backend.overview.grossMargin': 'Tỷ lệ lợi nhuận gộp',
  'account_backend.overview.headline': 'Chỉ số chính',
  'account_backend.overview.headlineHint': 'So với kỳ liền trước cùng độ dài.',
  'account_backend.overview.lastPeriod': 'Kỳ trước',
  'account_backend.overview.liabilities': 'Tổng nợ phải trả',
  'account_backend.overview.mix': 'Cơ cấu doanh thu',
  'account_backend.overview.movement': 'Khoản mục',
  'account_backend.overview.noComparison': 'chưa có kỳ so sánh',
  'account_backend.overview.noExpense': 'Kỳ này chưa có chi phí ghi sổ.',
  'account_backend.overview.noPayable': 'Không còn khoản phải trả nào đang mở.',
  'account_backend.overview.noReceivable': 'Không còn khoản phải thu nào đang mở.',
  'account_backend.overview.noRevenue': 'Kỳ này chưa có doanh thu ghi sổ.',
  'account_backend.overview.notYetDue': 'Trong hạn',
  'account_backend.overview.outstanding': 'Còn phải thanh toán',
  'account_backend.overview.overdue': 'Quá hạn',
  'account_backend.overview.partner': 'Đối tác',
  'account_backend.overview.payable': 'Công nợ phải trả',
  'account_backend.overview.period': 'Kỳ báo cáo',
  'account_backend.overview.periodHint': 'Chọn một khoảng báo cáo.',
  'account_backend.overview.preset.last30': '30 ngày qua',
  'account_backend.overview.preset.last7': '7 ngày qua',
  'account_backend.overview.preset.last90': '90 ngày qua',
  'account_backend.overview.preset.lastMonth': 'Tháng trước',
  'account_backend.overview.preset.month': 'Tháng này',
  'account_backend.overview.preset.today': 'Hôm nay',
  'account_backend.overview.preset.yesterday': 'Hôm qua',
  'account_backend.overview.preset.last14': '14 ngày qua',
  'account_backend.overview.previous': 'kỳ trước',
  'account_backend.overview.profit': 'Lợi nhuận trước thuế',
  'account_backend.overview.receivable': 'Công nợ phải thu',
  'account_backend.overview.revenue': 'Doanh thu thuần',
  'account_backend.overview.revenueTrend': 'Doanh thu theo thời gian',
  'account_backend.overview.revenueTrendHint': 'Mỗi điểm là doanh thu phát sinh trong khoảng đó.',
  'account_backend.overview.subtitle': 'Kết quả lấy thẳng từ sổ đã ghi.',
  'account_backend.overview.title': 'Tổng quan kế toán',
  'account_backend.overview.totalExpense': 'Tổng chi phí',
  'account_backend.overview.versusPrevious': 'so với kỳ trước',
}

const translate = ((key: string) => messages[key] ?? key) as Translator
translate.locale = 'vi'
translate.has = (key) => key in messages
translate.resolves = translate.has

const options = {
  frame: {},
  action: '/admin/accounting',
  preset: '2026',
  years: [2026, 2025],
  presetHref: (name: string) => `/admin/accounting?period=${name}&lang=vi`,
  hidden: { lang: 'vi' },
  fields: [
    { name: 'dateFrom', label: 'Từ ngày', value: '2026-01-01' },
    { name: 'dateTo', label: 'Đến ngày', value: '2026-12-31' },
  ] as const,
  current: {
    revenue: 2_000_000,
    profit: 600_000,
    expense: 1_400_000,
    grossMargin: 0.3,
    expenseByAccount: [{ accountId: '642', code: '642', name: 'Chi phí quản lý', amount: 1_400_000 }],
  },
  previous: { revenue: 1_500_000, profit: 400_000, grossMargin: 0.25 },
  position: { cash: 800_000, assets: 3_000_000, liabilities: 400_000 },
  opening: { cash: 500_000, assets: 2_400_000, liabilities: 500_000 },
  openItems: {
    receivable: {
      total: 900_000,
      current: 600_000,
      overdue: 300_000,
      partners: [{ partnerId: 'customer-1', name: 'Khách hàng An', total: 900_000, overdue: 300_000 }],
    },
    payable: { total: 0, current: 0, overdue: 0, partners: [] },
  },
  cashFlow: { sales: 1_200_000, purchases: -400_000, operating: -200_000, other: 50_000, net: 650_000 },
  revenue: {
    plot: <span data-island="backend.chart">Biểu đồ doanh thu</span>,
    keys: [{ id: 'current', label: 'Kỳ này', series: 1 as const, value: '2.000.000 ₫' }],
  },
  mix: {
    plot: <span data-island="backend.chart">Cơ cấu doanh thu</span>,
    keys: [{ id: 'sales', label: 'Doanh thu bán hàng', series: 1 as const, value: '2.000.000 ₫' }],
  },
  currency: 'VND',
  standard: 'TT99/2025',
  ledgerHref: (accountId: string) => `/admin/accounting/general-ledger?accountId=${accountId}&lang=vi`,
  partnerHref: (partnerId: string) =>
    `/admin/accounting/partner-statement?partnerId=${partnerId}&dateFrom=2026-01-01&dateTo=2026-12-31&lang=vi`,
}

test('accounting overview stays specialized: preserves period, ledger KPIs, drill-downs and cash queues', () => {
  const html = renderToString(accountingOverviewScreen(translate, options))

  assert.match(html, /data-ui="record-workspace"/)
  assert.doesNotMatch(html, /data-ui="list-page"|data-ui="form-page"/)
  assert.match(html, /Không gian tài chính[\s\S]*?Tổng quan kế toán[\s\S]*?TT99\/2025/)
  assert.match(html, /href="\/admin\/accounting\?period=2026&amp;lang=vi"[^>]*aria-current="page"/)
  assert.match(html, /data-ui="date-picker" method="get" action="\/admin\/accounting"/)
  assert.match(html, /name="lang" value="vi"/)
  assert.match(html, /name="dateFrom"[^>]*value="2026-01-01"/)
  assert.match(html, /name="dateTo"[^>]*value="2026-12-31"/)
  assert.match(html, /Doanh thu thuần[\s\S]*?2\.000\.000/)
  assert.match(html, /Lợi nhuận trước thuế[\s\S]*?600\.000/)
  assert.match(html, /Tổng nợ phải trả[\s\S]*?400\.000/)
  assert.match(html, /data-ui="delta" data-direction="down" data-sentiment="good"/)
  assert.match(html, /data-ui="chart" data-kind="line"[\s\S]*?Biểu đồ doanh thu/)
  assert.match(html, /data-ui="chart" data-kind="doughnut"[\s\S]*?Cơ cấu doanh thu/)
  assert.match(html, /href="\/admin\/accounting\/general-ledger\?accountId=642&amp;lang=vi"/)
  assert.match(
    html,
    /href="\/admin\/accounting\/partner-statement\?partnerId=customer-1&amp;dateFrom=2026-01-01&amp;dateTo=2026-12-31&amp;lang=vi"/,
  )
  assert.match(html, /Khách hàng An[\s\S]*?900\.000[\s\S]*?300\.000/)
  assert.match(html, /Không còn khoản phải trả nào đang mở/)
  assert.match(html, /Lưu chuyển tiền thuần[\s\S]*?650\.000/)
  assert.doesNotMatch(html, /mail\.chatter|data-ui="record-aside"/)
})

test('accounting overview preserves analytical empty states and hides custom dates for a relative period', () => {
  const html = renderToString(
    accountingOverviewScreen(translate, {
      ...options,
      preset: 'last30',
      current: { revenue: 0, profit: 0, expense: 0, grossMargin: null, expenseByAccount: [] },
      previous: { revenue: 0, profit: 0, grossMargin: null },
      openItems: {
        receivable: { total: 0, current: 0, overdue: 0, partners: [] },
        payable: { total: 0, current: 0, overdue: 0, partners: [] },
      },
      revenue: { plot: null, keys: [] },
      mix: { plot: null, keys: [] },
    }),
  )

  assert.doesNotMatch(html, /data-ui="date-picker"/)
  assert.match(html, /Kỳ này chưa có doanh thu ghi sổ/)
  assert.match(html, /Kỳ này chưa có chi phí ghi sổ/)
  assert.match(html, /Không còn khoản phải thu nào đang mở/)
  assert.match(html, /Không còn khoản phải trả nào đang mở/)
  assert.doesNotMatch(html, /mail\.chatter/)
})
