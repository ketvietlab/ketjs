export const BOM_TYPES = ['normal', 'kit'] as const
export const PRODUCTION_STATES = [
  'draft',
  'confirmed',
  'in_progress',
  'to_close',
  'done',
  'cancelled',
] as const
export const WORK_ORDER_STATES = ['pending', 'ready', 'in_progress', 'paused', 'done', 'cancelled'] as const

export type BomType = (typeof BOM_TYPES)[number]
export type ProductionState = (typeof PRODUCTION_STATES)[number]
export type WorkOrderState = (typeof WORK_ORDER_STATES)[number]
