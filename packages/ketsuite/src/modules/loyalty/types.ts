export const PROGRAM_TYPES = [
  'coupons',
  'gift_card',
  'loyalty',
  'promotion',
  'ewallet',
  'promo_code',
  'buy_x_get_y',
  'next_order_coupons',
] as const

export const PROGRAM_APPLIES_ON = ['current', 'future', 'both'] as const
export const PROGRAM_TRIGGERS = ['auto', 'with_code'] as const
export const LOYALTY_CHANNELS = ['sale', 'pos'] as const
export const POINT_MODES = ['order', 'money', 'unit'] as const
export const TAX_MODES = ['incl', 'excl'] as const
export const REWARD_TYPES = ['discount', 'product', 'shipping'] as const
export const DISCOUNT_MODES = ['percent', 'per_point', 'per_order'] as const
export const DISCOUNT_APPLICABILITY = ['order', 'cheapest', 'specific'] as const
export const WALLET_UNITS = ['points', 'currency'] as const
export const LEDGER_OPERATIONS = ['earn', 'redeem', 'adjust', 'expire', 'reverse'] as const
export const APPLICATION_STATES = ['draft', 'reserved', 'finalized', 'reversed'] as const
export const RESERVATION_STATES = ['reserved', 'finalized', 'released'] as const

export type ProgramType = (typeof PROGRAM_TYPES)[number]
export type ProgramAppliesOn = (typeof PROGRAM_APPLIES_ON)[number]
export type ProgramTrigger = (typeof PROGRAM_TRIGGERS)[number]
export type LoyaltyChannel = (typeof LOYALTY_CHANNELS)[number]
export type PointMode = (typeof POINT_MODES)[number]
export type TaxMode = (typeof TAX_MODES)[number]
export type RewardType = (typeof REWARD_TYPES)[number]
export type DiscountMode = (typeof DISCOUNT_MODES)[number]
export type DiscountApplicability = (typeof DISCOUNT_APPLICABILITY)[number]
export type WalletUnit = (typeof WALLET_UNITS)[number]
export type LedgerOperation = (typeof LEDGER_OPERATIONS)[number]

export type OrderLineSnapshot = {
  id: string
  productId: string
  quantity: number
  /** Canonical decimal money text; never a binary JavaScript number. */
  untaxed: string
  /** Canonical decimal money text; never a binary JavaScript number. */
  total: string
  lineKind?: 'product' | 'shipping' | 'reward'
}

export type OrderSnapshot = {
  orderType: LoyaltyChannel
  orderId: string
  partnerId?: string | null
  currency: string
  pricelistId?: string | null
  date: string
  lines: OrderLineSnapshot[]
  codes?: string[]
}

export type RewardQuote = {
  rewardId: string
  programId: string
  description: string
  rewardType: RewardType
  requiredPoints: number
  discountAmount: string
  productId?: string | null
  productQuantity?: number
  lineKind: 'reward'
}

export type EligibilityResult = {
  programId: string
  programName: string
  programType: ProgramType
  points: number
  splitPoints: number[]
  rewards: RewardQuote[]
}

export type WalletSummary = {
  id: string
  programId: string
  partnerId?: string | null
  code: string
  unit: WalletUnit
  balance: number
  reserved: number
  available: number
  expiresAt?: string | null
  active: boolean
}

export type MembershipSummary = {
  partnerId: string
  tierId?: string | null
  tierCode?: string | null
  rollingSpend: number
  redeemPercent: number
  points: number
  refreshedAt: string
}
