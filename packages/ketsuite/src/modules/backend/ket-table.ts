import type { Route, ServeContext } from '@ketvietlab/ketjs'
import type { JSXChild } from '@ketvietlab/ketjs-view'
import type { KetTableConfig } from '@ketvietlab/design-system'

export type {
  KetTableCellFormat,
  KetTableColumn,
  KetTableConfig,
  KetTableGroup,
  KetTableManager,
  KetTableSelection,
} from '@ketvietlab/design-system'

type Req = Parameters<Route>[1]

export const tableGrid = (
  ctx: ServeContext,
  url: URL,
  req: Req,
  id: string,
  config: KetTableConfig,
): Promise<JSXChild> => ctx.joint(url, req, 'backend:table.grid', { id, config })
