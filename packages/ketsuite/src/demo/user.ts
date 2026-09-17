// Phase 1 of the `--demo-data` seed: a handful of extra staff logins.
//
// Not padded to 30+ — a single-company demo genuinely has a small team, and
// inventing headcount just to fill a page is exactly the fake volume the
// content bar rules out (see stock.ts for the same call on warehouses).
// Every login's password is the same fixed, clearly-labeled demo password —
// printed by the CLI so a developer can actually sign in as one of them.

import type { Call } from './util.ts'

export const STAFF_PASSWORD = 'ketsuite-demo-2026'

type StaffSeed = { id: string; login: string; name: string; email: string }

const STAFF: StaffSeed[] = [
  { id: 'demo-user-lan-anh', login: 'lan.anh', name: 'Nguyễn Thị Lan Anh', email: 'lan.anh@ketsuite.local' },
  { id: 'demo-user-van-bao', login: 'van.bao', name: 'Trần Văn Bảo', email: 'van.bao@ketsuite.local' },
  {
    id: 'demo-user-thu-huong',
    login: 'thu.huong',
    name: 'Lê Thị Thu Hường',
    email: 'thu.huong@ketsuite.local',
  },
  { id: 'demo-user-duc-toan', login: 'duc.toan', name: 'Phạm Đức Toàn', email: 'duc.toan@ketsuite.local' },
  { id: 'demo-user-kim-yen', login: 'kim.yen', name: 'Vũ Thị Kim Yến', email: 'kim.yen@ketsuite.local' },
  { id: 'demo-user-van-son', login: 'van.son', name: 'Hoàng Văn Sơn', email: 'van.son@ketsuite.local' },
]

export async function seedStaff(call: Call, companyId: string, branchId: string): Promise<string[]> {
  const ids: string[] = []
  for (const staff of STAFF) {
    await call('user.createUser', {
      id: staff.id,
      login: staff.login,
      password: STAFF_PASSWORD,
      name: staff.name,
      email: staff.email,
      defaultCompanyId: companyId,
      defaultBranchId: branchId,
      superuser: false,
    })
    await call('user.grantCompany', { id: `${staff.id}:${companyId}`, userId: staff.id, companyId })
    await call('user.grantBranch', { id: `${staff.id}:${branchId}`, userId: staff.id, branchId })
    ids.push(staff.id)
  }
  return ids
}
