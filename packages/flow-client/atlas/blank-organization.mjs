// Atlas-only: an organization Két Việt has just created. Its owner signs in with the password Két Việt issued, must replace it, and then finds nothing but the default catalogs.
const fail = (code, message, fields = {}) => ({
  ok: true,
  value: { ok: false, errors: [{ code, message }], fields },
})

/** The mock owner credential; Atlas shows it on the sign-in page because no real account exists. */
export const BLANK_OWNER = {
  id: 'mai',
  name: 'Mai Anh',
  email: 'mai@hoasen.example',
  password: 'HoaSen-2026',
}
export const BLANK_COMPANY = { id: 'demo', name: 'Hoa Sen Studio' }
export const PASSWORD_MIN = 10

/** Empties every collection a fixture session carries, keeping the organization, its owner and the built-in task statuses and types. */
export function clearOrganization(d) {
  d.company = BLANK_COMPANY
  d.companies = [BLANK_COMPANY]
  d.user = { id: BLANK_OWNER.id, name: BLANK_OWNER.name }
  d.members = [
    { id: BLANK_OWNER.id, name: BLANK_OWNER.name, email: BLANK_OWNER.email, role: 'owner', status: 'active' },
  ]
  d.people = [BLANK_OWNER.name]
  for (const key of [
    'workspaces',
    'projects',
    'tasks',
    'pages',
    'comments',
    'sprints',
    'epics',
    'forms',
    'formResponses',
    'views',
    'inbox',
    'history',
    'files',
    'teams',
    'grants',
    'invitations',
    'projectFavorites',
    'recentProjects',
    'fields',
    'tags',
  ])
    d[key] = []
}

/** Where an Atlas link drops the owner: `blank` at sign-in, `blank-password` signed in with the issued password, `blank-onboarding` with nothing created yet, `blank-workspace` in a first workspace made today. */
export const blankStages = ['blank', 'blank-password', 'blank-onboarding', 'blank-workspace']
export const FIRST_WORKSPACE = { id: 'first', title: 'Sản phẩm' }

/** Adds the workspace the onboarding's first step would have created, so its checklist can be opened directly. */
export function seedFirstWorkspace(d) {
  d.workspaces = [
    {
      ...FIRST_WORKSPACE,
      companyId: BLANK_COMPANY.id,
      description: '',
      access: 'internal',
      memberIds: [],
      archived: false,
      createdAt: new Date().toISOString(),
    },
  ]
}

/** Sign-in state for one Atlas session. Until the owner signs in every call is unauthenticated; until they replace the issued password, only that replacement is allowed. */
export function createAccount(stage = 'blank') {
  const at = blankStages.indexOf(stage)
  const state = {
    signedIn: at >= 1,
    mustChangePassword: at < 2,
    password: at < 2 ? BLANK_OWNER.password : 'owner-password',
  }
  const gate = (name) =>
    !state.signedIn && name !== 'flow.auth.signIn'
      ? fail('unauthenticated', 'Đăng nhập để tiếp tục.')
      : state.signedIn && state.mustChangePassword && !name.startsWith('flow.auth.')
        ? fail('password_change', 'Đặt mật khẩu mới trước khi vào Flow.')
        : null
  function command(name, args = {}) {
    if (name === 'flow.auth.signIn') {
      if (
        String(args.email ?? '')
          .trim()
          .toLowerCase() !== BLANK_OWNER.email ||
        args.password !== state.password
      )
        return fail('credentials', 'Email hoặc mật khẩu chưa đúng.', {
          password: 'Email hoặc mật khẩu chưa đúng.',
        })
      state.signedIn = true
      return { ok: true, value: { mustChangePassword: state.mustChangePassword } }
    }
    if (name === 'flow.auth.setPassword') {
      const password = String(args.password ?? '')
      if (password.length < PASSWORD_MIN)
        return fail('validation', `Mật khẩu cần ít nhất ${PASSWORD_MIN} ký tự.`, {
          password: `Mật khẩu cần ít nhất ${PASSWORD_MIN} ký tự.`,
        })
      if (password === BLANK_OWNER.password)
        return fail('validation', 'Chọn mật khẩu khác mật khẩu được cấp.', {
          password: 'Chọn mật khẩu khác mật khẩu được cấp.',
        })
      if (args.confirm !== password)
        return fail('validation', 'Hai mật khẩu chưa khớp.', { confirm: 'Hai mật khẩu chưa khớp.' })
      state.password = password
      state.mustChangePassword = false
      return { ok: true, value: {} }
    }
    return null
  }
  return { gate, command, state }
}
