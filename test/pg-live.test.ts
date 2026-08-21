// Runs against a real Postgres when one is reachable, and skips otherwise so the
// suite still passes on a machine without it. Everything above this line has been
// proven against a stand-in; this is the part only a live server can settle.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { postgresAdapter } from 'ketjs-postgres'
import {
  callFn,
  compose,
  createAdapterPool,
  createQueue,
  createStreams,
  dbStreamStore,
  eq,
  formatFleet,
  from,
  gte,
  migrateFleet,
  planMigration,
  migrateOne,
  registerFunctions,
  renderSql,
  schemaFromManifest,
  table,
} from 'ketjs'
import type { Adapter } from 'ketjs'
import {
  account,
  catalog,
  checkout,
  company,
  defaultTheme as theme,
  inventory,
  oauth,
  partner,
  product,
  pricing,
  purchase,
  sale,
  pos,
  stock,
  uom,
  user,
} from 'ketsuite'
import { address } from 'ketsuite'

/** Every request acts as some company; these tests act as one. */
const SCOPE = { company: 'c1', branch: 'main', branches: null }

const URL = process.env.KET_TEST_PG ?? 'postgres://dev:devpassword@127.0.0.1:5435/ketjs_dev'
const mods = [catalog, inventory, checkout, theme]
const manifest = compose(mods)

const reachable = await (async () => {
  const a = postgresAdapter(URL)
  try {
    await a.open()
    await a.all('SELECT 1')
    await a.close()
    return true
  } catch {
    return false
  }
})()

const live = { skip: reachable ? false : `no Postgres at ${URL}` }

/** Runs the body with a fresh database and always closes the pool, so a failed
 *  assertion cannot leave the suite waiting on an open socket. */
async function withPg(body: (a: Adapter) => Promise<void>): Promise<void> {
  const a = await fresh()
  try {
    await body(a)
  } finally {
    await a.close()
  }
}

async function fresh(): Promise<Adapter> {
  const a = postgresAdapter(URL)
  await a.open()
  for (const t of [
    'ket_stream',
    'ket_job',
    'ket_job_legacy',
    'ket_idem',
    'checkout_order',
    'catalog_product',
  ]) {
    await a.exec(`DROP TABLE IF EXISTS "${t}" CASCADE`)
  }
  for (const sql of renderSql(planMigration(null, schemaFromManifest(manifest)), a)) await a.exec(sql)
  registerFunctions(mods)
  return a
}

test('live pg: the manifest migrates onto a real server', live, async () => {
  await withPg(async (a) => {
    const cols = (await a.introspect())['catalog_product']!
    assert.equal(cols['active'], 'boolean', 'a real BOOLEAN, not sqlite 0/1')
    assert.equal(cols['leadTimeDays'], 'bigint')
    assert.equal((await a.introspect())['checkout_order']!['placedAt'], 'timestamp with time zone')
  })
})

test('live pg: server functions round-trip through the query layer', live, async () => {
  await withPg(async (a) => {
    for (const [id, price] of [
      ['p1', 30_000],
      ['p2', 90_000],
      ['p3', 60_000],
    ] as const) {
      await callFn(
        'catalog.createProduct',
        { id, title: `SP ${id}`, priceCents: price, slug: id },
        { adapter: a, manifest, scope: SCOPE },
      )
    }
    const dear = await callFn(
      'catalog.listProducts',
      { minPriceCents: 60_000 },
      { adapter: a, manifest, scope: SCOPE },
    )
    assert.deepEqual(
      (dear.value as Array<{ id: string }>).map((r) => r.id),
      ['p2', 'p3'],
    )

    const P = table(manifest, 'catalog.Product')
    const { text, params } = from(P).where(gte(P.priceCents!, 60_000), eq(P.active!, true)).toSQL('postgres')
    assert.equal((await a.all(text, params)).length, 2)
  })
})

test('live pg: booleans and bigints survive the round trip as themselves', live, async () => {
  await withPg(async (a) => {
    await callFn(
      'catalog.createProduct',
      { id: 'b1', title: 'X', priceCents: 12_345, slug: 'x' },
      { adapter: a, manifest, scope: SCOPE },
    )
    const row = (await a.all('SELECT "active", "priceCents" FROM catalog_product WHERE id = $1', ['b1']))[0]!
    assert.equal(row.active, true, 'a real boolean comes back, not 1')
    assert.equal(Number(row.priceCents), 12_345)
  })
})

test('live pg: a transaction rolls back on a real server', live, async () => {
  await withPg(async (a) => {
    await assert.rejects(() =>
      a.tx(async (tx) => {
        await tx.run(
          'INSERT INTO catalog_product (id, title, "priceCents", slug, active) VALUES ($1,$2,$3,$4,$5)',
          ['t1', 'T', 1, 't', true],
        )
        throw new Error('boom')
      }),
    )
    assert.equal((await a.all('SELECT id FROM catalog_product WHERE id = $1', ['t1'])).length, 0)
  })
})

