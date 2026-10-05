import { Badge, createKetTableView, Inline, MediaLabel, Text } from '@ketvietlab/design-system'
import type { KetTableGroup, KetTableConfig } from '@ketvietlab/design-system'
import type { IslandController, IslandProps } from '@ketvietlab/ketjs-view'

// A thin, shared registration point — not a reimplementation like
// `relation-select-view.tsx` — so a screen that ever needs a `custom` cell
// kind has one place to add it, registered identically for the server-side
// `view:` in `backend/islands.ts` and this same file's client bundle entry
// in `tools/build-backend-client.mjs`. Media and text use public DS primitives.
export const ketTable = (props: IslandProps): IslandController =>
  createKetTableView(props as never, {
    'thumbnail-label': (value, row, options) => {
      const image = row[String(options?.imageField ?? 'image')] as { src?: string } | null
      const config = props.config as KetTableConfig
      const collect = (groups: KetTableGroup[]): Record<string, unknown>[] =>
        groups.flatMap((group) => [...(group.rows ?? []), ...collect(group.children ?? [])])
      const rows = [...(config.rows ?? []), ...collect(config.groups ?? [])]
      const reserveImage = rows.some((entry) =>
        Boolean((entry[String(options?.imageField ?? 'image')] as { src?: string } | null)?.src),
      )
      return <MediaLabel label={String(value ?? '')} src={image?.src} reserveImage={reserveImage} />
    },
    // A classification in words. `status` draws a badge, which is for states
    // and exceptions; a value most rows share would repeat the same pill down
    // the column and stop the colour meaning anything.
    label: (value, _row, options) => {
      const labels = (options?.labels ?? {}) as Record<string, string>
      const key = String(value ?? '')
      const muted = Array.isArray(options?.mutedValues) && options.mutedValues.includes(key)
      return <Text tone={muted ? 'muted' : 'default'}>{labels[key] ?? key}</Text>
    },
    // A name with the one exception worth seeing on its row, such as authority
    // that answers to nothing else. Most rows carry no flag and show the name alone.
    flagged: (value, row, options) => {
      const name = <Text>{String(value ?? '')}</Text>
      if (!row[String(options?.flag ?? 'flag')]) return name
      const tone = (options?.tone ?? 'warning') as 'warning'
      return (
        <Inline
          gap="tight"
          blockAlign="center"
          items={[name, <Badge label={String(options?.label ?? '')} tone={tone} />]}
        />
      )
    },
  })
