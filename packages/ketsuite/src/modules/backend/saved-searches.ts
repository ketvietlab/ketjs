import { asc, defineFn, eq, from } from '@ketvietlab/ketjs'
import type { FnSpec, ModelDef, Row } from '@ketvietlab/ketjs'

export const savedSearchModels: Record<string, ModelDef> = {
  SavedSearch: {
    scope: 'shared',
    timestamps: true,
    fields: {
      id: 'id',
      ownerId: 'text',
      listKey: 'text',
      name: 'text',
      state: 'json',
      defaultKey: 'text?',
      active: 'bool',
    },
    indexes: {
      owner_list_name: { fields: ['ownerId', 'listKey', 'name'], unique: true },
      one_default: { fields: ['defaultKey'], unique: true },
      owner_list: { fields: ['ownerId', 'listKey'] },
    },
  },
}

const safeState = (value: unknown): Row | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const source = value as Row
  const state: Row = {
    ...(typeof source.q === 'string' && source.q.trim() ? { q: source.q.trim() } : {}),
    presets: Array.isArray(source.presets) ? source.presets : [],
    filters: Array.isArray(source.filters) ? source.filters : [],
    groupBy: Array.isArray(source.groupBy) ? source.groupBy : [],
    sort: Array.isArray(source.sort) ? source.sort : [],
    includeArchived: source.includeArchived === true,
  }
  return JSON.stringify(state).length <= 20_000 ? state : null
}

export const savedSearchFunctions: Record<string, FnSpec> = {
  listSavedSearches: defineFn({
    exposure: 'internal',
    input: { listKey: 'text' },
    output: {
      id: 'id',
      listKey: 'text',
      name: 'text',
      state: 'json',
      defaultKey: 'text?',
      active: 'bool',
      createdAt: 'datetime?',
      updatedAt: 'datetime?',
    },
    effects: ['read:backend.SavedSearch'],
    handler: async (ctx, args) => {
      if (!ctx.actor) return []
      const S = ctx.table('backend.SavedSearch')
      return ctx.db.all(
        from(S)
          .where(eq(S.ownerId, ctx.actor), eq(S.listKey, args.listKey), eq(S.active, true))
          .orderBy(asc(S.name)),
      )
    },
  }),

  saveSavedSearch: defineFn({
    exposure: 'internal',
    input: { id: 'id', listKey: 'text', name: 'text', state: 'json', default: 'bool?' },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: ['read:backend.SavedSearch', 'write:backend.SavedSearch'],
    handler: async (ctx, args) => {
      if (!ctx.actor) return { ok: false, errors: [{ field: 'owner', message: 'authentication required' }] }
      const name = String(args.name).trim()
      const listKey = String(args.listKey).trim()
      const state = safeState(args.state)
      if (!name || !listKey || !state)
        return { ok: false, errors: [{ field: 'state', message: 'invalid saved search' }] }
      return ctx.tx(async (tx) => {
        const S = tx.table('backend.SavedSearch')
        const owned = await tx.db.one(from(S).where(eq(S.id, args.id), eq(S.ownerId, ctx.actor)))
        if (args.default === true) {
          const current = await tx.db.one(
            from(S).where(
              eq(S.ownerId, ctx.actor),
              eq(S.listKey, listKey),
              eq(S.defaultKey, `${ctx.actor}:${listKey}`),
            ),
          )
          if (current && current.id !== args.id)
            await tx.db.update(
              'backend.SavedSearch',
              { id: current.id, ownerId: ctx.actor },
              { defaultKey: null },
            )
        }
        const row = {
          ownerId: ctx.actor,
          listKey,
          name,
          state,
          defaultKey: args.default === true ? `${ctx.actor}:${listKey}` : null,
          active: true,
        }
        if (owned) await tx.db.update('backend.SavedSearch', { id: args.id, ownerId: ctx.actor }, row)
        else await tx.db.insert('backend.SavedSearch', { id: args.id, ...row })
        return { ok: true, id: args.id }
      })
    },
  }),

  setDefaultSavedSearch: defineFn({
    exposure: 'internal',
    input: { id: 'id', listKey: 'text', default: 'bool' },
    output: { ok: 'bool', errors: 'json?' },
    effects: ['read:backend.SavedSearch', 'write:backend.SavedSearch'],
    handler: async (ctx, args) => {
      if (!ctx.actor) return { ok: false, errors: [{ field: 'owner', message: 'authentication required' }] }
      const S = ctx.table('backend.SavedSearch')
      const row = await ctx.db.one(
        from(S).where(eq(S.id, args.id), eq(S.ownerId, ctx.actor), eq(S.listKey, args.listKey)),
      )
      if (!row) return { ok: false, errors: [{ field: 'id', message: 'saved search not found' }] }
      return ctx.tx(async (tx) => {
        const current = await tx.db.one(
          from(tx.table('backend.SavedSearch')).where(
            eq(S.ownerId, ctx.actor),
            eq(S.listKey, args.listKey),
            eq(S.defaultKey, `${ctx.actor}:${args.listKey}`),
          ),
        )
        if (current && current.id !== args.id)
          await tx.db.update(
            'backend.SavedSearch',
            { id: current.id, ownerId: ctx.actor },
            { defaultKey: null },
          )
        await tx.db.update(
          'backend.SavedSearch',
          { id: args.id, ownerId: ctx.actor },
          { defaultKey: args.default ? `${ctx.actor}:${args.listKey}` : null },
        )
        return { ok: true }
      })
    },
  }),

  archiveSavedSearch: defineFn({
    exposure: 'internal',
    input: { id: 'id', listKey: 'text' },
    output: { ok: 'bool', errors: 'json?' },
    effects: ['read:backend.SavedSearch', 'write:backend.SavedSearch'],
    handler: async (ctx, args) => {
      if (!ctx.actor) return { ok: false, errors: [{ field: 'owner', message: 'authentication required' }] }
      const rows = await ctx.db.select('backend.SavedSearch', {
        id: args.id,
        ownerId: ctx.actor,
        listKey: args.listKey,
      })
      if (!rows.length) return { ok: false, errors: [{ field: 'id', message: 'saved search not found' }] }
      await ctx.db.update(
        'backend.SavedSearch',
        { id: args.id, ownerId: ctx.actor },
        { active: false, defaultKey: null },
      )
      return { ok: true }
    },
  }),
}
