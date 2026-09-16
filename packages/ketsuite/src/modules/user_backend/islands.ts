import { defineRecordModalIsland } from '../../ui/record-modal.tsx'

/**
 * The users and roles collections open their records in client-side modals
 * (KetSuite record-modal contract), including their create actions.
 * `backend:runtime` places the closed hosts on every admin page, so a link naming
 * a record opens it.
 */
export const USER_MODAL_ISLANDS = {
  'user.user-modal': { kind: 'user.user', client: 'user-modal.mjs', export: 'userModal' },
  'user.role-modal': { kind: 'user.role', client: 'role-modal.mjs', export: 'roleModal' },
} as const

export const islands = Object.fromEntries(
  Object.entries(USER_MODAL_ISLANDS).map(([name, island]) => [
    name,
    defineRecordModalIsland({ kind: island.kind, client: island.client, export: island.export }),
  ]),
)
