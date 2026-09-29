// Flow's translator with the product catalog registered. Import i18n from here, not from the kit.
import { registerFlowMessages } from '@ketvietlab/flow-ui/i18n'
import { flowClientMessages } from './messages.mjs'
registerFlowMessages(flowClientMessages)
export * from '@ketvietlab/flow-ui/i18n'
export { flowClientMessages } from './messages.mjs'
