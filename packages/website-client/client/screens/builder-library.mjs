import { html } from '@ketvietlab/ketjs-view'
import { EmptyState, IconButton, SearchField, Section, Stack } from '@ketvietlab/design-system'
import { h, commandValue, icon } from '../ui.mjs'
import { walkLayout } from '../renderer.mjs'

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

const DESCRIPTION_KEYS = {
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

const folded = (value) =>
  String(value)
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[đĐ]/gu, 'd')
    .toLocaleLowerCase('vi')

const sectionName = (placement, sections) =>
  String(placement?.settings?.heading || sections[placement?.type]?.title || '')

const placementById = (layout, id) => {
  let found = null
  walkLayout(layout, (placement) => {
    if (placement.id === id) found = placement
  })
  return found
}

export function insertionTarget(layout, sections, selectedNode, tr) {
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

const matchingGroups = (sections, search, tr) => {
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

export function blockPicker({ sections, layout, selectedNode, search, onSearch, tr, disabled }) {
  const target = insertionTarget(layout, sections, selectedNode, tr)
  const groups = matchingGroups(sections, search, tr)
  return h(Stack, {
    items: [
      html`<p class="website-block-picker-target"><span>${target.prefix}</span><strong title=${target.label}>${target.label}</strong></p>`,
      html`<div class="website-block-picker-search" on:input=${(event) => {
        if (event.target?.name === 'q') onSearch(String(event.target.value ?? ''))
      }}>${h(SearchField, {
        id: 'library-search',
        name: 'q',
        label: tr('website.builder.library.search'),
        placeholder: tr('website.builder.library.searchHint'),
        value: search,
        autocomplete: 'off',
      })}</div>`,
      groups.length
        ? h(Stack, {
            gap: 'compact',
            items: groups.map((group) =>
              h(Section, {
                title: group.title,
                body: h(Stack, {
                  gap: 'compact',
                  divided: true,
                  items: group.sections.map(
                    (section) =>
                      html`<div class="website-block-picker-item"><div class="website-block-picker-copy"><strong>${section.title}</strong>${section.description ? html`<small>${section.description}</small>` : null}</div>${h(
                        IconButton,
                        {
                          label: tr('website.builder.library.add', { name: section.title }),
                          icon: icon('plus'),
                          name: 'command',
                          value: commandValue('builder.add', { type: section.type }),
                          size: 'prominent',
                          disabled,
                        },
                      )}</div>`,
                  ),
                }),
              }),
            ),
          })
        : h(EmptyState, {
            title: tr('website.builder.library.empty'),
            message: tr('website.builder.library.emptyHelp'),
          }),
    ],
  })
}