test('live pg: resumable stream survives on a real table', live, async () => {
  await withPg(async (a) => {
    const s = await createStreams(dbStreamStore(a))
    const w = await s.open('gen-live')
    w.write('Xin')
    w.write(' chào')
    await w.flush()
    const first = await s.since('gen-live', 0)
    assert.equal(first.chunks.map((c) => c.data).join(''), 'Xin chào')

    w.write(' bạn')
    await w.end({ tokens: 3 })
    const resumed = await s.since('gen-live', first.nextSeq)
    assert.equal(resumed.chunks.map((c) => c.data).join(''), ' bạn', 'no gap, no duplicate')
    assert.equal(resumed.done, true)
    assert.ok((await s.sweep(0)) > 0, 'retention actually deletes')
  })
})

test('live pg: SKIP LOCKED hands each job to exactly one worker', live, async () => {
  await withPg(async (a) => {
    const q = await createQueue(a)
    const cols = (await a.introspect()).ket_job!
    for (const column of [
      'scheduled_at',
      'attempted_at',
      'completed_at',
      'lease_until',
      'inserted_at',
      'updated_at',
    ])
      assert.equal(cols[column], 'timestamp with time zone', `${column} must not degrade to TEXT`)
    const indexes = await a.all(
      `SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'ket_job'`,
    )
    assert.match(
      String(indexes.find((row) => row.indexname === 'ket_job_fetch_active')?.indexdef),
      /\(queue, priority, scheduled_at, id\).*WHERE \(state = ANY/,
    )
    for (let i = 0; i < 20; i++) await q.enqueue('mail', { n: i })

    // Twenty workers claiming at once: with SELECT-then-UPDATE they would collide.
    const claimed = await Promise.all(Array.from({ length: 20 }, () => q.claim('mail')))
    const ids = claimed.filter(Boolean).map((j) => j!.id)
    assert.equal(ids.length, 20, 'every job was claimed')
    assert.equal(new Set(ids).size, 20, 'no job was handed to two workers')
    assert.equal(await q.pending('mail'), 0)
  })
})

test('live pg: concurrent unique enqueue creates one durable row', live, async () => {
  await withPg(async (a) => {
    const q = await createQueue(a)
    const results = await Promise.all(
      Array.from({ length: 20 }, () =>
        q.enqueue('mail.once', { orderId: 'o1' }, { queue: 'default', uniqueKey: 'o1' }),
      ),
    )
    assert.equal(new Set(results.map((result) => result.id)).size, 1)
    assert.equal(results.filter((result) => !result.existing).length, 1)
    assert.equal((await q.list()).length, 1)

    const claimed = await q.claimBatch('default', { workerId: 'unique-worker', limit: 1 })
    assert.equal(await q.complete(claimed[0]!.id, 'unique-worker'), true)
    const again = await q.enqueue('mail.once', { orderId: 'o1-again' }, { queue: 'default', uniqueKey: 'o1' })
    assert.equal(again.existing, false)
    assert.notEqual(again.id, claimed[0]!.id)
  })
})

test('live pg: concurrent replicas serialize the legacy queue migration', live, async () => {
  await withPg(async (a) => {
    await a.exec(`CREATE TABLE ket_job (
      id BIGSERIAL PRIMARY KEY,
      queue TEXT NOT NULL,
      payload TEXT,
      state TEXT NOT NULL DEFAULT 'ready',
      attempts INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL
    )`)
    await a.run(
      `INSERT INTO ket_job (queue, payload, state, attempts, created_at)
       VALUES ($1, $2, $3, $4, $5)`,
      ['mail.legacy', JSON.stringify({ id: 'old' }), 'ready', 1, '2026-01-01T00:00:00.000Z'],
    )
    const peers = [postgresAdapter(URL), postgresAdapter(URL)]
    await Promise.all(peers.map((peer) => peer.open()))
    try {
      const queues = await Promise.all([createQueue(a), ...peers.map((peer) => createQueue(peer))])
      const migrated = await queues[0]!.list()
      assert.equal(migrated.length, 1)
      assert.equal(migrated[0]?.id, 'legacy-1')
      assert.equal(migrated[0]?.state, 'available')
    } finally {
      await Promise.all(peers.map((peer) => peer.close()))
    }
  })
})

test('live pg: transactional NOTIFY arrives only after commit and rollback leaves no job', live, async () => {
  await withPg(async (a) => {
    const q = await createQueue(a)
    const messages: string[] = []
    let ready = 0
    const stop = await a.notifications?.subscribe?.(
      'ket_job_ready',
      (payload) => messages.push(payload),
      () => ready++,
    )
    assert.equal(ready, 1)

    await assert.rejects(() =>
      a.tx(async (tx) => {
        const transactional = await createQueue(tx)
        await transactional.enqueue('mail.rollback', {}, { queue: 'maintenance' })
        throw new Error('rollback')
      }),
    )
    await new Promise((resolve) => setTimeout(resolve, 100))
    assert.deepEqual(messages, [])
    assert.equal((await q.list()).length, 0)

    await a.tx(async (tx) => {
      const transactional = await createQueue(tx)
      await transactional.enqueue('mail.commit', {}, { queue: 'default' })
    })
    const deadline = Date.now() + 2_000
    while (!messages.length && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 10))
    assert.deepEqual(messages, ['default'])
    assert.equal((await q.list()).length, 1)
    await stop?.()
  })
})

