import { defineModule } from '@ketvietlab/ketjs'
import { functions } from './functions.ts'
import { billingJobFunctions, billingJobs } from './jobs.ts'
import { menus } from './menus.ts'
import { messages } from './messages.ts'
import { models } from './models.ts'
import { routes } from './routes.ts'

export default defineModule({
  name: 'hospitality_billing',
  version: '0.1.0',
  // `backend` for the settings screen, and both sides of the seam this module
  // exists to close. It is optional on purpose: a property that bills outside
  // KetSuite installs hospitality_core without it.
  depends: ['backend', 'hospitality_core', 'account', 'partner', 'company', 'product'],
  title: 'Thanh toán khách sạn',
  summary: 'Xuất hoá đơn cho hồ sơ dịch vụ đã đóng và ghi nhận tiền khách đã trả.',
  category: 'Khách sạn',
  models,
  functions: { ...functions, ...billingJobFunctions },
  jobs: billingJobs,
  routes,
  menus,
  messages,
})
