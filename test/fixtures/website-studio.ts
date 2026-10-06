import assert from 'node:assert/strict'
import type { Row, OpenStorage } from '@ketvietlab/ketjs'
import { createTestDeployment } from '@ketvietlab/ketjs/testing'
import { websiteBackendWith } from '@ketvietlab/ketsuite'
import type { StudioOptions } from '@ketvietlab/ketsuite'
import { createCommerceDeployment } from '@ketvietlab/ketsuite/deployment'
import { ketsuite } from '../../apps/ketsuite/deployment.ts'

export async function bootWebsiteStudio(
  port?: number,
  options: {
    worker?: boolean
    openStorage?: OpenStorage
    studio?: StudioOptions
    deployment?: 'commerce'
  } = {},
) {
  const { studio } = options
  const deployment = options.deployment === 'commerce' ? createCommerceDeployment() : ketsuite
  const app = await createTestDeployment(
    {
      ...deployment,
      ...(studio
        ? {
            modules: deployment.modules.map((m) =>
              typeof m === 'object' && m.name === 'website_backend' ? websiteBackendWith(studio) : m,
            ),
          }
        : {}),
      ...(options.openStorage ? { serve: { ...deployment.serve, openStorage: options.openStorage } } : {}),
    },
    { worker: options.worker ?? false, ...(port ? { port } : {}) },
  )
  const fixture = async (name: string, input: Row, company = 'studio-a') => {
    const value = (await app.fixture.call<Row>(name, input, { scope: { company, branches: null } })).value
    assert.notEqual(value?.ok, false, `${name}: ${JSON.stringify(value)}`)
    return value
  }
  try {
    for (const company of ['studio-a', 'studio-b']) {
      await fixture('partner.savePartner', { id: `${company}-partner`, kind: 'company', name: company })
      await fixture('company.saveCompany', {
        id: company,
        code: company,
        partnerId: `${company}-partner`,
        currency: 'VND',
      })
    }
    await fixture('company.saveBranch', {
      id: 'studio-a:north',
      companyId: 'studio-a',
      parentId: 'root:studio-a',
      code: 'NORTH',
      name: 'Miền Bắc',
    })
    for (const [site, company] of [
      ['site-a', 'studio-a'],
      ['site-a2', 'studio-a'],
      ['site-b', 'studio-b'],
    ]) {
      await fixture(
        'website.saveSite',
        { id: site, name: site, title: site, theme: 'theme_paper', defaultLocale: 'vi', active: true },
        company,
      )
      await fixture(
        'website.saveEntry',
        {
          id: `page-${site}`,
          siteId: site,
          type: 'website.page',
          title: `Trang ${site}`,
          path: '/',
          slug: 'home',
          fields: {},
          layout: [
            {
              id: `n-${site}`,
              type: 'website.rich_text',
              settings: { heading: `Trang ${site}`, body: 'Nội dung website' },
            },
          ],
        },
        company,
      )
    }
    const revision = async () => (await fixture('user.authorizationState', {})).revision
    for (const role of ['reader', 'editor', 'publisher', 'designer']) {
      await fixture('user.applyRoleTemplate', {
        roleId: `studio-${role}`,
        templateKey: `website.${role}`,
        expectedRoleRevision: 0,
        expectedAuthorizationRevision: await revision(),
        idempotencyKey: `apply-${role}`,
      })
    }
    const assign = async (userId: string, role: string, companyId = 'studio-a', branchId?: string) => {
      const id = `${userId}-${companyId}-${role}-${branchId ?? 'company'}`
      await fixture('user.assignScopedRole', {
        id,
        userId,
        roleId: `studio-${role}`,
        scopeKind: branchId ? 'branch' : 'company',
        companyId,
        ...(branchId ? { branchId } : {}),
        expectedAuthorizationRevision: await revision(),
        idempotencyKey: id,
      })
    }
    for (const user of ['reader', 'editor', 'publisher', 'designer', 'blocked', 'mover', 'branch']) {
      await fixture('user.createUser', {
        id: `studio-${user}`,
        login: `studio-${user}`,
        password: 'studio-local',
        name: `Website ${user}`,
        defaultCompanyId: 'studio-a',
      })
      await fixture('user.grantCompany', { id: `${user}-a`, userId: `studio-${user}`, companyId: 'studio-a' })
      if (['reader', 'editor', 'publisher', 'designer'].includes(user)) await assign(`studio-${user}`, user)
    }
    await fixture('user.grantCompany', { id: 'mover-b', userId: 'studio-mover', companyId: 'studio-b' })
    await assign('studio-mover', 'editor')
    await assign('studio-mover', 'reader', 'studio-b')
    await fixture('user.grantBranch', {
      id: 'branch-north',
      userId: 'studio-branch',
      branchId: 'studio-a:north',
    })
    await assign('studio-branch', 'reader')
    await assign('studio-branch', 'editor', 'studio-a', 'studio-a:north')
    return { app, fixture, revision }
  } catch (error) {
    await app.close()
    throw error
  }
}