test('live pg: idempotency is settled by the primary key across concurrent calls', live, async () => {
  await withPg(async (a) => {
    const args = { id: 'o1', productId: 'p1', qty: 2 }
    await callFn(
      'catalog.createProduct',
      { id: 'p1', title: 'Áo', priceCents: 5000, slug: 'ao' },
      { adapter: a, manifest, scope: SCOPE },
    )

    const results = await Promise.allSettled(
      Array.from({ length: 5 }, () =>
        callFn('checkout.placeOrder', args, { adapter: a, manifest, scope: SCOPE, idempotencyKey: 'same' }),
      ),
    )
    const ok = results.filter((r) => r.status === 'fulfilled')
    assert.ok(ok.length >= 1)
    assert.equal(
      (await a.all('SELECT id FROM checkout_order', [])).length,
      1,
      'five concurrent calls, one order',
    )
  })
})

test('live pg: a database per tenant, migrated as a fleet', live, async () => {
  const base = URL.replace(/\/[^/]*$/, '')
  const pool = createAdapterPool({ create: (key) => postgresAdapter(`${base}/${key}`), max: 4 })
  try {
    for (const db of ['ketjs_t1', 'ketjs_t2']) {
      await pool.with(db, async (a) => {
        for (const t of [
          'ket_migration',
          'ket_stream',
          'ket_job',
          'ket_idem',
          'checkout_order',
          'catalog_product',
        ]) {
          await a.exec(`DROP TABLE IF EXISTS "${t}" CASCADE`)
        }
      })
    }
    registerFunctions(mods)

    const first = await migrateFleet(pool, ['ketjs_t1', 'ketjs_t2'], manifest)
    assert.ok(
      first.every((r) => r.applied && !r.error),
      formatFleet(first),
    )

    // real isolation: the same product id in both, different data, no bleed
    await pool.with('ketjs_t1', (a) =>
      callFn(
        'catalog.createProduct',
        { id: 'p1', title: 'của t1', priceCents: 1000, slug: 'p1' },
        { adapter: a, manifest, scope: SCOPE },
      ),
    )
    await pool.with('ketjs_t2', (a) =>
      callFn(
        'catalog.createProduct',
        { id: 'p1', title: 'của t2', priceCents: 2000, slug: 'p1' },
        { adapter: a, manifest, scope: SCOPE },
      ),
    )

    const t1 = await pool.with('ketjs_t1', (a) => a.all('SELECT title FROM catalog_product', []))
    const t2 = await pool.with('ketjs_t2', (a) => a.all('SELECT title FROM catalog_product', []))
    assert.deepEqual(
      t1.map((r) => r.title),
      ['của t1'],
    )
    assert.deepEqual(
      t2.map((r) => r.title),
      ['của t2'],
    )

    // running again moves nothing: each database knows the schema it is on
    const second = await migrateFleet(pool, ['ketjs_t1', 'ketjs_t2'], manifest)
    assert.ok(
      second.every((r) => r.ops.length === 0),
      formatFleet(second),
    )
    assert.equal(pool.size, 2)
  } finally {
    await pool.close()
  }
})

test('live pg: a decimal column is NUMERIC, and gives back exactly what it was given', live, async () => {
  const base = URL.replace(/\/[^/]*$/, '')
  const pool = createAdapterPool({ create: (key) => postgresAdapter(`${base}/${key}`), max: 2 })
  try {
    const m = compose([uom], { headless: true })
    await pool.with('ketjs_t2', async (a) => {
      // A clean slate, including the migration record: this database is left in
      // whatever shape the fleet test gave it, and the destructive guard rightly
      // refuses to drop those tables on the way to a uom-only schema.
      for (const t of [
        'uom_unit',
        'uom_precision',
        'catalog_product',
        'checkout_order',
        'ket_migration',
        'ket_app',
        'ket_idem',
        'ket_job',
        'ket_stream',
      ]) {
        await a.exec(`DROP TABLE IF EXISTS "${t}" CASCADE`)
      }
      await migrateOne(a, m)

      const cols = (await a.introspect())['uom_unit']!
      assert.equal(cols['relativeFactor'], 'numeric')
      assert.equal(cols['absoluteFactor'], 'numeric', 'exact decimal storage, as Odoo uses for quantities')
      assert.equal(cols['rounding'], 'numeric')

      registerFunctions([uom])
      await callFn(
        'uom.saveUnit',
        { id: 'root', name: 'Reference', relativeFactor: '1' },
        { adapter: a, manifest: m, scope: { company: 'acme', branches: null } },
      )

      // Values a double cannot hold. The point of the column type is that these
      // come back as themselves rather than as the nearest binary approximation.
      const awkward = ['0.1', '0.001', '0.07', '12345.6789']
      for (const [i, factor] of awkward.entries()) {
        await callFn(
          'uom.saveUnit',
          { id: `u${i}`, name: `u${i}`, relativeUomId: 'root', relativeFactor: factor },
          { adapter: a, manifest: m, scope: { company: 'acme', branches: null } },
        )
      }
      const rows = (
        await callFn(
          'uom.listUnits',
          { rootId: 'root' },
          { adapter: a, manifest: m, scope: { company: 'acme', branches: null } },
        )
      ).value as Array<{ id: string; absoluteFactor: number }>
      for (const [i, factor] of awkward.entries()) {
        assert.equal(rows.find((r) => r.id === `u${i}`)!.absoluteFactor, Number(factor))
      }

      // And the driver hands NUMERIC over as a string, which is what keeps it exact
      // before the framework turns it into a number.
      const raw = (
        await a.all('SELECT "relativeFactor", "absoluteFactor" FROM uom_unit WHERE id = $1', ['u0'])
      )[0]!
      assert.equal(typeof raw.relativeFactor, 'string')
      assert.equal(raw.relativeFactor, '0.1')
      assert.equal(raw.absoluteFactor, '0.1')
    })
  } finally {
    await pool.close()
  }
})

