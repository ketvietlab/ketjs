import { defineModule } from '@ketvietlab/ketjs'
import { functions } from './functions.ts'

export default defineModule({
  name: 'loyalty_sale',
  group: 'commerce',
  version: '0.1.0',
  depends: ['loyalty', 'sale'],
  install: 'auto',
  app: true,
  title: 'Loyalty trong bán hàng',
  summary: 'Áp ưu đãi, tích và đổi điểm trên báo giá và đơn bán.',
  category: 'Bán hàng',
  extend: {
    'sale.Order': {
      loyaltyState: 'text?',
      loyaltyPointsEarned: 'decimal?',
      loyaltyPointsSpent: 'decimal?',
    },
    'sale.OrderLine': {
      lineKind: 'text?',
      loyaltyApplicationId: 'ref:loyalty.Application?',
      loyaltyRewardId: 'ref:loyalty.Reward?',
      loyaltyPointsCost: 'decimal?',
    },
  },
  relations: {
    'sale.OrderLine': {
      loyaltyApplication: { belongsTo: 'loyalty.Application', by: 'loyaltyApplicationId' },
      loyaltyReward: { belongsTo: 'loyalty.Reward', by: 'loyaltyRewardId' },
    },
  },
  functions,
  messages: {
    vi: {
      'app.title': 'Loyalty trong bán hàng',
      'app.summary': 'Áp ưu đãi, tích và đổi điểm trên báo giá và đơn bán.',
      'app.category': 'Bán hàng',
    },
    en: {
      'app.title': 'Loyalty in Sales',
      'app.summary': 'Apply benefits, earn points, and redeem on quotations and sales orders.',
      'app.category': 'Sales',
    },
  },
})
