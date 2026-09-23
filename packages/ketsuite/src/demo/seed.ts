import { bootRuntime, callFn, migrateOne, sqliteStore } from '@ketvietlab/ketjs'
import type { DeploymentSpec } from '@ketvietlab/ketjs'
import { ketsuite } from '../deployment.ts'
import { seedPartners } from './partner.ts'
import { seedProducts } from './product.ts'
import { seedCrm } from './crm.ts'
import { seedStock } from './stock.ts'
import { seedSale } from './sale.ts'
import { seedPurchase } from './purchase.ts'
import { seedStaff } from './user.ts'
import type { Call, Row } from './util.ts'

/** The marker this seed checks for before touching anything else — see the idempotency note below. */
const MARKER_PARTNER_ID = 'demo-partner-hoang-long'

/**
 * Seed a demo dataset — partners, a product catalog, CRM cases, warehouses,
 * sales and purchase orders, and a few extra staff logins — onto the company
 * `--dev-admin` already created. Reachable only from `ketsuite serve
 * --demo-data`, the same explicit, local-development-only path as
 * `ensureDevelopmentAdmin`.
 *
 * Idempotent the same way: a fixed-id partner acts as the marker. If it is
 * already there, this returns `'exists'` without seeding anything else, so
 * restarting the dev server never duplicates the dataset.
 */
export async function seedDemoData(
  spec: DeploymentSpec = ketsuite,
  env: Record<string, string | undefined> = process.env,
): Promise<'seeded' | 'exists'> {
  if (!spec.serve) throw new Error(`app "${spec.name}" declares no serve block`)
  const runtime = await bootRuntime(spec, { env })
  const adapter = await (spec.serve.openStore ?? sqliteStore)(runtime.config)
  try {
    await migrateOne(adapter, runtime.manifest)
    // `actor: null`, not `'system:scaffold'` — `user.createUser` (used below for
    // the staff logins) refuses to set a password at all once `ctx.actor` is
    // truthy, of any value, not just an authenticated one.
    const boot = { adapter, manifest: runtime.manifest, actor: null, scope: { company: null, branch: null } }

    const marker = await callFn('partner.getPartner', { id: MARKER_PARTNER_ID }, boot)
    if (marker.value) return 'exists'

    // `user.createUser` refuses a password once an authenticated actor is
    // calling it ("an agent that can mint logins is an agent that can mint
    // itself one") — the same reason `ensureDevelopmentAdmin` creates `admin`
    // at this same unauthenticated, system-only level.
    const systemCall: Call = async (name, input) => {
      const result = await callFn(name, input, boot)
      const value = result.value as Row | null
      if (value && value.ok === false) throw new Error(`${name}: ${JSON.stringify(value.errors ?? value)}`)
      return value as Row
    }

    const companies = (await callFn('company.listCompanies', {}, boot)).value as Row[]
    const company = companies[0]
    if (!company)
      throw new Error(
        'no company found — run with --dev-admin (or --demo-data, which already implies it) first',
      )
    const branches = (await callFn('company.listBranches', { companyId: company.id }, boot)).value as Row[]
    const branch = branches.find((row) => row.isRoot) ?? branches[0]
    if (!branch) throw new Error(`company "${String(company.id)}" has no branch to seed into`)
    const admins = (await callFn('user.listUsers', { search: 'admin', limit: 1 }, boot)).value as Row[]
    const admin = admins[0]
    if (!admin) throw new Error('no admin user found — run with --dev-admin first')

    const companyId = String(company.id)
    const branchId = String(branch.id)
    const ctx = {
      adapter,
      manifest: runtime.manifest,
      actor: String(admin.id),
      scope: { company: companyId, companies: [companyId], branch: branchId, branches: [branchId] },
    }
    const call: Call = async (name, input) => {
      const result = await callFn(name, input, ctx)
      const value = result.value as Row | null
      if (value && value.ok === false) throw new Error(`${name}: ${JSON.stringify(value.errors ?? value)}`)
      return value as Row
    }

    await seedPartners(call)
    const products = await seedProducts(call)
    const stock = await seedStock(call)
    await seedCrm(call)
    await seedSale(call, products.catalog, stock.mainWarehouseId)
    await seedPurchase(call, products.catalog, stock.receivingPickingTypeId)
    await seedStaff(systemCall, companyId, branchId)

    return 'seeded'
  } finally {
    await adapter.close()
  }
}
