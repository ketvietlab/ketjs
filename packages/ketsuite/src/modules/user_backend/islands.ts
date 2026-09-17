import { defineRecordModalIsland } from '../../ui/record-modal.tsx'

/**
 * The users collection opens its records in a client-side modal (KetSuite
 * record-modal contract), including its create action. `backend:runtime` places
 * the closed host on every admin page, so a link naming a record opens it.
 *
 * The role modal (`user.role-modal`, `role-modal.mjs`) is not registered while the
 * roles screen is off; see the note in routes.ts.
 */
export const USER_MODAL_ISLANDS = {
  'user.user-modal': { kind: 'user.user', client: 'user-modal.mjs', export: 'userModal' },
} as const

export const islands = Object.fromEntries(
  Object.entries(USER_MODAL_ISLANDS).map(([name, island]) => [
    name,
    defineRecordModalIsland({ kind: island.kind, client: island.client, export: island.export }),
  ]),
)
