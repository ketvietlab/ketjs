import { defineModule } from '@ketvietlab/ketjs'
import { channelRoutes } from './channel.ts'
import { functions } from './functions.ts'

export default defineModule({
  name: 'loyalty_pos',
  version: '0.1.0',
  depends: ['loyalty', 'pos', 'channel_api', 'pos_channel'],
  compatible: { channel_api: '^1' },
  title: 'Loyalty tại điểm bán',
  summary: 'Áp ưu đãi, tích và đổi điểm trên đơn POS.',
  category: 'Bán hàng',
  extend: {
    'pos.Order': {
      loyaltyState: 'text?',
      loyaltyPointsEarned: 'decimal?',
      loyaltyPointsSpent: 'decimal?',
    },
    'pos.OrderLine': {
      lineKind: 'text?',
      loyaltyApplicationId: 'ref:loyalty.Application?',
      loyaltyRewardId: 'ref:loyalty.Reward?',
      loyaltyPointsCost: 'decimal?',
    },
  },
  relations: {
    'pos.OrderLine': {
      loyaltyApplication: { belongsTo: 'loyalty.Application', by: 'loyaltyApplicationId' },
      loyaltyReward: { belongsTo: 'loyalty.Reward', by: 'loyaltyRewardId' },
    },
  },
  functions,
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
