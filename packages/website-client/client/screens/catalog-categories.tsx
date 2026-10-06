import {
  ActionGroup,
  Button,
  Checkbox,
  ConfirmDialog,
  DataTable,
  EmptyState,
  Grid,
  Inline,
  LinkButton,
  ListPage,
  Menu,
  Notice,
  NumberField,
  RecordPage,
  SearchBar,
  Select,
  Stack,
  Status,
  Surface,
  Switch,
  Text,
  TextArea,
  TextField,
  TreeGrid,
  Section,
  WorkspacePage,
} from '@ketvietlab/design-system'
import type { TreeGridRow } from '@ketvietlab/design-system'
import { CommandButton, commandValue, icon } from '../ui.tsx'
import { createCatalogProductPicker } from './catalog-product-picker.tsx'
import { LiveDescription } from '../live-description.tsx'
import { AttachmentImage } from '../image-upload.tsx'
import { newId } from './format.ts'
import { safeImage } from '../renderer.tsx'
import type { CatalogProduct } from '../catalog-binding.ts'
import type { Screen, StudioContext } from '../types.ts'

type Category = {
  id: string
  title: string
  slug: string
  kind: 'category' | 'collection'
  parentId: string | null
  revisionId: string | null
  visible: boolean
  includeChildren: boolean
  position: number
  mode: 'manual' | 'rule'
  productIds: string[]
  excludeIds: string[]
  ruleGroup: string
  ruleType: string
  primarySort: string
  cover: string
  coverAlt: string
  thumbnail: string
  thumbnailAlt: string
  descriptionDoc: string
  canonical: string
  indexing: string
  description: string
  seoTitle: string
  seoDescription: string
  path: string
  count?: number
}
type ListedProduct = CatalogProduct & {
  visible?: boolean
  path: string
  bindingId: string
  brand?: string
  price?: number
}
type Detail = {
  category: Category
  parents: Category[]
  hasServices: boolean
  productTotal: number
  sourceGroups: string[]
  preview: ListedProduct[]
}
type Listing = { rows: Category[]; total: number }

