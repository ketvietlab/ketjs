import { html, signal } from '@ketvietlab/ketjs-view'
import { tr } from './i18n.mjs'
import { FlowInput, FlowButton } from '@ketvietlab/flow-ui'
import { FlowEntryPage, FlowHint, FlowSelectField, FlowTextarea } from '@ketvietlab/flow-ui/workspace'
import { DEFAULT_CADENCE } from './sprint-cadence.mjs'

export const PASSWORD_MIN = 10
export const PROJECT_CODE = /^[A-Z][A-Z0-9]{1,11}$/
export const onboardingSteps = ['workspace', 'project', 'invite']
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** A project code suggested from its name: initials of up to four words, or the first four letters of a single word, without Vietnamese marks. Empty when no valid code comes out. */
export function projectCode(title) {
  const words =
    String(title)
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/đ/gi, 'd')
      .toUpperCase()
      .match(/[A-Z0-9]+/g) ?? []
  const code =
    words.length > 1
      ? words
          .slice(0, 4)
          .map((w) => w[0])
          .join('')
      : (words[0] ?? '').slice(0, 4)
  return PROJECT_CODE.test(code) ? code : ''
}

/** Addresses typed one per line or separated by commas: valid ones lowercased and deduplicated, the rest returned as typed. */
export function parseInvites(text) {
  const emails = [],
    invalid = []
  for (const raw of String(text).split(/[\s,;]+/)) {
    if (!raw) continue
    const email = raw.toLowerCase()
    if (!EMAIL.test(email)) invalid.push(raw)
    else if (!emails.includes(email)) emails.push(email)
  }
  return { emails, invalid }
}

/** The owner of a new organization before Flow has anything in it: sign in with the issued password, replace it, then create the first workspace, project and invitations.
 * ctx: {call, reload, data, finish(workspaceId), demo?:{email,password}} — `demo` is only ever passed by Atlas. */
