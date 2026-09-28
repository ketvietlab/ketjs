import { defineRecordModalIsland } from '../../ui/record-modal.tsx'

/**
 * The users collection opens its records in a client-side modal (KetSuite
 * record-modal contract), including its create action. `backend:runtime` places
 * the closed host on every admin page, so a link naming a record opens it.
 *
 * The role modal is read-only for managed roles; custom-role authoring has no product route.
 */
export const USER_MODAL_ISLANDS = {
  'user.access-policy-modal': {
    kind: 'user.accessPolicy',
    client: 'access-policy-modal.mjs',
    export: 'accessPolicyModal',
  },
  'user.user-modal': { kind: 'user.user', client: 'user-modal.mjs', export: 'userModal' },
} as const

export const islands = Object.fromEntries(
  Object.entries(USER_MODAL_ISLANDS).map(([name, island]) => [
    name,
    defineRecordModalIsland({ kind: island.kind, client: island.client, export: island.export }),
  ]),
)
