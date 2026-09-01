import type { JSXChild, TemplateResult } from '@ketvietlab/ketjs-view'
import type { MenuNode, Translator } from '@ketvietlab/ketjs'
import {
  badge,
  bulkActions,
  code,
  dataTable,
  emptyState,
  formatMoney,
  icon,
  inline,
  KanbanCard,
  KanbanGrid,
  LinkButton,
  ListPage,
  listChrome,
  shell,
  thumbnail,
} from '../../../ui/index.ts'
import type { Column, DataTable, Frame } from '../../../ui/index.ts'
import { localized } from '../../backend/screen.ts'

export type TemplateRow = {
  id: string
  name: string
  type: string
  categoryId: string | null
  uomId: string | null
  listPrice: number
  isStorable?: boolean | null
  variants: number
  /**
   * The unit and the category as the reader knows them.
   *
   * The ids stay on the row because a filter and a link both travel on them, but
   * a catalogue that prints `workwear` where it means "Đồng phục vận hành" is
   * showing its own plumbing. Absent names fall back to the id rather than to a
   * dash: an unresolved reference is worth seeing.
   */
  uomName?: string | null
  categoryName?: string | null
  /** The primary image, when the product has one. */
  image?: { src: string; alt: string } | null
}

/** The two ways to look at the same rows. More can be added; each is a real page. */
export const VIEWS = ['list', 'kanban'] as const
export type View = (typeof VIEWS)[number]

export const PRODUCT_DETAIL_TABS = ['general', 'variants', 'media'] as const
export type ProductDetailTab = (typeof PRODUCT_DETAIL_TABS)[number]

export const VARIANT_DETAIL_TABS = ['general', 'media'] as const
export type VariantDetailTab = (typeof VARIANT_DETAIL_TABS)[number]

/**
 * The catalogue's columns, as data — so a module that adds a field to
 * `product.Template` has something to name when it wants a column for it.
 *
 * Goods and services are not a good/bad axis, so neither gets a judgemental tone.
 * The id is off by default: useful to a specialist, noise to everyone else.
 */
export const templateColumns = (_: Translator): Array<Column<TemplateRow>> => [
  {
    key: 'name',
    label: _('product_backend.col.name'),
    // The catalogue is looked at as much as it is read, and a thumbnail is the
    // fastest way to tell two similar names apart. The placeholder keeps the
    // identity's width steady so rows do not jog as images come and go. Keeping
    // image and name together also leaves one obvious first link for the record.
    cell: (r) =>
      inline([
        r.image ? thumbnail({ src: r.image.src, alt: '' }) : thumbnail({ fallback: icon('package') }),
        r.name,
      ]),
    priority: 'primary',
    width: 'wide',
  },
  {
    key: 'type',
    label: _('product_backend.col.type'),
    kind: 'status',
    priority: 'secondary',
    cell: (r) =>
      badge(_(`product_backend.type.${r.type}`), r.type === 'service' ? 'info' : 'neutral', r.type),
  },
  {
    key: 'category',
    label: _('product_backend.col.category'),
    cell: (r) => r.categoryName || r.categoryId || '—',
    priority: 'secondary',
  },
  {
    key: 'isStorable',
    label: _('product_backend.field.isStorable'),
    kind: 'status',
    priority: 'secondary',
    cell: (r) =>
      r.isStorable == null
        ? '—'
        : badge(
            _(r.isStorable ? 'product_backend.value.yes' : 'product_backend.value.no'),
            r.isStorable ? 'positive' : 'neutral',
          ),
  },
  {
    key: 'uom',
    label: _('product_backend.col.uom'),
    cell: (r) => r.uomName || r.uomId || '—',
  },
  {
    key: 'listPrice',
    label: _('product_backend.field.listPrice'),
    cell: (r) => formatMoney(_, r.listPrice),
    align: 'end',
    kind: 'currency',
  },
  {
    key: 'variants',
    label: _('product_backend.col.variants'),
    cell: (r) => String(r.variants),
    align: 'end',
    kind: 'number',
  },
  {
    key: 'id',
    label: _('backend.table.id'),
    cell: (r) => code(r.id, 'identifier'),
    kind: 'identifier',
    priority: 'tertiary',
    optional: true,
  },
]

const kanban = (_: Translator, rows: readonly TemplateRow[], locale: string): TemplateResult => (
  <KanbanGrid
    rows={rows}
    id={(r) => r.id}
    card={(r) => (
      <KanbanCard
        key={r.id}
        title={r.name}
        href={localized(`/admin/product/templates/${r.id}`, locale)}
        media={
          r.image
            ? thumbnail({ src: r.image.src, alt: r.image.alt, size: 'card' })
            : thumbnail({ fallback: icon('package'), size: 'card' })
        }
        meta={inline([
          badge(_(`product_backend.type.${r.type}`), r.type === 'service' ? 'info' : 'neutral', r.type),
          r.uomName || r.uomId || '',
        ])}
        note={`${_('product_backend.col.variants')}: ${String(r.variants)}`}
      />
    )}
  />
)

/**
 * The catalogue, in the frame the backend already owns.
 *
 * `ListPage` owns the reusable collection hierarchy while the backend frame keeps
 * the global sidebar and navigation slots. Search, grouping, paging and view
 * choice stay URL-driven through the existing chrome; list and kanban remain two
 * renderings of the same rows rather than two screens.
 */
export const productsScreen = (
  _: Translator,
  rows: TemplateRow[],
  view: View,
  frame: Frame = {},
  table: Partial<DataTable<TemplateRow>> = {},
  locale = '',
  total = rows.length,
  extensionActions?: JSXChild,
): TemplateResult =>
  shell(
    _,
    _('product_backend.screen.title'),
    <ListPage
      title={_('product_backend.screen.title')}
      description={_('product_backend.screen.description')}
      actions={
        frame.chrome?.create ||
        frame.chrome?.selection ||
        extensionActions !== undefined ||
        frame.extras?.['topbar.end'] !== undefined
          ? inline([
              frame.chrome?.create ? (
                <LinkButton
                  label={frame.chrome.create.label}
                  href={frame.chrome.create.path}
                  variant="primary"
                />
              ) : (
                ''
              ),
              frame.chrome?.selection ? bulkActions(_, frame.chrome.selection) : '',
              extensionActions ?? '',
              frame.extras?.['topbar.end'] ?? '',
            ])
          : undefined
      }
      controls={
        frame.chrome
          ? listChrome(
              _,
              _('product_backend.screen.title'),
              {
                ...frame.chrome,
                layout: 'command',
                section: undefined,
                create: null,
                selection: null,
              },
              false,
            )
          : undefined
      }
      status={_('product_backend.screen.results', { count: total })}
      body={
        rows.length === 0 && !table.groups?.length
          ? emptyState(_('product_backend.screen.empty.message'), _('product_backend.screen.empty.hint'))
          : view === 'kanban'
            ? kanban(_, rows, locale)
            : dataTable(_, {
                columns: templateColumns(_),
                rows,
                id: (r) => r.id,
                rowHref: (r) => localized(`/admin/product/templates/${r.id}`, locale),
                ...table,
              })
      }
    />,
    { ...frame, chrome: null, topbar: false },
  )

export type { MenuNode }