export function createFirstRun(ctx) {
  const t = (key, values = []) => tr('flow.firstRun.' + key, values)
  const busy = signal(false),
    errors = signal(/** @type {Record<string,string>} */ ({})),
    step = signal(''),
    revision = signal(0)
  const created = { workspaceId: '', workspaceTitle: '', projectId: '' }
  const signIn = { email: '', password: '' },
    secret = { password: '', confirm: '' },
    workspace = { title: '', key: '' },
    project = { title: '', code: '', codeTouched: false, defaultView: 'board', plan: 'sprint', key: '' },
    invite = { emails: '', role: 'member' }
  const redraw = () => revision.set(revision() + 1)
  /** Runs one request; field errors land next to their field, anything else above the actions. */
  const run = async (
    /** @type {()=>Promise<void>} */ work,
    /** @type {Record<string,string>} */ codes = {},
  ) => {
    if (busy()) return
    busy.set(true)
    errors.set({})
    try {
      await work()
    } catch (/** @type {any} */ e) {
      const fields = e.fields ?? {}
      errors.set(
        codes[e.code]
          ? { [codes[e.code]]: t('error.' + e.code) }
          : Object.keys(fields).length
            ? fields
            : { form: e.message },
      )
    } finally {
      busy.set(false)
    }
  }
  const formError = () => (errors().form ? FlowHint({ tone: 'red', children: errors().form }) : null)
  const submit = (/** @type {string} */ label) =>
    FlowButton({ label, variant: 'primary', type: 'submit', loading: busy() })
  const brand = () => (ctx.data()?.company?.name ? `Flow · ${ctx.data().company.name}` : 'Flow')

  const signInPage = () => {
    revision()
    return FlowEntryPage({
      brand: brand(),
      title: t('signIn.title'),
      description: t('signIn.description'),
      onSubmit: (e) => {
        e.preventDefault()
        void run(
          async () => {
            await ctx.call('flow.auth.signIn', { email: signIn.email.trim(), password: signIn.password })
            signIn.password = ''
            await ctx.reload()
          },
          { credentials: 'password' },
        )
      },
      children: html`${FlowInput({
        id: 'sign-in-email',
        label: t('email'),
        type: 'email',
        autocomplete: 'username',
        required: true,
        value: signIn.email,
        onInput: (e) => {
          signIn.email = /** @type {HTMLInputElement} */ (e.target).value
        },
      })}${FlowInput({
        id: 'sign-in-password',
        label: t('password'),
        type: 'password',
        autocomplete: 'current-password',
        required: true,
        value: signIn.password,
        error: errors().password,
        onInput: (e) => {
          signIn.password = /** @type {HTMLInputElement} */ (e.target).value
        },
      })}${formError()}${ctx.demo ? FlowHint({ tone: 'yellow', children: t('signIn.demo', [ctx.demo.email, ctx.demo.password]) }) : null}`,
      actions: submit(t('signIn.submit')),
      footer: t('signIn.help'),
    })
  }

  const passwordPage = () => {
    revision()
    const check = () =>
      secret.password.length < PASSWORD_MIN
        ? { password: t('password.short', [PASSWORD_MIN]) }
        : secret.confirm !== secret.password
          ? { confirm: t('password.mismatch') }
          : null
    return FlowEntryPage({
      brand: brand(),
      title: t('password.title'),
      description: t('password.description', [PASSWORD_MIN]),
      onSubmit: (e) => {
        e.preventDefault()
        const invalid = check()
        if (invalid) {
          errors.set(invalid)
          return
        }
        void run(async () => {
          await ctx.call('flow.auth.setPassword', { password: secret.password, confirm: secret.confirm })
          secret.password = secret.confirm = ''
          await ctx.reload()
        })
      },
      children: html`${FlowInput({
        id: 'new-password',
        label: t('password.new'),
        type: 'password',
        autocomplete: 'new-password',
        required: true,
        value: secret.password,
        error: errors().password,
        onInput: (e) => {
          secret.password = /** @type {HTMLInputElement} */ (e.target).value
        },
      })}${FlowInput({
        id: 'confirm-password',
        label: t('password.confirm'),
        type: 'password',
        autocomplete: 'new-password',
        required: true,
        value: secret.confirm,
        error: errors().confirm,
        onInput: (e) => {
          secret.confirm = /** @type {HTMLInputElement} */ (e.target).value
        },
      })}${formError()}`,
      actions: submit(t('password.submit')),
    })
  }

  /** Onboarding runs while the organization has no workspace, and keeps running through its own steps after the first one creates it. */
  const needed = () => {
    const d = ctx.data()
    return (
      Boolean(d) &&
      (step() !== '' || (d.workspaces?.length === 0 && d.capabilities?.manageOrganization === true))
    )
  }
  const current = () => step() || 'workspace'
  const organizationCommand = (/** @type {Record<string,unknown>} */ args, /** @type {string} */ key) =>
    ctx.call('flow.organization.command', {
      ...args,
      idempotencyKey: key,
      expectedRevision: ctx.data().organizationRevision,
    })

  const workspaceStep = () => ({
    title: t('workspace.title'),
    description: t('workspace.description'),
    onSubmit: (/** @type {Event} */ e) => {
      e.preventDefault()
      if (!workspace.title.trim()) {
        errors.set({ title: t('required') })
        return
      }
      workspace.key ||= crypto.randomUUID()
      void run(async () => {
        const value = await organizationCommand(
          { action: 'workspace.save', title: workspace.title.trim(), description: '', access: 'internal' },
          workspace.key,
        )
        Object.assign(created, { workspaceId: value.id, workspaceTitle: workspace.title.trim() })
        workspace.key = ''
        step.set('project')
        await ctx.reload()
      })
    },
    children: html`${FlowInput({
      id: 'workspace-title',
      label: t('workspace.name'),
      placeholder: t('workspace.placeholder'),
      required: true,
      value: workspace.title,
      error: errors().title,
      onInput: (e) => {
        workspace.title = /** @type {HTMLInputElement} */ (e.target).value
      },
    })}${FlowHint({ children: t('workspace.access', [ctx.data().company.name]) })}${formError()}`,
    actions: submit(t('continue')),
  })

  const projectStep = () => ({
    title: t('project.title'),
    description: t('project.description', [created.workspaceTitle]),
    onSubmit: (/** @type {Event} */ e) => {
      e.preventDefault()
      const invalid = !project.title.trim()
        ? { title: t('required') }
        : !PROJECT_CODE.test(project.code)
          ? { code: t('project.codeInvalid') }
          : null
      if (invalid) {
        errors.set(invalid)
        return
      }
      project.key ||= crypto.randomUUID()
      void run(async () => {
        const value = await ctx.call('flow.entity.save', {
          collection: 'projects',
          workspaceId: created.workspaceId,
          title: project.title.trim(),
          code: project.code,
          description: '',
          access: 'workspace',
          ownerId: ctx.data().user.id,
          defaultView: project.defaultView,
          sprintCadence: project.plan === 'sprint' ? { ...DEFAULT_CADENCE } : null,
          state: 'planned',
          tags: [],
          memberIds: [],
          teamIds: [],
          idempotencyKey: project.key,
        })
        created.projectId = value.id
        project.key = ''
        step.set('invite')
        await ctx.reload()
      })
    },
    children: html`${FlowInput({
      id: 'project-title',
      label: t('project.name'),
      placeholder: t('project.placeholder'),
      required: true,
      value: project.title,
      error: errors().title,
      onInput: (e) => {
        project.title = /** @type {HTMLInputElement} */ (e.target).value
        if (!project.codeTouched) {
          project.code = projectCode(project.title)
          redraw()
        }
      },
    })}${FlowInput({
      id: 'project-code',
      label: t('project.code'),
      placeholder: 'WEB',
      required: true,
      value: project.code,
      error: errors().code,
      onInput: (e) => {
        project.code = /** @type {HTMLInputElement} */ (e.target).value.toUpperCase()
        project.codeTouched = true
      },
    })}${errors().code ? null : FlowHint({ children: t('project.codeHint', [project.code || 'WEB']) })}${FlowSelectField(
      {
        name: 'project-view',
        label: t('project.view'),
        value: project.defaultView,
        options: [
          { value: 'board', label: tr('flow.ui.task.board') },
          { value: 'project-issues', label: tr('flow.ui.task.list') },
        ],
        onChange: (e) => {
          project.defaultView = /** @type {HTMLSelectElement} */ (e.target).value
        },
      },
    )}${FlowSelectField({
      name: 'project-plan',
      label: t('project.plan'),
      value: project.plan,
      options: [
        { value: 'sprint', label: t('project.sprint') },
        { value: 'kanban', label: t('project.kanban') },
      ],
      onChange: (e) => {
        project.plan = /** @type {HTMLSelectElement} */ (e.target).value
      },
    })}${FlowHint({ children: t('project.planHint') })}${formError()}`,
    actions: submit(t('project.submit')),
  })

  const finish = async () => {
    const id = created.workspaceId
    step.set('')
    await ctx.finish(id)
  }
  const inviteStep = () => ({
    title: t('invite.title'),
    description: t('invite.description'),
    onSubmit: (/** @type {Event} */ e) => {
      e.preventDefault()
      const { emails, invalid } = parseInvites(invite.emails)
      if (invalid.length) {
        errors.set({ emails: t('invite.invalid', [invalid.join(', ')]) })
        return
      }
      if (!emails.length) {
        errors.set({ emails: t('invite.none') })
        return
      }
      void run(async () => {
        const sent = []
        try {
          for (const email of emails) {
            await organizationCommand(
              { action: 'member.invite', email, role: invite.role },
              crypto.randomUUID(),
            )
            sent.push(email)
            await ctx.reload()
          }
        } catch (/** @type {any} */ error) {
          invite.emails = emails.filter((x) => !sent.includes(x)).join('\n')
          await ctx.reload()
          throw Object.assign(error, { fields: { emails: `${emails[sent.length]}: ${error.message}` } })
        }
        await finish()
      })
    },
    children: html`${FlowTextarea({
      id: 'invite-emails',
      label: t('invite.emails'),
      placeholder: t('invite.placeholder'),
      value: invite.emails,
      onInput: (e) => {
        invite.emails = /** @type {HTMLTextAreaElement} */ (e.target).value
      },
    })}${errors().emails ? FlowHint({ tone: 'red', children: errors().emails }) : FlowHint({ children: t('invite.hint') })}${FlowSelectField(
      {
        name: 'invite-role',
        label: t('invite.role'),
        value: invite.role,
        options: [
          { value: 'member', label: t('invite.member') },
          { value: 'admin', label: t('invite.admin') },
        ],
        onChange: (e) => {
          invite.role = /** @type {HTMLSelectElement} */ (e.target).value
        },
      },
    )}${formError()}`,
    actions: html`${FlowButton({ label: t('invite.skip'), variant: 'ghost', disabled: busy(), onClick: () => void run(finish) })}${submit(t('invite.submit'))}`,
  })

  const onboardingPage = () => {
    revision()
    const key = current(),
      at = onboardingSteps.indexOf(key)
    const page = key === 'workspace' ? workspaceStep() : key === 'project' ? projectStep() : inviteStep()
    return FlowEntryPage({
      brand: brand(),
      stepsLabel: t('steps'),
      steps: onboardingSteps.map((id, i) => ({
        id,
        label: t(id + '.step'),
        complete: i < at,
        current: i === at,
      })),
      ...page,
    })
  }

  return {
    /** Which first-run page a failed or empty bootstrap needs, or null when the normal app should render. */
    page(/** @type {{code?:string}|null} */ failure) {
      if (!ctx.data())
        return failure?.code === 'unauthenticated'
          ? signInPage()
          : failure?.code === 'password_change'
            ? passwordPage()
            : null
      return needed() ? onboardingPage() : null
    },
    step: current,
  }
}
