import { EmptyState, IconButton, SearchField, Section, Stack } from '@ketvietlab/design-system'
import { commandValue, icon } from '../ui.tsx'
import { walkLayout } from '../renderer.tsx'
import type { Placement, Translate } from '../types.ts'
import type { SectionCatalogue } from './builder-types.ts'

export type BlockPickerProps = {
  sections: SectionCatalogue
  layout: Placement[]
  selectedNode: string | null
  search: string
  onSearch: (value: string) => void
  tr: Translate
  disabled: boolean
}

const GROUPS = [
  {
    id: 'content',
    types: ['website.rich_text', 'website.callout', 'website.quote', 'website.faq', 'website_form.form'],
  },
  {
    id: 'media',
    types: ['website.hero', 'website.image', 'website.gallery', 'website.video'],
  },
  { id: 'layout', types: ['website.columns'] },
]

const DESCRIPTION_KEYS: Record<string, string> = {
  'website.hero': 'hero',
  'website.columns': 'columns',
  'website.rich_text': 'richText',
  'website.gallery': 'gallery',
  'website.image': 'image',
  'website.callout': 'callout',
  'website.quote': 'quote',
  'website.faq': 'faq',
  'website.video': 'video',
  'website_form.form': 'form',
}

const folded = (value: string) =>
  String(value)
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[đĐ]/gu, 'd')
    .toLocaleLowerCase('vi')

const sectionName = (placement: Placement | null, sections: SectionCatalogue) =>
  String(placement?.settings?.heading || sections[placement?.type as string]?.title || '')

const placementById = (layout: Placement[], id: string) => {
  let found: Placement | null = null
  walkLayout(layout, (placement) => {
    if (placement.id === id) found = placement
  })
  return found
}

export function insertionTarget(
  layout: Placement[],
  sections: SectionCatalogue,
  selectedNode: string | null,
  tr: Translate,
) {
  if (!selectedNode)
    return { prefix: tr('website.builder.library.at'), label: tr('website.builder.library.end') }
  const separator = selectedNode.lastIndexOf(':')
  if (separator > 0) {
    const parent = placementById(layout, selectedNode.slice(0, separator))
    const slot = selectedNode.slice(separator + 1)
    if (parent && ['left', 'right'].includes(slot))
      return {
        prefix: tr('website.builder.library.into'),
        label: `${sectionName(parent, sections)} · ${tr(`website.builder.slot${slot === 'left' ? 'Left' : 'Right'}`)}`,
      }
  }
  const selected = placementById(layout, selectedNode)
  return selected
    ? { prefix: tr('website.builder.library.after'), label: sectionName(selected, sections) }
    : { prefix: tr('website.builder.library.at'), label: tr('website.builder.library.end') }
}

const matchingGroups = (sections: SectionCatalogue, search: string, tr: Translate) => {
  const known = new Set(GROUPS.flatMap((group) => group.types))
  const groups = [...GROUPS, { id: 'other', types: Object.keys(sections).filter((type) => !known.has(type)) }]
  const terms = folded(search.trim()).match(/[\p{Letter}\p{Number}]+/gu) ?? []
  return groups
    .map((group) => ({
      id: group.id,
      title: tr(`website.builder.library.group.${group.id}`),
      sections: group.types
        .filter((type) => sections[type])
        .map((type) => ({
          type,
          title: sections[type].title,
          description: DESCRIPTION_KEYS[type]
            ? tr(`website.builder.library.description.${DESCRIPTION_KEYS[type]}`)
            : '',
        }))
        .filter((section) => {
          const words =
            folded(`${section.title} ${section.description}`).match(/[\p{Letter}\p{Number}]+/gu) ?? []
          return terms.every((term) => words.some((word) => word.startsWith(term)))
        }),
    }))
    .filter((group) => group.sections.length)
}

export function blockPicker({
  sections,
  layout,
  selectedNode,
  search,
  onSearch,
  tr,
  disabled,
}: BlockPickerProps) {
  const target = insertionTarget(layout, sections, selectedNode, tr)
  const groups = matchingGroups(sections, search, tr)
  return (
    <Stack
      items={[
        <p class="website-block-picker-target">
          <span>{target.prefix}</span>
          <strong title={target.label}>{target.label}</strong>
        </p>,
        <div
          class="website-block-picker-search"
          onInput={(event: Event) => {
            const input = event.target as HTMLInputElement | null
            if (input?.name === 'q') onSearch(String(input.value ?? ''))
          }}
        >
          <SearchField
            id="library-search"
            name="q"
            label={tr('website.builder.library.search')}
            placeholder={tr('website.builder.library.searchHint')}
            value={search}
            autocomplete="off"
          />
        </div>,
        groups.length ? (
          <Stack
            gap="compact"
            items={groups.map((group) => (
              <Section
                title={group.title}
                body={
                  <Stack
                    gap="compact"
                    divided
                    items={group.sections.map((section) => (
                      <div class="website-block-picker-item">
                        <div class="website-block-picker-copy">
                          <strong>{section.title}</strong>
                          {section.description ? <small>{section.description}</small> : null}
                        </div>
                        <IconButton
                          label={tr('website.builder.library.add', { name: section.title })}
                          icon={icon('plus')}
                          name="command"
                          value={commandValue('builder.add', { type: section.type })}
                          size="prominent"
                          disabled={disabled}
                        />
                      </div>
                    ))}
                  />
                }
              />
            ))}
          />
        ) : (
          <EmptyState
            title={tr('website.builder.library.empty')}
            message={tr('website.builder.library.emptyHelp')}
          />
        ),
      ]}
    />
  )
}