test('live pg: concurrent partner defaults, roles and terms stay unique', live, async () => {
  await withPg(async (a) => {
    const partnerModules = [address, partner]
    const partnerManifest = compose(partnerModules, { headless: true })
    const partnerSchema = schemaFromManifest(partnerManifest)
    for (const tableName of Object.keys(partnerSchema.tables))
      await a.exec(`DROP TABLE IF EXISTS "${tableName}" CASCADE`)
    for (const sql of renderSql(planMigration(null, partnerSchema), a)) await a.exec(sql)
    registerFunctions(partnerModules)
    const options = { adapter: a, manifest: partnerManifest, scope: SCOPE }
    await callFn('partner.savePartner', { id: 'p1', kind: 'company', name: 'ACME' }, options)

    await Promise.all(
      ['invoice-a', 'invoice-b'].map((id) =>
        callFn(
          'partner.saveAddress',
          {
            id,
            partnerId: 'p1',
            use: 'invoice',
            street: id,
            city: 'Hà Nội',
            country: 'VN',
            isDefault: true,
          },
          options,
        ),
      ),
    )
    await Promise.all(
      Array.from({ length: 12 }, (_, index) =>
        callFn('partner.grantRole', { id: `role-${index}`, partnerId: 'p1', role: 'customer' }, options),
      ),
    )
    await Promise.all(
      Array.from({ length: 12 }, (_, index) =>
        callFn(
          'partner.saveTerms',
          { id: `terms-${index}`, partnerId: 'p1', creditLimit: String(index) },
          options,
        ),
      ),
    )

    assert.equal((await a.all('SELECT id FROM partner_address_default')).length, 1)
    assert.equal((await a.all('SELECT id FROM partner_role')).length, 1)
    assert.equal((await a.all('SELECT id FROM partner_company_terms')).length, 1)
  })
})

test('live pg: concurrent company roots and user memberships stay unique', live, async () => {
  await withPg(async (a) => {
    const identityModules = [address, partner, company, user]
    const identityManifest = compose(identityModules, { headless: true })
    const identitySchema = schemaFromManifest(identityManifest)
    for (const tableName of Object.keys(identitySchema.tables))
      await a.exec(`DROP TABLE IF EXISTS "${tableName}" CASCADE`)
    for (const sql of renderSql(planMigration(null, identitySchema), a)) await a.exec(sql)
    registerFunctions(identityModules)
    const options = { adapter: a, manifest: identityManifest, scope: SCOPE }
    await callFn('partner.savePartner', { id: 'company-party', kind: 'company', name: 'ACME' }, options)

    await Promise.all(
      Array.from({ length: 12 }, () =>
        callFn(
          'company.saveCompany',
          { id: 'acme', code: 'ACME', partnerId: 'company-party', currency: 'VND' },
          options,
        ),
      ),
    )
    assert.equal((await a.all('SELECT id FROM company_company')).length, 1)
    assert.equal((await a.all('SELECT id FROM company_branch WHERE "rootKey" = $1', ['acme'])).length, 1)

    await callFn(
      'company.saveBranch',
      { id: 'north', companyId: 'acme', code: 'NORTH', name: 'North', parentId: 'root:acme' },
      options,
    )
    await callFn(
      'user.createUser',
      { id: 'admin', login: 'admin', password: 'correct horse', name: 'Admin' },
      options,
    )
    await Promise.all(
      Array.from({ length: 12 }, (_, index) =>
        callFn(
          'user.grantCompany',
          { id: `membership-${index}`, userId: 'admin', companyId: 'acme' },
          options,
        ),
      ),
    )
    await Promise.all(
      Array.from({ length: 12 }, (_, index) =>
        callFn(
          'user.grantBranch',
          { id: `branch-membership-${index}`, userId: 'admin', branchId: 'north' },
          options,
        ),
      ),
    )
    assert.equal((await a.all('SELECT id FROM user_membership')).length, 1)
    assert.equal(
      (await a.all('SELECT id FROM user_branch_membership')).length,
      2,
      'one root grant plus one explicit branch grant',
    )
  })
})