/** Website merchandising owns membership and presentation; this screen never writes product master data. */
export function createCatalogCategoryScreens(ctx: StudioContext): Record<string, Screen> {
  const tr = ctx.tr,
    scope = () => ({ siteId: ctx.site().id }),
    writable = () => ctx.can('website.catalog.configure')
  const label = (key: string) => tr(`website.catalogCategory.${key}`)
  const listKey = (r: Category) => (r.kind === 'collection' ? 'catalog-collections' : 'catalog-categories')
  const recordKey = (kind: Category['kind']) =>
    kind === 'collection' ? 'catalog-collection-edit' : 'catalog-category-edit'
  const categoryHref = (id: string, kind: Category['kind'] = 'category') => ctx.href(recordKey(kind), { id })
  const badge = (r: Category) => (
    <Status
      label={tr(r.visible ? 'website.catalog.visible' : 'website.catalog.hidden')}
      tone={r.visible ? 'positive' : 'neutral'}
    />
  )
  const list = (kind: Category['kind']): Screen<Listing> => ({
    readKey: (route) => [route.query.q],
    read: (_route, signal) => ctx.call('website_catalog.listCategories', { ...scope(), kind }, { signal }),
    view: (data, route) => {
      const search = (route.query.q ?? '').toLocaleLowerCase('vi')
      const tree = (parentId: string | null, level = 1): TreeGridRow<Category>[] =>
        data.rows
          .filter((r) => r.parentId === parentId)
          .sort((a, b) => a.position - b.position || a.title.localeCompare(b.title, 'vi'))
          .flatMap((r) => {
            const children = tree(r.id, level + 1)
            if (search && !r.title.toLocaleLowerCase('vi').includes(search) && !children.length) return []
            return [{ row: r, level }, ...children]
          })
      const collections = data.rows.filter((r) => !search || r.title.toLocaleLowerCase('vi').includes(search))
      return (
        <ListPage
          variant="operational"
          title={label(kind === 'category' ? 'categories' : 'collections')}
          headerActions={
            writable() ? (
              <LinkButton
                label={label(kind === 'category' ? 'create' : 'createCollection')}
                href={ctx.href(recordKey(kind), { id: 'new' }, { kind })}
                variant="primary"
              />
            ) : null
          }
          controls={
            <SearchBar
              action={ctx.href(kind === 'category' ? 'catalog-categories' : 'catalog-collections')}
              name="q"
              value={route.query.q ?? ''}
              label={label(kind === 'category' ? 'searchCategories' : 'searchCollections')}
              submitLabel={tr('website.search.submit')}
            />
          }
          body={
            data.rows.length ? (
              kind === 'category' ? (
                <div class="website-category-tree-table">
                  <TreeGrid
                    label={label('categories')}
                    primaryLabel={label('name')}
                    rows={tree(null)}
                    id={(r) => r.id}
                    rowHref={(r) => categoryHref(r.id, r.kind)}
                    primary={(r) => r.title}
                    columns={[
                      {
                        key: 'state',
                        label: tr('website.entry.state'),
                        cell: badge,
                      },
                      {
                        key: 'count',
                        label: label('products'),
                        cell: (r) => String(r.count ?? 0),
                      },
                      {
                        key: 'path',
                        label: label('slug'),
                        cell: (r) => r.path,
                      },
                    ]}
                  />
                </div>
              ) : (
                <DataTable<Category>
                  responsive="stack"
                  rowHref={(r: Category) => categoryHref(r.id, r.kind)}
                  columns={[
                    {
                      key: 'title',
                      label: label('name'),
                      priority: 'primary',
                      cell: (r: Category) => r.title,
                    },
                    {
                      key: 'mode',
                      label: label('mode'),
                      cell: (r: Category) => label(r.mode),
                    },
                    {
                      key: 'count',
                      label: label('products'),
                      cell: (r: Category) => String(r.count ?? 0),
                    },
                    {
                      key: 'visible',
                      label: tr('website.entry.state'),
                      cell: badge,
                    },
                  ]}
                  rows={collections}
                  id={(r: Category) => r.id}
                />
              )
            ) : (
              <EmptyState title={label('empty')} message={label('emptyHelp')} />
            )
          }
          footer={tr('website.catalogCategory.count', { count: data.total })}
        />
      )
    },
  })
  let current: Detail | null = null
  let membership: ReturnType<typeof createCatalogProductPicker> | undefined
  const edit: Screen<Detail> = {
    dispose: () => membership?.dispose(),
    read: async (route, signal) => {
      current = await ctx.call<Detail>(
        'website_catalog.getCategory',
        { ...scope(), id: route.params.id, kind: route.query.kind },
        { signal },
      )
      if (route.params.id === 'new') current.category.id = newId('catalog-category')
      return current
    },
    view: (data) => {
      const r = data.category,
        creating = r.revisionId === null,
        collection = r.kind === 'collection'
      const field = { disabled: !writable() }
      membership?.dispose()
      membership = createCatalogProductPicker(ctx, {
        productIds: r.productIds,
        excludeIds: r.excludeIds,
        collection,
        groups: data.sourceGroups,
      })
      return (
        <RecordPage
          width="wide"
          title={creating ? label(collection ? 'createCollection' : 'create') : r.title}
          status={creating ? undefined : badge(r)}
          actions={
            <Inline
              align="end"
              items={[
                <ActionGroup
                  label={label(collection ? 'collectionActions' : 'recordActions')}
                  actions={[
                    <LinkButton
                      label={label('back')}
                      href={ctx.href(listKey(r))}
                      leading={icon('chevron-left')}
                      iconOnly
                    />,
                    creating ? null : (
                      <LinkButton
                        label={tr('website.catalog.preview')}
                        href={ctx.href(
                          r.kind === 'collection' ? 'catalog-collection-preview' : 'catalog-category-preview',
                          { id: r.id },
                        )}
                        leading={icon('search')}
                        iconOnly
                      />
                    ),
                    !creating && writable() ? (
                      <Menu
                        id="category-more"
                        label={tr('website.catalog.more')}
                        trigger="⋯"
                        align="end"
                        mobileAlign="end"
                        items={[
                          {
                            id: 'archive',
                            label: label(collection ? 'archiveCollection' : 'archive'),
                            href: ctx.href(
                              r.kind === 'collection'
                                ? 'catalog-collection-archive'
                                : 'catalog-category-archive',
                              { id: r.id },
                            ),
                            destructive: true,
                            leading: icon('trash-2'),
                          },
                        ]}
                      />
                    ) : null,
                  ]}
                />,
                <CommandButton
                  label={tr('website.catalog.saveExposure')}
                  command="catalogCategory.save"
                  type="submit"
                  form="catalog-category-record"
                  variant="primary"
                  disabled={!writable() || ctx.busy()}
                />,
              ]}
            />
          }
          body={
            <form id="catalog-category-record">
              <Stack
                items={[
                  <Surface
                    title={label('settings')}
                    body={
                      <Stack
                        items={[
                          <Grid
                            columns={2}
                            mobileColumns={1}
                            items={[
                              <TextField
                                id="category-title"
                                name="title"
                                label={label('name')}
                                value={r.title}
                                required
                                {...field}
                              />,
                              <TextField
                                id="category-slug"
                                name="slug"
                                label={label('slug')}
                                value={r.slug}
                                help={
                                  creating
                                    ? label(collection ? 'collectionPath' : 'categoryPath')
                                    : tr('website.catalogCategory.publicUrl', {
                                        url: `${ctx.site().host}${r.path}`,
                                      })
                                }
                                required
                                {...field}
                              />,
                              collection ? null : (
                                <Select
                                  id="category-parent"
                                  name="parentId"
                                  label={label('parent')}
                                  value={r.parentId ?? ''}
                                  options={[
                                    { value: '', label: label('root') },
                                    ...data.parents.map((p) => ({
                                      value: p.id,
                                      label: p.title,
                                    })),
                                  ]}
                                  {...field}
                                />
                              ),
                              <NumberField
                                id="category-position"
                                name="position"
                                label={label('position')}
                                min="0"
                                step="1"
                                value={String(r.position)}
                                {...field}
                              />,
                              <Switch
                                id="category-visible"
                                name="visible"
                                label={tr('website.catalog.exposure')}
                                checked={r.visible}
                                value="yes"
                                {...field}
                              />,
                              collection ? null : (
                                <Switch
                                  id="category-children"
                                  name="includeChildren"
                                  label={label('includeChildren')}
                                  checked={r.includeChildren}
                                  value="yes"
                                  {...field}
                                />
                              ),
                              <Select
                                id="category-sort"
                                name="primarySort"
                                label={label('sort')}
                                value={r.primarySort}
                                options={['manual', 'name', ...(data.hasServices ? [] : ['priceAsc'])].map(
                                  (value) => ({
                                    value,
                                    label: label(`sort.${value}`),
                                  }),
                                )}
                                {...field}
                              />,
                            ]}
                          />,
                        ]}
                      />
                    }
                  />,
                  <Surface
                    title={label('products')}
                    body={
                      <Stack
                        items={[
                          collection ? (
                            <Grid
                              columns={2}
                              mobileColumns={1}
                              items={[
                                <Select
                                  id="collection-mode"
                                  name="mode"
                                  label={label('mode')}
                                  value={r.mode}
                                  options={['manual', 'rule'].map((value) => ({
                                    value,
                                    label: label(value),
                                  }))}
                                  {...field}
                                />,
                                <Select
                                  id="collection-group"
                                  name="ruleGroup"
                                  label={label('ruleGroup')}
                                  value={r.ruleGroup}
                                  options={[
                                    { value: '', label: label('allGroups') },
                                    ...data.sourceGroups.map((value) => ({
                                      value,
                                      label: value,
                                    })),
                                  ]}
                                  {...field}
                                />,
                                <Select
                                  id="collection-type"
                                  name="ruleType"
                                  label={label('ruleType')}
                                  value={r.ruleType}
                                  options={[
                                    { value: '', label: label('allTypes') },
                                    ...['goods', 'service'].map((value) => ({
                                      value,
                                      label: tr(`website.catalog.${value}`),
                                    })),
                                  ]}
                                  {...field}
                                />,
                              ]}
                            />
                          ) : (
                            <input type="hidden" name="mode" value="manual" />
                          ),
                          <Notice
                            tone="info"
                            title={label(collection ? 'collectionRules' : 'membershipTitle')}
                            message={label(collection ? 'collectionRulesHelp' : 'membershipHelp')}
                          />,
                          membership.view(),
                        ]}
                      />
                    }
                  />,
                  <Surface
                    title={tr('website.taxonomy.description')}
                    body={
                      <LiveDescription
                        id={r.id}
                        revision={r.revisionId}
                        value={r.descriptionDoc}
                        text={r.description}
                        label={tr('website.taxonomy.description')}
                        readOnly={!writable()}
                        field
                      />
                    }
                  />,
                  <Surface
                    title={tr('website.taxonomy.images')}
                    description={tr('website.taxonomy.imagesHelp')}
                    body={
                      <Grid
                        columns={2}
                        mobileColumns={1}
                        items={(['thumbnail', 'cover'] as const).map((key) => (
                          <Section
                            title={tr(`website.taxonomy.${key}`)}
                            body={AttachmentImage(ctx, {
                              id: r.id,
                              field: key,
                              value: r[key],
                              alt: r[`${key}Alt`],
                              disabled: !writable(),
                              resModel: 'website_catalog.Category',
                            })}
                          />
                        ))}
                      />
                    }
                  />,
                  <Surface
                    title={tr('website.catalog.seo')}
                    body={
                      <Grid
                        columns={2}
                        mobileColumns={1}
                        items={[
                          <TextField
                            id="category-seo-title"
                            name="seoTitle"
                            label={tr('website.catalog.seoTitle')}
                            value={r.seoTitle}
                            placeholder={r.title}
                            {...field}
                          />,
                          <TextArea
                            id="category-seo-description"
                            name="seoDescription"
                            label={tr('website.catalog.seoDescription')}
                            value={r.seoDescription}
                            {...field}
                          />,
                          <TextField
                            id="category-canonical"
                            name="canonical"
                            label={tr('website.resource.seo.canonical')}
                            value={r.canonical}
                            placeholder={`https://${ctx.site().host}${r.path}`}
                            {...field}
                          />,
                          <Select
                            id="category-indexing"
                            name="indexing"
                            label={tr('website.taxonomy.indexing')}
                            value={r.indexing || 'index'}
                            options={[
                              {
                                value: 'index',
                                label: tr('website.taxonomy.index'),
                              },
                              {
                                value: 'noindex',
                                label: tr('website.taxonomy.noindex'),
                              },
                            ]}
                            {...field}
                          />,
                        ]}
                      />
                    }
                  />,
                  <Notice tone="info" title={tr('website.catalog.liveTitle')} message={label('liveHelp')} />,
                ]}
              />
            </form>
          }
        />
      )
    },
    commands: {
      'catalogCategory.save': async (_args, form) => {
        if (!current || !form || !writable()) return
        const r = current.category
        const selected = JSON.parse(String(form.get('productIdsJSON') || '[]')) as string[]
        const excluded = JSON.parse(String(form.get('excludeIdsJSON') || '[]')) as string[]
        const saved = await ctx.call<Category>('website_catalog.saveCategory', {
          ...scope(),
          id: r.id,
          kind: r.kind,
          expectedRevisionId: r.revisionId,
          title: String(form.get('title') ?? ''),
          slug: String(form.get('slug') ?? ''),
          parentId: String(form.get('parentId') ?? ''),
          position: String(form.get('position') ?? '0'),
          visible: form.get('visible') === 'yes',
          includeChildren: form.get('includeChildren') === 'yes',
          mode: String(form.get('mode') ?? 'manual'),
          ruleGroup: String(form.get('ruleGroup') ?? ''),
          ruleType: String(form.get('ruleType') ?? ''),
          primarySort: String(form.get('primarySort') ?? 'manual'),
          productIds: selected,
          excludeIds: excluded,
          ...Object.fromEntries(
            ['cover', 'coverAlt', 'thumbnail', 'thumbnailAlt', 'descriptionDoc', 'canonical', 'indexing'].map(
              (key) => [key, String(form.get(key) ?? '')],
            ),
          ),
          description: String(form.get('description') ?? ''),
          seoTitle: String(form.get('seoTitle') ?? ''),
          seoDescription: String(form.get('seoDescription') ?? ''),
        })
        ctx.notify(label(r.kind === 'collection' ? 'savedCollection' : 'saved'), 'positive')
        if (r.revisionId === null) await ctx.navigate(recordKey(r.kind), { id: saved.id })
        else await ctx.refresh()
      },
      'catalogCategory.archive': async (_args, form) => {
        if (!current || !form || !writable()) return
        await ctx.call('website_catalog.archiveCategory', {
          ...scope(),
          id: current.category.id,
          expectedRevisionId: current.category.revisionId,
          confirmed: form.get('confirmed') === 'yes',
        })
        ctx.notify(
          label(current.category.kind === 'collection' ? 'archivedCollection' : 'archived'),
          'positive',
        )
        await ctx.navigate(listKey(current.category))
      },
    },
  }
  const screens: Record<string, Screen> = {
    'catalog-categories': list('category'),
    'catalog-collections': list('collection'),
    'catalog-category-edit': edit,
    'catalog-category-archive': {
      read: edit.read,
      view: () => {
        const collection = current!.category.kind === 'collection'
        return (
          <ConfirmDialog
            id="category-archive-dialog"
            title={label(collection ? 'archiveCollection' : 'archive')}
            message={label(collection ? 'archiveCollectionHelp' : 'archiveHelp')}
            details={
              <form id="category-archive">
                <Checkbox
                  id="category-archive-confirm"
                  name="confirmed"
                  submitValue="yes"
                  label={label(collection ? 'archiveCollectionConfirm' : 'archiveConfirm')}
                />
              </form>
            }
            closeLabel={tr('website.catalog.cancel')}
            closeHref={categoryHref(current!.category.id, current!.category.kind)}
            confirmLabel={label(collection ? 'archiveCollection' : 'archive')}
            confirmName="command"
            confirmValue={commandValue('catalogCategory.archive')}
            confirmForm="category-archive"
            confirmDisabled={!writable() || ctx.busy()}
          />
        )
      },
    },
    'catalog-category-preview': {
      readKey: (route) => [route.params.id, route.query.brand, route.query.q, route.query.page],
      read: (route, signal) =>
        ctx.call<Detail & { brands: string[]; total: number; page: number }>(
          'website_catalog.previewCategory',
          {
            ...scope(),
            id: route.params.id,
            search: route.query.q,
            brand: route.query.brand,
            page: route.query.page,
          },
          { signal },
        ),
      view: (data: Detail & { brands: string[]; total: number; page: number }, route) => {
        const r = data.category,
          brands = data.brands,
          shown = data.preview,
          page = data.page
        return (
          <WorkspacePage
            title={r.title}
            layout="flow"
            actions={
              <LinkButton
                label={label('backToEdit')}
                href={categoryHref(r.id, r.kind)}
                leading={icon('chevron-left')}
                iconOnly
              />
            }
            body={
              <Stack
                items={[
                  <Notice tone="info" title={tr('website.catalog.preview')} message={label('previewHelp')} />,
                  r.cover && safeImage(r.cover) ? (
                    <img class="website-category-cover" src={safeImage(r.cover)} alt={r.title} />
                  ) : null,
                  <Text children={r.description} />,
                  <form
                    method="get"
                    action={ctx.href(
                      r.kind === 'collection' ? 'catalog-collection-preview' : 'catalog-category-preview',
                      { id: r.id },
                    )}
                  >
                    <Inline
                      items={[
                        <input type="hidden" name="site" value={ctx.site().id} />,
                        <TextField
                          id="category-preview-search"
                          name="q"
                          label={label('searchProducts')}
                          value={route.query.q ?? ''}
                        />,
                        brands.length ? (
                          <Select
                            id="category-preview-brand"
                            name="brand"
                            label={label('brand')}
                            value={route.query.brand ?? ''}
                            options={[
                              { value: '', label: label('allBrands') },
                              ...brands.map((value) => ({
                                value,
                                label: value,
                              })),
                            ]}
                          />
                        ) : null,
                        <Button label={tr('website.search.submit')} type="submit" />,
                      ]}
                    />
                  </form>,
                  <Text
                    children={tr('website.catalogCategory.productCount', {
                      count: data.total,
                    })}
                  />,
                  shown.length ? (
                    <Grid
                      columns={3}
                      mobileColumns={1}
                      items={shown.map((p) => (
                        <a
                          class="website-category-product"
                          href={ctx.href('catalog-preview', {
                            id: p.bindingId,
                          })}
                        >
                          <Surface
                            title={p.name}
                            body={
                              <Stack
                                items={[
                                  p.gallery[0]?.src ? (
                                    <img src={safeImage(p.gallery[0].src)} alt={p.gallery[0].alt || p.name} />
                                  ) : null,
                                  <Text children={p.brand ?? p.category} />,
                                  <Text children={p.description} />,
                                  p.price === undefined ? null : (
                                    <Text children={`${new Intl.NumberFormat('vi-VN').format(p.price)} ₫`} />
                                  ),
                                ]}
                              />
                            }
                          />
                        </a>
                      ))}
                    />
                  ) : (
                    <EmptyState title={label('emptyProducts')} message={label('emptyProductsHelp')} />
                  ),
                  data.total > 12 ? (
                    <Inline
                      items={[
                        page > 1 ? (
                          <LinkButton
                            label={label('previous')}
                            href={ctx.href(
                              r.kind === 'collection'
                                ? 'catalog-collection-preview'
                                : 'catalog-category-preview',
                              { id: r.id },
                              { ...route.query, page: String(page - 1) },
                            )}
                          />
                        ) : null,
                        page * 12 < data.total ? (
                          <LinkButton
                            label={label('next')}
                            href={ctx.href(
                              r.kind === 'collection'
                                ? 'catalog-collection-preview'
                                : 'catalog-category-preview',
                              { id: r.id },
                              { ...route.query, page: String(page + 1) },
                            )}
                          />
                        ) : null,
                      ]}
                    />
                  ) : null,
                ]}
              />
            }
          />
        )
      },
    },
  }
  screens['catalog-collection-edit'] = { ...edit, commands: undefined }
  screens['catalog-collection-preview'] = screens['catalog-category-preview']
  screens['catalog-collection-archive'] = screens['catalog-category-archive']
  return screens
}
