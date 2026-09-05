import { defineModule } from '@ketvietlab/ketjs'
import { adminFunctions } from './admin-functions.ts'
import { jobs, maintenanceFunctions } from './jobs.ts'
import { membershipFunctions } from './membership-functions.ts'
import { messages } from './messages.ts'
import { models } from './models.ts'
import { orderFunctions } from './order-functions.ts'
import { relations } from './relations.ts'
import { statsFunctions } from './stats.ts'
import { storedValueFunctions } from './stored-value.ts'

export default defineModule({
  name: 'loyalty',
  version: '0.1.0',
  depends: ['company', 'partner', 'product', 'pricing'],
  title: 'Khách hàng thân thiết',
  summary: 'Chương trình ưu đãi, ví điểm, hạng thành viên và lịch sử bất biến.',
  category: 'Bán hàng',
  models,
  relations,
  functions: {
    ...adminFunctions,
    ...orderFunctions,
    ...membershipFunctions,
    ...maintenanceFunctions,
    ...statsFunctions,
    ...storedValueFunctions,
  },
  jobs,
  messages,
})

export {
  APPLICATION_STATES,
  DISCOUNT_APPLICABILITY,
  DISCOUNT_MODES,
  LEDGER_OPERATIONS,
  LOYALTY_CHANNELS,
  POINT_MODES,
  PROGRAM_APPLIES_ON,
  PROGRAM_TRIGGERS,
  PROGRAM_TYPES,
  RESERVATION_STATES,
  REWARD_TYPES,
  TAX_MODES,
  WALLET_UNITS,
} from './types.ts'
export type {
  DiscountApplicability,
  DiscountMode,
  EligibilityResult,
  LedgerOperation,
  LoyaltyChannel,
  MembershipSummary,
  OrderLineSnapshot,
  OrderSnapshot,
  PointMode,
  ProgramAppliesOn,
  ProgramTrigger,
  ProgramType,
  RewardQuote,
  RewardType,
  TaxMode,
  WalletSummary,
  WalletUnit,
} from './types.ts'
