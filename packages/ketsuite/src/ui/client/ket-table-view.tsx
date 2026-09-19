import { createKetTableView } from '@ketvietlab/design-system'
import type { IslandController, IslandProps } from '@ketvietlab/ketjs-view'
import { inline, thumbnail } from '../primitives.tsx'
import { icon } from '../icons.ts'

// A thin, shared registration point — not a reimplementation like
// `relation-select-view.tsx` — so a screen that ever needs a `custom` cell
// kind has one place to add it, registered identically for the server-side
// `view:` in `backend/islands.ts` and this same file's client bundle entry
// in `tools/build-backend-client.mjs`. The thumbnail renderer uses the existing
// backend compatibility primitive until that media contract moves to the DS.
export const ketTable = (props: IslandProps): IslandController =>
  createKetTableView(props as never, {
    'thumbnail-label': (value, row, options) => {
      const image = row[String(options?.imageField ?? 'image')] as { src?: string } | null
      return inline([
        image?.src ? thumbnail({ src: image.src, alt: '' }) : thumbnail({ fallback: icon('package') }),
        String(value ?? ''),
      ])
    },
  })