test('live pg: identity login, role edges, throttles and token CAS survive concurrency', live, async () => {
  await withPg(async (a) => {
    const identityModules = [address, partner, company, user]
    const identityManifest = compose(identityModules, { headless: true })
    const identitySchema = schemaFromManifest(identityManifest)
    for (const tableName of Object.keys(identitySchema.tables))
      await a.exec(`DROP TABLE IF EXISTS "${tableName}" CASCADE`)
    for (const sql of renderSql(planMigration(null, identitySchema), a)) await a.exec(sql)
    registerFunctions(identityModules)
    const options = { adapter: a, manifest: identityManifest, scope: SCOPE }

    const users = await Promise.all(
      Array.from({ length: 10 }, (_, index) =>
        callFn(
          'user.createUser',
          {
            id: `root-${index}`,
            login: index % 2 ? ' ROOT@EXAMPLE.COM ' : 'root@example.com',
            password: 'correct horse',
            name: `Root ${index}`,
            superuser: true,
          },
          options,
        ),
      ),
    )
    assert.equal(users.filter((result) => (result.value as { ok: boolean }).ok).length, 1)
    const root = String((await a.all('SELECT id FROM user_user'))[0]!.id)
    await callFn(
      'user.createUser',
      {
        id: 'backup-root',
        login: 'backup-root@example.com',
        password: 'correct horse',
        name: 'Backup root',
        superuser: true,
      },
      options,
    )

    await callFn('user.createUser', { id: 'invited', login: 'invited', name: 'Invited' }, options)
    await callFn('user.saveRole', { id: 'manager', name: 'Manager' }, options)
    await Promise.all(
      Array.from({ length: 10 }, (_, index) =>
        callFn(
          'user.assignRole',
          { id: `assignment-${index}`, userId: 'invited', roleId: 'manager' },
          options,
        ),
      ),
    )
    assert.equal((await a.all('SELECT id FROM user_assignment')).length, 1)

    const issued = await callFn(
      'user.issueAuthToken',
      { userId: 'invited', kind: 'invitation', realm: 'backend' },
      { ...options, actor: root },
    )
    const token = String((issued.value as { token: string }).token)
    const consumed = await Promise.all(
      Array.from({ length: 8 }, () =>
        callFn(
          'user.consumeAuthToken',
          { token, kind: 'invitation', realm: 'backend', password: 'accepted password' },
          options,
        ),
      ),
    )
    assert.equal(consumed.filter((result) => (result.value as { ok: boolean }).ok).length, 1)

    const secondPod = postgresAdapter(URL)
    await secondPod.open()
    try {
      for (let index = 0; index < 3; index++)
        await callFn(
          'user.authenticate',
          { login: 'root@example.com', password: 'wrong password', networkFingerprint: 'shared-network' },
          { ...options, adapter: index % 2 ? secondPod : a },
        )
      const blocked = await callFn(
        'user.authenticate',
        { login: 'root@example.com', password: 'correct horse', networkFingerprint: 'shared-network' },
        { ...options, adapter: secondPod },
      )
      assert.equal((blocked.value as { ok: boolean }).ok, false)
    } finally {
      await secondPod.close()
    }

    const archived = await Promise.all(
      [root, 'backup-root'].map((id) =>
        callFn('user.archiveUser', { id, active: false }, { ...options, actor: root }),
      ),
    )
    assert.equal(archived.filter((result) => (result.value as { ok: boolean }).ok).length, 1)
    assert.equal(
      Number(
        (
          await a.all(
            `SELECT COUNT(*) AS count FROM user_user
             WHERE active = TRUE AND superuser = TRUE AND "accessKind" = 'internal'`,
          )
        )[0]!.count,
      ),
      1,
    )
  })
})

test('live pg: concurrent admin provisioning creates exactly one complete bootstrap', live, async () => {
  await withPg(async (a) => {
    const identityModules = [address, partner, company, user]
    const identityManifest = compose(identityModules, { headless: true })
    const identitySchema = schemaFromManifest(identityManifest)
    for (const tableName of Object.keys(identitySchema.tables))
      await a.exec(`DROP TABLE IF EXISTS "${tableName}" CASCADE`)
    for (const sql of renderSql(planMigration(null, identitySchema), a)) await a.exec(sql)
    registerFunctions(identityModules)
    const peers = [a, postgresAdapter(URL), postgresAdapter(URL), postgresAdapter(URL)]
    await Promise.all(peers.slice(1).map((adapter) => adapter.open()))
    try {
      const results = await Promise.all(
        peers.map((adapter) =>
          callFn(
            'user.provisionAdmin',
            {
              companyName: 'Kết Việt',
              companyCode: 'KET',
              currency: 'VND',
              adminLogin: 'admin@example.com',
              adminName: 'Administrator',
              adminEmail: 'admin@example.com',
              adminPassword: 'correct horse battery staple',
            },
            {
              adapter,
              manifest: identityManifest,
              actor: 'system:provision',
              scope: { company: null, branch: null },
            },
          ),
        ),
      )
      assert.equal(results.filter((result) => (result.value as { ok: boolean }).ok).length, 1)
      for (const table of [
        'partner_partner',
        'company_company',
        'company_branch',
        'user_user',
        'user_membership',
        'user_branch_membership',
      ])
        assert.equal(Number((await a.all(`SELECT COUNT(*) AS count FROM ${table}`))[0]!.count), 1, table)
    } finally {
      await Promise.all(peers.slice(1).map((adapter) => adapter.close()))
    }
  })
})

