import type { Ctx, FnSpec } from '@ketvietlab/ketjs'
import { canReadProject, readableRow } from '../membership.ts'
import {
  archivePage,
  listAllPages,
  listPages,
  movePage,
  pageDetail,
  reorderPage,
  restorePage,
  savePage,
} from '../pages.ts'
import { n } from '../domain/command.ts'
import { defineFn } from '@ketvietlab/ketjs'
import { membershipEffects } from './effects.ts'

export async function pageListHandler(ctx: Ctx, args: Record<string, unknown>) {
  // Without a project this is the cross-project search, which listPages
  // filters itself; with one it is that project's tree.
  if (args.projectId != null && !(await canReadProject(ctx, args.projectId))) return []
  return listPages(ctx, {
    projectId: args.projectId == null ? null : String(args.projectId),
    search: args.search == null ? null : String(args.search),
    includeArchived: args.includeArchived === true,
    limit: args.limit == null ? undefined : n(args.limit),
  })
}

export function pageListAllHandler(ctx: Ctx, args: Record<string, unknown>) {
  return listAllPages(ctx, {
    search: args.search == null ? null : String(args.search),
    cursor: args.cursor == null ? undefined : n(args.cursor),
    limit: args.limit == null ? undefined : n(args.limit),
  })
}

export async function pageGetHandler(ctx: Ctx, args: Record<string, unknown>) {
  const held = await pageDetail(ctx, String(args.id))
  return { value: held && (await canReadProject(ctx, held.projectId)) ? held : null }
}

export function pageSaveHandler(ctx: Ctx, args: Record<string, unknown>) {
  return savePage(ctx, {
    id: String(args.id),
    projectId: String(args.projectId),
    title: String(args.title),
    parentPageId: args.parentPageId === undefined ? undefined : (args.parentPageId as string | null),
    sequence: args.sequence == null ? null : n(args.sequence),
    expectedVersion: args.expectedVersion == null ? undefined : n(args.expectedVersion),
    idempotencyKey: String(args.idempotencyKey),
  })
}

export function pageMoveHandler(ctx: Ctx, args: Record<string, unknown>) {
  return movePage(ctx, {
    id: String(args.id),
    parentPageId: (args.parentPageId as string | null) ?? null,
    sequence: args.sequence == null ? null : n(args.sequence),
  })
}

export function pageReorderHandler(ctx: Ctx, args: Record<string, unknown>) {
  return reorderPage(ctx, {
    id: String(args.id),
    direction: String(args.direction) === 'up' ? 'up' : 'down',
  })
}

export function pageArchiveHandler(ctx: Ctx, args: Record<string, unknown>) {
  return archivePage(ctx, String(args.id))
}

export function pageRestoreHandler(ctx: Ctx, args: Record<string, unknown>) {
  return restorePage(ctx, String(args.id))
}

export async function pageEditContentHandler(ctx: Ctx, args: Record<string, unknown>) {
  const row = await readableRow(ctx, 'flow.Page', args.id)
  return row ? { id: row.id, contentAttachmentId: row.contentAttachmentId ?? null } : null
}

export const pageFunctions: Record<string, FnSpec> = {
  /**
   * Every page in a project, flat — the screen assembles the tree.
   *
   * See listPages for why the whole project comes back at once rather than a
   * level per request.
   */
  'page.list': defineFn({
    input: { projectId: 'id?', search: 'text?', includeArchived: 'bool?', limit: 'int?' },
    output: {
      id: 'id',
      projectId: 'id',
      parentPageId: 'id?',
      title: 'text',
      previewText: 'text?',
      contentAttachmentId: 'id?',
      contentUpdatedAt: 'datetime?',
      sequence: 'int',
      active: 'bool',
      version: 'int',
      updatedAt: 'datetime',
      childCount: 'int',
    },
    effects: [
      'read:flow.Page',
      'read:flow.Project',
      'read:flow.ProjectMember',
      'read:flow.ProjectAccessGrant',
      'read:user.User',
      ...membershipEffects,
    ],
    agent: true,
    handler: pageListHandler,
  }),
  /**
   * Every project's pages, paged and counted — see listAllPages.
   *
   * `page.list` answers "this project's tree" and stays that. This answers
   * "every document there is", a different question needing a different shape:
   * a total the pager can trust, and the project name beside each row.
   */
  'page.listAll': defineFn({
    input: { search: 'text?', cursor: 'int?', limit: 'int?' },
    output: { rows: 'json', total: 'int' },
    effects: ['read:flow.Page', ...membershipEffects],
    agent: true,
    handler: pageListAllHandler,
  }),
  'page.get': defineFn({
    input: { id: 'id' },
    output: { value: 'json?' },
    effects: [
      'read:flow.Page',
      'read:flow.Project',
      'read:flow.ProjectMember',
      'read:flow.ProjectAccessGrant',
      'read:user.User',
    ],
    agent: true,
    handler: pageGetHandler,
  }),
  'page.save': defineFn({
    input: {
      id: 'id',
      projectId: 'id',
      title: 'text',
      parentPageId: 'id?',
      sequence: 'int?',
      expectedVersion: 'int?',
      idempotencyKey: 'text',
    },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: ['read:flow.Page', 'write:flow.Page', 'read:flow.Project', ...membershipEffects],
    idempotent: true,
    agent: true,
    handler: pageSaveHandler,
  }),
  /**
   * Re-parenting, as its own key.
   *
   * A hierarchy is only useful if it can be rearranged, and rearranging is a
   * different right from writing: someone may be trusted to edit a page
   * without being trusted to move a whole branch of the wiki.
   */
  'page.move': defineFn({
    input: { id: 'id', parentPageId: 'id?', sequence: 'int?' },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: ['read:flow.Page', 'write:flow.Page', ...membershipEffects],
    idempotent: true,
    agent: true,
    handler: pageMoveHandler,
  }),
  'page.reorder': defineFn({
    input: { id: 'id', direction: 'text' },
    output: { ok: 'bool', id: 'id?', moved: 'bool?', errors: 'json?' },
    effects: ['read:flow.Page', 'write:flow.Page', ...membershipEffects],
    idempotent: true,
    agent: true,
    handler: pageReorderHandler,
  }),
  'page.archive': defineFn({
    input: { id: 'id' },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: ['read:flow.Page', 'write:flow.Page', ...membershipEffects],
    idempotent: true,
    agent: true,
    handler: pageArchiveHandler,
  }),
  'page.restore': defineFn({
    input: { id: 'id' },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: ['read:flow.Page', 'write:flow.Page', ...membershipEffects],
    idempotent: true,
    agent: true,
    handler: pageRestoreHandler,
  }),
  /**
   * Rewriting a page's document, as a permission key of its own.
   *
   * It grants nothing by itself — Live Doc calls it only to ask whether this
   * caller may write, and hands back the row it returns (documents.ts). It is
   * separate from `page.save` because writing prose and renaming a page are
   * different rights: a reviewer may hold one without the other.
   */
  'page.editContent': defineFn({
    input: { id: 'id' },
    // The fields as they are actually returned, not a `value` wrapper the
    // handler never builds: output is projected against these keys, so
    // declaring `value` and answering `{ id, contentAttachmentId }` threw both
    // away and handed the caller `{}`. Live Doc reads `contentAttachmentId`
    // off this to find the stored snapshot, so an empty answer read as "never
    // written" — and the next push started from a blank document and flattened
    // it over the real one.
    output: { id: 'id?', contentAttachmentId: 'id?' },
    effects: ['read:flow.Page', ...membershipEffects],
    agent: true,
    handler: pageEditContentHandler,
  }),
}
