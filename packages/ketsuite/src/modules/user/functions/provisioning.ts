import { randomUUID } from 'node:crypto'
import { defineFn, from } from '@ketvietlab/ketjs'
import type { Ctx, FnSpec } from '@ketvietlab/ketjs'
import { hashPassword } from '../password.ts'

import { type Issue, issue, invalid, normalizeLogin, audit, lockSecurityGuard } from './shared.ts'

export async function provisionAdminHandler(ctx: Ctx, a: Record<string, unknown>) {
  const developmentScaffold = ctx.actor === 'system:scaffold'
  if (ctx.actor !== 'system:provision' && !developmentScaffold)
    return invalid([issue('adminLogin', 'user.error.provisionActor')])
  const companyName = String(a.companyName).trim()
  const companyCode = String(a.companyCode).trim().toUpperCase()
  const currency = String(a.currency).trim().toUpperCase()
  const adminLogin = normalizeLogin(a.adminLogin)
  const adminName = String(a.adminName).trim()
  const adminEmail = String(a.adminEmail ?? '').trim() || null
  const adminPassword = String(a.adminPassword)
  const errors: Issue[] = []
  for (const [field, value] of [
    ['companyName', companyName],
    ['companyCode', companyCode],
    ['currency', currency],
    ['adminLogin', adminLogin],
    ['adminName', adminName],
  ] as const)
    if (!value) errors.push(issue(field, 'user.error.required'))
  const scaffoldCredential = developmentScaffold && adminLogin === 'admin' && adminPassword === 'admin'
  if (adminPassword.length < 8 && !scaffoldCredential)
    errors.push(issue('adminPassword', 'user.error.passwordLength'))
  if (errors.length) return invalid(errors)

  const U = ctx.table('user.User')
  const C = ctx.table('company.Company')
  if ((await ctx.db.count(from(U))) > 0 || (await ctx.db.count(from(C))) > 0)
    return invalid([issue('adminLogin', 'user.error.provisionExists')])

  const companyId = randomUUID()
  const partnerId = randomUUID()
  const branchId = `root:${companyId}`
  const userId = randomUUID()
  const passwordHash = await hashPassword(adminPassword)
  return ctx.tx(async (tx) => {
    await lockSecurityGuard(tx, 'provision-admin')
    const TXU = tx.table('user.User')
    const TXC = tx.table('company.Company')
    if ((await tx.db.count(from(TXU))) > 0 || (await tx.db.count(from(TXC))) > 0)
      return invalid([issue('adminLogin', 'user.error.provisionExists')])

    await tx.db.insert('partner.Partner', {
      id: partnerId,
      kind: 'company',
      name: companyName,
      parentId: null,
      vat: null,
      ref: companyCode,
      email: null,
      phone: null,
      lang: null,
      active: true,
    })
    await tx.db.insert('company.Company', {
      id: companyId,
      code: companyCode,
      partnerId,
      parentId: null,
      currency,
      active: true,
      version: 1,
    })
    await tx.db.insert('company.Branch', {
      id: branchId,
      companyId,
      code: companyCode,
      name: companyName,
      parentId: null,
      rootKey: companyId,
      active: true,
    })
    await tx.db.insert('user.User', {
      id: userId,
      login: adminLogin,
      passwordHash,
      partnerId: null,
      name: adminName,
      email: adminEmail,
      lang: null,
      defaultCompanyId: companyId,
      defaultBranchId: branchId,
      accessKind: 'internal',
      securityVersion: 0,
      lastLoginAt: null,
      superuser: true,
      active: true,
    })
    await tx.db.insert('user.Membership', {
      id: `company:${userId}:${companyId}`,
      userId,
      companyId,
    })
    await tx.db.insert('user.BranchMembership', {
      id: `branch:${userId}:${branchId}`,
      userId,
      branchId,
    })
    await audit(tx, 'provision.admin', userId, undefined, {
      companyId,
      branchId,
    })
    return { ok: true, companyId, branchId, partnerId, userId }
  })
}

export const provisioningFunctions: Record<string, FnSpec> = {
  provisionAdmin: defineFn({
    exposure: 'internal',
    provision: true,
    input: {
      companyName: 'text',
      companyCode: 'text',
      currency: 'text',
      adminLogin: 'text',
      adminName: 'text',
      adminEmail: 'text?',
      adminPassword: 'text',
    },
    output: {
      ok: 'bool',
      companyId: 'id?',
      branchId: 'id?',
      partnerId: 'id?',
      userId: 'id?',
      errors: 'json?',
    },
    effects: [
      'read:partner.Partner',
      'write:partner.Partner',
      'read:company.Company',
      'write:company.Company',
      'read:company.Branch',
      'write:company.Branch',
      'read:user.User',
      'write:user.User',
      'write:user.Membership',
      'write:user.BranchMembership',
      'read:user.SecurityGuard',
      'write:user.SecurityGuard',
      'write:user.SecurityAudit',
    ],
    handler: provisionAdminHandler,
  }),
}
