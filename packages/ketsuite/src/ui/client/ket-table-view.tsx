import { createKetTableView } from '@ketvietlab/design-system'
import type { IslandController, IslandProps } from '@ketvietlab/ketjs-view'

// A thin, shared registration point — not a reimplementation like
// `relation-select-view.tsx` — so a screen that ever needs a `custom` cell
// kind has one place to add it, registered identically for the server-side
// `view:` in `backend/islands.ts` and this same file's client bundle entry
// in `tools/build-backend-client.mjs`. No screen needs one yet.
export const ketTable = (props: IslandProps): IslandController => createKetTableView(props as never, {})