test('live pg: concurrent stock reservations never over-reserve one quant', live, async () => {
  await withPg(async (a) => {
    const stockModules = [uom, product, stock]
    const stockManifest = compose(stockModules, { headless: true })
    const stockSchema = schemaFromManifest(stockManifest)
    for (const tableName of Object.keys(stockSchema.tables))
      await a.exec(`DROP TABLE IF EXISTS "${tableName}" CASCADE`)
    for (const sql of renderSql(planMigration(null, stockSchema), a)) await a.exec(sql)
    registerFunctions(stockModules)
    const options = { adapter: a, manifest: stockManifest, scope: SCOPE }
    await callFn('uom.saveUnit', { id: 'unit', name: 'Unit', relativeFactor: '1' }, options)
    await callFn('product.saveTemplate', { id: 'tpl', name: 'Áo', type: 'goods', uomId: 'unit' }, options)
    await callFn('product.saveVariant', { id: 'p1', templateId: 'tpl', combinationKey: '' }, options)
    await callFn('stock.configureProduct', { templateId: 'tpl', isStorable: true, tracking: 'none' }, options)
    await callFn('stock.saveLocation', { id: 'inventory', name: 'Inventory', usage: 'inventory' }, options)
    await callFn('stock.saveLocation', { id: 'stock', name: 'Stock', usage: 'internal' }, options)
    await callFn('stock.saveLocation', { id: 'customer', name: 'Customer', usage: 'customer' }, options)
    await callFn(
      'stock.adjustInventory',
      {
        id: 'adj',
        productId: 'p1',
        locationId: 'stock',
        inventoryLocationId: 'inventory',
        countedQuantity: '8',
        productUomId: 'unit',
      },
      options,
    )
    await callFn(
      'stock.addMove',
      {
        id: 'move',
        name: 'Áo',
        productId: 'p1',
        productUomId: 'unit',
        productUomQty: '8',
        locationId: 'stock',
        locationDestId: 'customer',
      },
      options,
    )

    const attempts = await Promise.allSettled(
      Array.from({ length: 8 }, () => callFn('stock.reserveMove', { id: 'move' }, options)),
    )
    assert.ok(attempts.some((attempt) => attempt.status === 'fulfilled'))
    const quant = (
      await a.all('SELECT quantity, "reservedQuantity" FROM stock_quant WHERE "locationId" = $1', ['stock'])
    )[0]!
    assert.equal(quant.quantity, '8')
    assert.equal(quant.reservedQuantity, '8', 'the mirror never exceeds on-hand quantity')
    const lines = await a.all('SELECT quantity FROM stock_move_line WHERE "moveId" = $1', ['move'])
    assert.equal(
      lines.reduce((sum, line) => sum + Number(line.quantity), 0),
      8,
      'MoveLine remains the reservation authority',
    )
  })
})

test('live pg: concurrent accounting posts assign one gapless journal sequence', live, async () => {
  await withPg(async (a) => {
    const accountModules = [address, partner, company, uom, product, account]
    const accountManifest = compose(accountModules, { headless: true })
    const accountSchema = schemaFromManifest(accountManifest)
    for (const tableName of Object.keys(accountSchema.tables))
      await a.exec(`DROP TABLE IF EXISTS "${tableName}" CASCADE`)
    for (const sql of renderSql(planMigration(null, accountSchema), a)) await a.exec(sql)
    registerFunctions(accountModules)
    const options = { adapter: a, manifest: accountManifest, scope: SCOPE }
    await callFn('partner.savePartner', { id: 'company-party', kind: 'company', name: 'ACME' }, options)
    await callFn('company.saveCompany', { id: 'c1', partnerId: 'company-party', currency: 'VND' }, options)
    await callFn(
      'account.saveAccount',
      { id: 'bank', code: '1121', name: 'Bank', accountType: 'asset_cash' },
      options,
    )
    await callFn(
      'account.saveAccount',
      { id: 'revenue', code: '5111', name: 'Revenue', accountType: 'income' },
      options,
    )
    await callFn(
      'account.saveJournal',
      { id: 'general', name: 'Miscellaneous', code: 'MISC', type: 'general' },
      options,
    )
    for (let index = 1; index <= 8; index += 1) {
      const id = `entry-${index}`
      await callFn(
        'account.createMove',
        { id, journalId: 'general', moveType: 'entry', date: '2026-08-20T00:00:00.000Z' },
        options,
      )
      await callFn(
        'account.addMoveLine',
        { id: `${id}:debit`, moveId: id, name: 'Debit', accountId: 'bank', debit: '1' },
        options,
      )
      await callFn(
        'account.addMoveLine',
        { id: `${id}:credit`, moveId: id, name: 'Credit', accountId: 'revenue', credit: '1' },
        options,
      )
    }

    const posted = await Promise.all(
      Array.from({ length: 8 }, (_, index) =>
        callFn('account.postMove', { id: `entry-${index + 1}` }, options),
      ),
    )
    assert.deepEqual(
      posted.map((result) => String((result.value as { name: string }).name)).sort(),
      Array.from({ length: 8 }, (_, index) => `MISC/2026/${String(index + 1).padStart(5, '0')}`),
    )
  })
})

