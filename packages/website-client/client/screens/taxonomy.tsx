import { LiveDescription } from '../live-description.tsx'
import { TaxonomyImage } from '../image-upload.tsx'
import { ArchiveActions } from '../archive-actions.tsx'
import {
  ListPage,
  RecordPage,
  Surface,
  Section,
  Stack,
  Grid,
  DataTable,
  FilterBar,
  SearchBar,
  TextField,
  TextArea,
  Select,
  Status,
  LinkButton,
  ActionGroup,
} from '@ketvietlab/design-system'
import { CommandButton, icon } from '../ui.tsx'
import { newId } from './format.ts'
import type { Screen, StudioContext, TaxonomyTerm } from '../types.ts'

/** A term as its editor shows it: the categories it may nest under come with it. */
type TermDraft = TaxonomyTerm & { parents: TaxonomyTerm[] }
type TermList = { all: TaxonomyTerm[]; rows: TaxonomyTerm[] }

const fields = [
  'title',
  'slug',
  'description',
  'descriptionDoc',
  'thumbnail',
  'thumbnailAlt',
  'cover',
  'coverAlt',
  'parent',
  'seoTitle',
  'seoDescription',
  'canonical',
  'indexing',
] as const
const readFields = (form: FormData) =>
  Object.fromEntries(fields.map((key) => [key, String(form.get(key) ?? '').trim()]))

