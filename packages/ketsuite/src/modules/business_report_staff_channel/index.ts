import { defineModule } from '@ketvietlab/ketjs'
import { channelRoutes } from './channel-routes.ts'

export default defineModule({
  name: 'business_report_staff_channel',
  version: '0.1.0',
  depends: ['channel_api', 'company', 'partner', 'sale', 'account', 'stock'],
  compatible: { channel_api: '^1' },
  title: 'Business Report Staff Channel',
  summary: 'Cross-domain sales, accounting and warehouse KPIs for staff clients.',
  category: 'Reporting',
  routes: channelRoutes,
  messages: {
    vi: { 'app.title': 'Báo cáo kinh doanh', 'app.summary': 'Chỉ số bán hàng, kế toán và kho vận.' },
    en: { 'app.title': 'Business reports', 'app.summary': 'Sales, accounting and warehouse KPIs.' },
  },
})

export { channelRoutes }