test('live pg: concurrent RFQs assign one gapless purchase sequence', live, async () => {
  await withPg(async (a) => {
    const purchaseModules = [address, partner, company, uom, product, stock, account, purchase]
    const purchaseManifest = compose(purchaseModules, { headless: true })
    const purchaseSchema = schemaFromManifest(purchaseManifest)
    for (const tableName of Object.keys(purchaseSchema.tables))
      await a.exec(`DROP TABLE IF EXISTS "${tableName}" CASCADE`)
    for (const sql of renderSql(planMigration(null, purchaseSchema), a)) await a.exec(sql)
    registerFunctions(purchaseModules)
    const options = { adapter: a, manifest: purchaseManifest, scope: SCOPE }
    await callFn('partner.savePartner', { id: 'company-party', kind: 'company', name: 'ACME' }, options)
    await callFn('partner.savePartner', { id: 'vendor', kind: 'company', name: 'Vendor' }, options)
    await callFn('company.saveCompany', { id: 'c1', partnerId: 'company-party', currency: 'VND' }, options)
    await callFn('stock.saveLocation', { id: 'supplier', name: 'Vendors', usage: 'supplier' }, options)
    await callFn('stock.saveLocation', { id: 'stock', name: 'Stock', usage: 'internal' }, options)
    await callFn(
      'stock.savePickingType',
      {
        id: 'incoming',
        name: 'Receipts',
        code: 'incoming',
        defaultLocationSrcId: 'supplier',
        defaultLocationDestId: 'stock',
      },
      options,
    )

    const created = await Promise.all(
      Array.from({ length: 8 }, (_, index) =>
        callFn(
          'purchase.createOrder',
          {
            id: `po-${index + 1}`,
            partnerId: 'vendor',
            partnerRef: `V-${index + 1}`,
            pickingTypeId: 'incoming',
          },
          options,
        ),
      ),
    )
    assert.deepEqual(
      created.map((result) => String((result.value as { name: string }).name)).sort(),
      Array.from({ length: 8 }, (_, index) => `PO${String(index + 1).padStart(5, '0')}`),
    )
  })
})

test('live pg: concurrent quotations assign one gapless sales sequence', live, async () => {
  await withPg(async (a) => {
    const saleModules = [address, partner, company, uom, product, pricing, stock, account, sale]
    const saleManifest = compose(saleModules, { headless: true })
    const saleSchema = schemaFromManifest(saleManifest)
    for (const tableName of Object.keys(saleSchema.tables))
      await a.exec(`DROP TABLE IF EXISTS "${tableName}" CASCADE`)
    for (const sql of renderSql(planMigration(null, saleSchema), a)) await a.exec(sql)
    registerFunctions(saleModules)
    const options = { adapter: a, manifest: saleManifest, scope: SCOPE }
    await callFn('partner.savePartner', { id: 'company-party', kind: 'company', name: 'ACME' }, options)
    await callFn('partner.savePartner', { id: 'customer', kind: 'company', name: 'Customer' }, options)
    await callFn('company.saveCompany', { id: 'c1', partnerId: 'company-party', currency: 'VND' }, options)
    await callFn('stock.saveWarehouse', { id: 'wh', name: 'Main', code: 'WH' }, options)
    const created = await Promise.all(
      Array.from({ length: 8 }, (_, index) =>
        callFn(
          'sale.createOrder',
          { id: `so-${index + 1}`, partnerId: 'customer', warehouseId: 'wh' },
          options,
        ),
      ),
    )
    assert.deepEqual(
      created.map((result) => String((result.value as { name: string }).name)).sort(),
      Array.from({ length: 8 }, (_, index) => `S${String(index + 1).padStart(5, '0')}`),
    )
  })
})

test('live pg: concurrent POS orders assign one session-unique gapless sequence', live, async () => {
  await withPg(async (a) => {
    const posModules = [address, partner, company, user, uom, product, pricing, stock, account, pos]
    const posManifest = compose(posModules, { headless: true }),
      posSchema = schemaFromManifest(posManifest)
    for (const tableName of Object.keys(posSchema.tables))
      await a.exec(`DROP TABLE IF EXISTS "${tableName}" CASCADE`)
    for (const sql of renderSql(planMigration(null, posSchema), a)) await a.exec(sql)
    registerFunctions(posModules)
    const options = { adapter: a, manifest: posManifest, scope: SCOPE }
    await callFn('partner.savePartner', { id: 'company-party', kind: 'company', name: 'ACME' }, options)
    await callFn('company.saveCompany', { id: 'c1', partnerId: 'company-party', currency: 'VND' }, options)
    await callFn(
      'user.createUser',
      { id: 'cashier', login: 'cashier', password: 'correct horse', name: 'Cashier', defaultCompanyId: 'c1' },
      options,
    )
    await callFn('stock.saveWarehouse', { id: 'wh', name: 'Main', code: 'WH' }, options)
    await callFn(
      'account.saveAccount',
      { id: 'revenue', code: '5111', name: 'Revenue', accountType: 'income' },
      options,
    )
    await callFn(
      'account.saveAccount',
      { id: 'receivable', code: '131', name: 'Receivable', accountType: 'asset_receivable' },
      options,
    )
    await callFn('account.saveJournal', { id: 'sales', name: 'Sales', code: 'SAL', type: 'sale' }, options)
    await callFn(
      'pos.saveConfig',
      {
        id: 'shop',
        name: 'Shop',
        warehouseId: 'wh',
        salesJournalId: 'sales',
        revenueAccountId: 'revenue',
        receivableAccountId: 'receivable',
      },
      options,
    )
    await callFn('pos.createSession', { id: 'session', configId: 'shop', userId: 'cashier' }, options)
    await callFn('pos.openSession', { id: 'session' }, options)
    const created = await Promise.all(
      Array.from({ length: 8 }, (_, index) =>
        callFn(
          'pos.createOrder',
          { id: `pos-${index + 1}`, uuid: `offline-${index + 1}`, sessionId: 'session' },
          options,
        ),
      ),
    )
    assert.deepEqual(
      created.map((result) => String((result.value as { name: string }).name)).sort(),
      Array.from({ length: 8 }, (_, index) => `Order ${String(index + 1).padStart(5, '0')}`),
    )
  })
})