export function createTaxonomyScreens(ctx: StudioContext) {
  const screens: Record<string, Screen> = {},
    tr = ctx.tr
  for (const [listKey, type] of [
    ['categories', 'category'],
    ['tags', 'tag'],
  ] as const) {
    const editKey = `${type}-edit`
    const title = () => tr(type === 'category' ? 'website.route.categories' : 'website.route.tags')
    const createLabel = () =>
      tr(type === 'category' ? 'website.taxonomy.newCategory' : 'website.taxonomy.newTag')
    let current: TaxonomyTerm | null = null,
      draft: { id: string; values: Partial<TaxonomyTerm> } | null = null
    const getRows = async (signal: AbortSignal) =>
      (
        await ctx.call<{ rows: TaxonomyTerm[] }>(
          'website_studio.listResources',
          { siteId: ctx.site().id, kind: 'taxonomy' },
          { signal },
        )
      ).rows
    const path = (row: TaxonomyTerm) => `/${type}/${row.slug ?? ''}`
    screens[listKey] = {
      readKey: (route) => route.query.q,
      read: async (route, signal) => {
        const all = await getRows(signal)
        const q = (route.query.q ?? '').toLocaleLowerCase('vi')
        return {
          all,
          rows: all.filter(
            (r) =>
              r.taxonomyType === type && (!q || `${r.title} ${r.slug}`.toLocaleLowerCase('vi').includes(q)),
          ),
        }
      },
      view: (data, route) => (
        <ListPage
          title={title()}
          variant="operational"
          headerActions={
            ctx.can('website.content.write') ? (
              <LinkButton
                label={createLabel()}
                href={ctx.href(editKey, { id: 'new' })}
                variant="primary"
                leading={icon('plus')}
              />
            ) : null
          }
          controls={
            <FilterBar
              label={title()}
              filters={[
                <SearchBar
                  id={`search-${listKey}`}
                  label={tr('website.resource.search')}
                  action={ctx.href(listKey)}
                  value={route.query.q ?? ''}
                  placeholder={tr('website.resource.searchPlaceholder')}
                  submitLabel={tr('website.search.submit')}
                />,
              ]}
            />
          }
          footer={tr('website.list.results', { count: data.rows.length })}
          body={
            <DataTable
              rows={data.rows}
              id={(r) => r.id}
              rowHref={(r) => ctx.href(editKey, { id: r.id })}
              columns={[
                {
                  key: 'title',
                  label: tr('website.resource.taxonomy.title'),
                  priority: 'primary',
                  cell: (r) => r.title,
                },
                ...(type === 'category'
                  ? [
                      {
                        key: 'parent',
                        label: tr('website.taxonomy.parent'),
                        cell: (r: TaxonomyTerm) => data.all.find((p) => p.id === r.parent)?.title ?? '—',
                      },
                    ]
                  : []),
                { key: 'path', label: tr('website.entry.path'), cell: path },
                {
                  key: 'posts',
                  label: tr('website.taxonomy.postCount'),
                  align: 'end',
                  kind: 'number',
                  cell: (r) => r.postCount ?? 0,
                },
                {
                  key: 'seo',
                  label: tr('website.taxonomy.seo'),
                  cell: (r) => (
                    <Status
                      label={tr(
                        r.seoTitle && r.seoDescription
                          ? 'website.taxonomy.seoReady'
                          : 'website.taxonomy.seoMissing',
                      )}
                      tone={r.seoTitle && r.seoDescription ? 'positive' : 'warning'}
                    />
                  ),
                },
                {
                  key: 'indexing',
                  label: tr('website.taxonomy.indexing'),
                  cell: (r) =>
                    tr(r.indexing === 'noindex' ? 'website.taxonomy.noindex' : 'website.taxonomy.index'),
                },
              ]}
              emptyTitle={tr(
                type === 'category' ? 'website.taxonomy.emptyCategories' : 'website.taxonomy.emptyTags',
              )}
              emptyMessage={tr('website.taxonomy.emptyHelp')}
            />
          }
        />
      ),
    } satisfies Screen<TermList>
    screens[editKey] = {
      readKey: (route) => route.params.id,
      read: async (route, signal): Promise<TermDraft> => {
        let term: TaxonomyTerm
        if (route.params.id === 'new')
          term =
            current?.revisionId === null
              ? current
              : { id: newId(type), revisionId: null, taxonomyType: type, indexing: 'index', usage: [] }
        else {
          term = await ctx.call<TaxonomyTerm>(
            'website_studio.getResource',
            { siteId: ctx.site().id, kind: 'taxonomy', id: route.params.id },
            { signal },
          )
          if (term.taxonomyType !== type)
            throw Object.assign(new Error(tr('website.taxonomy.notFound')), { code: 'notFound' })
        }
        current = term
        const all = await getRows(signal)
        // Do not offer a descendant as parent; the server independently checks cycles.
        const descendant = (row: TaxonomyTerm) => {
          const seen = new Set([row.id])
          let parent = row.parent
          while (parent) {
            if (parent === term.id || seen.has(parent)) return true
            seen.add(parent)
            parent = all.find((r) => r.id === parent)?.parent
          }
          return false
        }
        return {
          ...term,
          ...(draft?.id === term.id ? draft.values : {}),
          parents: all.filter(
            (r) =>
              r.taxonomyType === 'category' &&
              (!term.taxonomyId || r.taxonomyId === term.taxonomyId) &&
              r.id !== term.id &&
              !descendant(r),
          ),
        }
      },
      view: (data) => {
        const disabled = ctx.busy() || !ctx.can('website.content.write')
        const form = `taxonomy-${type}`
        const input = (key: (typeof fields)[number], label: string) => ({
          id: `${form}-${key}`,
          name: key,
          label: tr(label),
          value: data[key] ?? '',
          disabled,
        })
        return (
          <RecordPage
            width="wide"
            title={data.title || createLabel()}
            actions={
              <ActionGroup
                label={title()}
                actions={[
                  <LinkButton label={tr('website.resource.back')} href={ctx.href(listKey)} />,
                  <CommandButton
                    label={tr('website.action.save')}
                    command={`${form}.save`}
                    type="submit"
                    form={form}
                    variant="primary"
                    disabled={disabled}
                  />,
                  data.revisionId
                    ? ArchiveActions(ctx, {
                        id: `${form}-archive`,
                        title: data.title ?? '',
                        command: `${form}.archive`,
                        disabled,
                        usage: data.usage,
                      })
                    : null,
                ]}
              />
            }
            body={
              <form id={form}>
                <Stack
                  items={[
                    <Surface
                      title={tr('website.taxonomy.content')}
                      body={
                        <Grid
                          columns={2}
                          items={[
                            <TextField {...input('title', 'website.resource.taxonomy.title')} required />,
                            <TextField
                              {...input('slug', 'website.taxonomy.slug')}
                              required
                              help={`https://${ctx.site().host}${path(data)}`}
                            />,
                            ...(type === 'category'
                              ? [
                                  <Select
                                    {...input('parent', 'website.taxonomy.parent')}
                                    options={[
                                      { value: '', label: tr('website.resource.noParent') },
                                      ...data.parents.map((r) => ({ value: r.id, label: r.title ?? '' })),
                                    ]}
                                  />,
                                ]
                              : []),
                          ]}
                        />
                      }
                    />,
                    <Surface
                      title={tr('website.taxonomy.description')}
                      body={
                        <LiveDescription
                          id={data.id}
                          revision={data.revisionId}
                          value={data.descriptionDoc}
                          text={data.description}
                          label={tr('website.taxonomy.description')}
                          readOnly={!ctx.can('website.content.write')}
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
                          items={(['thumbnail', 'cover'] as const).map((key) => (
                            <Section
                              title={tr(`website.taxonomy.${key}`)}
                              body={TaxonomyImage(ctx, {
                                id: data.id,
                                field: key,
                                value: data[key],
                                alt: data[`${key}Alt`],
                                disabled,
                              })}
                            />
                          ))}
                        />
                      }
                    />,
                    <Surface
                      title={tr('website.taxonomy.seo')}
                      body={
                        <Stack
                          divided
                          items={[
                            <Grid
                              columns={2}
                              items={[
                                <TextField {...input('seoTitle', 'website.taxonomy.seoTitle')} />,
                                <TextField
                                  {...input('canonical', 'website.resource.seo.canonical')}
                                  placeholder={`https://${ctx.site().host}${path(data)}`}
                                />,
                                <TextArea {...input('seoDescription', 'website.taxonomy.seoDescription')} />,
                                <Select
                                  {...input('indexing', 'website.taxonomy.indexing')}
                                  value={data.indexing || 'index'}
                                  options={[
                                    { value: 'index', label: tr('website.taxonomy.index') },
                                    { value: 'noindex', label: tr('website.taxonomy.noindex') },
                                  ]}
                                />,
                              ]}
                            />,
                            <Section
                              title={tr('website.taxonomy.preview')}
                              body={
                                <>
                                  <p>{data.canonical || `https://${ctx.site().host}${path(data)}`}</p>
                                  <h3>{data.seoTitle || data.title || createLabel()}</h3>
                                  <p>
                                    {data.seoDescription ||
                                      data.description ||
                                      tr('website.taxonomy.previewEmpty')}
                                  </p>
                                  <CommandButton
                                    label={tr('website.taxonomy.previewUpdate')}
                                    command={`${form}.preview`}
                                    type="submit"
                                    form={form}
                                    disabled={disabled}
                                  />
                                </>
                              }
                            />,
                          ]}
                        />
                      }
                    />,
                  ]}
                />
              </form>
            }
          />
        )
      },
      commands: {
        [`taxonomy-${type}.preview`]: async (_, form) => {
          draft = { id: current!.id, values: readFields(form!) }
          await ctx.refresh()
        },
        [`taxonomy-${type}.save`]: async (_, form) => {
          form = form!
          const term = current!
          const values = {
            ...readFields(form),
            taxonomyType: type,
            taxonomyId: term.taxonomyId ?? '',
            parent: type === 'tag' ? '' : String(form.get('parent') ?? ''),
          }
          const result = await ctx.call<TaxonomyTerm>(
            'website_studio.saveResource',
            {
              siteId: ctx.site().id,
              kind: 'taxonomy',
              id: term.id,
              expectedRevisionId: term.revisionId,
              values,
            },
            term.revisionId ? {} : { key: term.id },
          )
          draft = null
          current = result
          ctx.notify(tr('website.resource.saved'))
          await ctx.navigate(editKey, { id: result.id })
        },
        [`taxonomy-${type}.archive`]: async (_, form) => {
          await ctx.call('website_studio.archiveResource', {
            siteId: ctx.site().id,
            kind: 'taxonomy',
            id: current!.id,
            expectedRevisionId: current!.revisionId,
            confirmed: form!.has('confirmed'),
          })
          draft = null
          current = null
          await ctx.navigate(listKey)
        },
      },
    } satisfies Screen<TermDraft>
  }
  // Existing bookmarks open the simpler category workspace without exposing technical set editors.
  screens.taxonomy = screens.categories
  screens['taxonomy-sets'] = screens.categories
  screens['taxonomy-edit'] = { ...screens['category-edit'], commands: undefined }
  screens['taxonomy-sets-edit'] = screens.categories
  return screens
}
