import { defineRecordModalIsland } from '../../ui/record-modal.tsx'

/**
 * The users collection opens a person in a client-side modal (KetSuite
 * record-modal contract), including its create action. `backend:runtime` places
 * the closed host on every admin page, so a link naming a record opens it.
 */
export const USER_MODAL_ISLANDS = {
  'user.user-modal': { kind: 'user.user', export: 'userModal' },
} as const

export const islands = Object.fromEntries(
  Object.entries(USER_MODAL_ISLANDS).map(([name, island]) => [
    name,
    defineRecordModalIsland({ kind: island.kind, client: 'user-modal.mjs', export: island.export }),
  ]),
)