test('live pg: OAuth provider, identity and transaction races settle atomically', live, async () => {
  await withPg(async (a) => {
    const oauthModules = [address, partner, company, user, oauth]
    const oauthManifest = compose(oauthModules, { headless: true })
    const oauthSchema = schemaFromManifest(oauthManifest)
    for (const tableName of Object.keys(oauthSchema.tables))
      await a.exec(`DROP TABLE IF EXISTS "${tableName}" CASCADE`)
    for (const sql of renderSql(planMigration(null, oauthSchema), a)) await a.exec(sql)
    registerFunctions(oauthModules)
    const options = {
      adapter: a,
      manifest: oauthManifest,
      scope: {
        company: 'c1',
        companies: ['c1'],
        branch: 'root:c1',
        branches: ['root:c1'],
      },
      actor: 'admin',
    }
    const anonymous = { ...options, actor: undefined }
    await callFn('partner.savePartner', { id: 'company-party', kind: 'company', name: 'ACME' }, anonymous)
    await callFn(
      'company.saveCompany',
      { id: 'c1', code: 'ACME', partnerId: 'company-party', currency: 'VND' },
      anonymous,
    )
    for (const id of ['admin', 'operator']) {
      await callFn(
        'user.createUser',
        {
          id,
          login: id,
          password: 'correct horse battery staple',
          name: id === 'admin' ? 'Administrator' : 'Operator',
          superuser: id === 'admin',
          defaultCompanyId: 'c1',
          defaultBranchId: 'root:c1',
        },
        anonymous,
      )
      await callFn('user.grantCompany', { id: `${id}:c1`, userId: id, companyId: 'c1' }, options)
    }

    const providerAttempts = await Promise.all(
      Array.from({ length: 8 }, (_, index) =>
        callFn(
          'oauth.saveProvider',
          {
            id: `provider-${index}`,
            code: 'main',
            name: 'Identity Cloud',
            protocol: 'oidc',
            issuer: 'https://identity.example.test',
            clientId: 'ket-client',
            clientAuthMethod: 'none',
            scopes: 'openid profile email',
            redirectUri: 'https://suite.example.test/auth/oauth/main/callback',
            allowedAlgorithms: 'RS256',
            allowLinking: true,
            autoProvision: false,
            requireVerifiedEmail: true,
            active: true,
          },
          options,
        ),
      ),
    )
    assert.equal(
      providerAttempts.filter((attempt) => (attempt.value as { ok?: boolean }).ok === true).length,
      1,
      'the database unique indexes admit one provider configuration',
    )
    const providerId = String((await a.all('SELECT id FROM oauth_provider'))[0]?.id)

    const begun = (
      await callFn(
        'oauth.beginTransaction',
        {
          providerId,
          mode: 'login',
          discovery: {
            issuer: 'https://identity.example.test',
            authorizationEndpoint: 'https://identity.example.test/oauth/v2/authorize',
            tokenEndpoint: 'https://identity.example.test/oauth/v2/token',
            jwksUri: 'https://identity.example.test/oauth/v2/keys',
          },
        },
        anonymous,
      )
    ).value as { state: string }
    const claims = await Promise.all(
      Array.from({ length: 16 }, () =>
        callFn('oauth.claimTransaction', { providerId, state: begun.state }, anonymous),
      ),
    )
    assert.equal(
      claims.filter((claim) => (claim.value as { ok?: boolean }).ok === true).length,
      1,
      'compare-and-set consumes the state exactly once',
    )

    const identityAttempts = await Promise.all(
      ['admin', 'operator'].map((userId) =>
        callFn(
          'oauth.linkIdentity',
          {
            id: `identity:${userId}`,
            providerId,
            userId,
            subject: 'shared-subject',
          },
          options,
        ),
      ),
    )
    assert.equal(
      identityAttempts.filter((attempt) => (attempt.value as { ok?: boolean }).ok === true).length,
      1,
      'a verified issuer subject cannot be linked to two users',
    )
    assert.equal(
      (await a.all('SELECT id FROM oauth_external_identity WHERE subject = $1', ['shared-subject'])).length,
      1,
    )

    await callFn(
      'user.createUser',
      {
        id: 'oidc-only',
        login: 'oidc-only',
        name: 'OIDC only',
        defaultCompanyId: 'c1',
        defaultBranchId: 'root:c1',
      },
      anonymous,
    )
    await callFn('user.grantCompany', { id: 'oidc-only:c1', userId: 'oidc-only', companyId: 'c1' }, options)
    for (const subject of ['oidc-one', 'oidc-two'])
      await callFn(
        'oauth.linkIdentity',
        {
          id: `identity:${subject}`,
          providerId,
          userId: 'oidc-only',
          subject,
        },
        options,
      )
    const unlinks = await Promise.all(
      ['oidc-one', 'oidc-two'].map((subject) =>
        callFn('oauth.unlinkIdentity', { id: `identity:${subject}` }, options),
      ),
    )
    assert.equal(
      unlinks.filter((attempt) => (attempt.value as { ok?: boolean }).ok === true).length,
      1,
      'security-version CAS preserves one login method under concurrent unlink',
    )
    assert.equal(
      (await a.all('SELECT id FROM oauth_external_identity WHERE "userId" = $1', ['oidc-only'])).length,
      1,
    )
  })
})
