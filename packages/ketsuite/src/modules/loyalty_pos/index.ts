import { defineModule } from '@ketvietlab/ketjs'
import { channelRoutes } from './channel.ts'
import { functions } from './functions.ts'
import { jobs } from './jobs.ts'

export default defineModule({
  name: 'loyalty_pos',
  version: '0.1.0',
  depends: ['loyalty', 'pos', 'product', 'partner', 'channel_api', 'pos_channel'],
  compatible: { channel_api: '^1' },
  title: 'Loyalty tại điểm bán',
  summary: 'Áp ưu đãi, tích và đổi điểm trên đơn POS.',
  category: 'Bán hàng',
  relations: {
    'pos.OrderLine': {
      loyaltyApplication: { belongsTo: 'loyalty.Application', by: 'loyaltyApplicationId' },
      loyaltyReward: { belongsTo: 'loyalty.Reward', by: 'loyaltyRewardId' },
    },
  },
  functions,
  jobs,
  routes: channelRoutes,
  messages: {
    vi: {
      'app.title': 'Loyalty tại điểm bán',
      'app.summary': 'Áp ưu đãi, tích và đổi điểm trên đơn POS.',
      'app.category': 'Bán hàng',
    },
    en: {
      'app.title': 'Loyalty at Point of Sale',
      'app.summary': 'Apply benefits, earn points, and redeem on POS orders.',
      'app.category': 'Sales',
    },
  },
})
