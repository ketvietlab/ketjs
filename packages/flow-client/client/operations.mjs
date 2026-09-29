import { tr, flowLocaleTag } from './i18n.mjs'
import { taskAssigneeNames } from './task-assignees.mjs'
import { taskColumns, isDone } from './project-catalogs.mjs'
import { html, each, signal } from '@ketvietlab/ketjs-view'
import {
  FlowButton,
  FlowInput,
  FlowTag,
  FlowEmpty,
  FlowSegmented,
  FlowAvatarGroup,
} from '@ketvietlab/flow-ui'
import {
  FlowSection,
  FlowStack,
  FlowInline,
  FlowToolbar,
  FlowTextarea,
  FlowSelectField,
  FlowDisclosure,
  FlowList,
  FlowListItem,
  FlowHint,
  FlowCalendar,
  FlowCalendarEvent,
} from '@ketvietlab/flow-ui/workspace'
import { calendarPeriod, projectTasks } from './operations-model.mjs'
import { canManageScope } from './access-model.mjs'
import { todayDate, shiftPeriod } from './timeline.mjs'
export const operationRoutes = new Set(['forms', 'calendar', 'inbox', 'saved-views', 'personal-settings'])
export function createOperations(ctx) {
  const d = ctx.data,
    editor = signal(''),
    selected = signal(''),
    formTab = signal('manage'),
    fields = signal([]),
    date = signal(''),
    scale = signal('month'),
    inboxTab = signal('unread')
  const stack = (...xs) =>
    FlowStack({
      children: html`${each(
        xs,
        (_, i) => i,
        (x) => html`${x}`,
      )}`,
    })
  const inline = (...xs) =>
    FlowInline({
      children: html`${each(
        xs,
        (_, i) => i,
        (x) => html`${x}`,
      )}`,
    })
  const btn = (label, fn, primary = false, disabled = false) =>
    FlowButton({
      label,
      onClick: fn,
      variant: primary ? 'primary' : 'secondary',
      size: 'sm',
      disabled: disabled || ctx.busy(),
    })
  const nav = (label, key, params = {}) => btn(label, () => ctx.navigate(key, params))
  const run = (action, args = {}, done) =>
    ctx.mutate(
      'flow.operations.command',
      {
        action,
        expectedRevision: d().operationsRevision,
        workspaceId: ctx.workspaceId(),
        projectId: ctx.projectId(),
        ...args,
      },
      done,
    )
  const input = (id, label, value = '', type = 'text', required = false) =>
    FlowInput({ id, label, value, type, required, disabled: !ctx.canWrite() })
  const select = (name, label, value, options, onChange) =>
    FlowSelectField({ name, label, value, options, onChange, disabled: !ctx.canWrite() })
  const canManage = () => ctx.canWrite() && canManageScope(d(), 'project', ctx.projectId())
  const users = () =>
    d()
      .members.filter((m) => m.status === 'active' && m.role !== 'guest')
      .map((m) => ({ value: m.id, label: m.name }))
  const list = (rows, empty = tr('flow.ui.no.data.yet')) =>
    rows.length
      ? FlowList({
          children: html`${each(
            rows,
            (_, i) => i,
            (x) => html`${x}`,
          )}`,
        })
      : FlowEmpty({ title: empty })
  const form = (body, fn, label = tr('flow.ui.save'), cancel = () => editor.set('')) =>
    html`<form on:submit=${(e) => {
      e.preventDefault()
      fn(Object.fromEntries(new FormData(e.currentTarget)))
    }}>${stack(body, FlowInline({ align: 'end', children: html`${cancel ? btn(tr('flow.ui.cancel'), cancel) : null}${FlowButton({ label, type: 'submit', variant: 'primary', disabled: !ctx.canWrite() || ctx.busy() })}` }))}</form>`
  const tasks = () => projectTasks(d(), ctx.workspaceId(), ctx.projectId())
  const openTask = (t) => ctx.navigate('issue', { id: t.id, project: t.projectId })
  const taskRow = (t) =>
    FlowListItem({
      title: btn(t.id + ' · ' + t.title, () => openTask(t)),
      description: `${taskAssigneeNames(d(), t)} · ${t.dueDate ?? tr('flow.ui.no.due.date')}`,
      meta: FlowTag({ label: d().columns.find((c) => c.id === t.status)?.label ?? t.status }),
    })
  const forms = () => {
    const items = d().forms.filter((f) => f.projectId === ctx.projectId()),
      f = items.find((x) => x.id === selected())
    const edit = (f) => {
      selected.set(f?.id ?? '')
      fields.set(
        structuredClone(
          f?.fields ?? [
            { id: 'details', label: tr('flow.ui.request.details'), type: 'textarea', required: true },
          ],
        ),
      )
      formTab.set('design')
    }
    return FlowSection({
      title: tr('flow.ui.intake.forms'),
      actions: btn(tr('flow.ui.create.form'), () => edit(), true, !canManage()),
      children: stack(
        FlowToolbar({
          inset: 'none',
          children: FlowSegmented({
            label: tr('flow.ui.forms'),
            value: formTab(),
            options: [
              { value: 'manage', label: tr('flow.ui.manage') },
              { value: 'design', label: tr('flow.ui.design') },
              { value: 'preview', label: tr('flow.ui.preview.submit') },
              { value: 'responses', label: tr('flow.ui.responses') },
            ],
            onChange: (v) => {
              if (v === 'design' && !f) edit()
              else formTab.set(v)
            },
          }),
        }),
        formTab() === 'manage'
          ? list(
              items.map((f) =>
                FlowListItem({
                  title: f.title,
                  description: tr('flow.ui.fields.responses', [
                    f.fields?.length ?? 0,
                    f.responses,
                    f.access === 'project' ? tr('flow.ui.project.members') : tr('flow.ui.internal'),
                  ]),
                  meta: FlowTag({
                    label: f.status === 'published' ? tr('flow.ui.published') : tr('flow.ui.draft'),
                  }),
                  actions: inline(
                    btn(tr('flow.ui.design'), () => edit(f), false, !canManage()),
                    btn(tr('flow.ui.preview'), () => {
                      selected.set(f.id)
                      formTab.set('preview')
                    }),
                    btn(tr('flow.ui.responses'), () => {
                      selected.set(f.id)
                      formTab.set('responses')
                    }),
                  ),
                }),
              ),
            )
          : null,
        formTab() === 'design'
          ? form(
              stack(
                input('title', tr('flow.ui.form.name'), f?.title, 'text', true),
                FlowTextarea({ id: 'description', label: tr('flow.ui.instructions'), value: f?.description }),
                select('access', tr('flow.ui.who.can.submit'), f?.access ?? 'project', [
                  { value: 'project', label: tr('flow.ui.people.with.project.access') },
                  { value: 'internal', label: tr('flow.ui.internal.members.with.project.access') },
                ]),
                FlowHint({
                  children:
                    tr('flow.ui.destination') +
                    (d().projects.find((p) => p.id === ctx.projectId())?.title ??
                      tr('flow.ui.current.project')) +
                    tr('flow.ui.request.titles.become.task.titles'),
                }),
                select(
                  'assignee',
                  tr('flow.ui.recipient'),
                  f?.assignee ?? d().people[0],
                  d().people.map((p) => ({ value: p, label: p })),
                ),
                select('priority', tr('flow.ui.default.priority'), f?.priority ?? 'normal', [
                  { value: 'normal', label: tr('flow.ui.normal') },
                  { value: 'high', label: tr('flow.ui.high') },
                  { value: 'urgent', label: tr('flow.ui.urgent') },
                ]),
                ...fields().map((field, i) =>
                  FlowDisclosure({
                    title: tr('flow.ui.field', [i + 1, field.label]),
                    open: true,
                    children: stack(
                      FlowInput({
                        id: 'field-label-' + i,
                        label: tr('flow.ui.field.name'),
                        value: field.label,
                        required: true,
                        onInput: (e) => {
                          field.label = e.target.value
                        },
                      }),
                      FlowSelectField({
                        name: 'field-type-' + i,
                        label: tr('flow.ui.type'),
                        value: field.type,
                        options: [
                          { value: 'text', label: tr('flow.ui.short.text') },
                          { value: 'textarea', label: tr('flow.ui.long.text') },
                          { value: 'number', label: tr('flow.ui.number') },
                        ],
                        onChange: (e) => {
                          field.type = e.target.value
                        },
                      }),
                      FlowSelectField({
                        name: 'field-required-' + i,
                        label: tr('flow.ui.required'),
                        value: field.required ? 'yes' : 'no',
                        options: [
                          { value: 'yes', label: tr('flow.ui.yes') },
                          { value: 'no', label: tr('flow.ui.no') },
                        ],
                        onChange: (e) => {
                          field.required = e.target.value === 'yes'
                        },
                      }),
                      btn(tr('flow.ui.delete.field'), () => fields.set(fields().filter((_, j) => j !== i))),
                    ),
                  }),
                ),
                btn(
                  tr('flow.ui.add.field'),
                  () =>
                    fields.set([
                      ...fields(),
                      {
                        id: 'new-' + fields().length,
                        label: tr('flow.ui.new.field'),
                        type: 'text',
                        required: false,
                      },
                    ]),
                  false,
                  fields().length >= 12,
                ),
                select('publish', tr('flow.ui.status'), f?.status === 'draft' ? 'no' : 'yes', [
                  { value: 'no', label: tr('flow.ui.save.draft') },
                  { value: 'yes', label: tr('flow.ui.publish.in.mock') },
                ]),
              ),
              (v) =>
                run('form.save', { ...v, id: f?.id, fields: fields(), publish: v.publish === 'yes' }, (x) => {
                  selected.set(x.id)
                  formTab.set('preview')
                }),
              tr('flow.ui.save.form'),
              () => formTab.set('manage'),
            )
          : null,
        formTab() === 'preview'
          ? f
            ? stack(
                FlowHint({
                  children: tr('flow.ui.recipient.responses.create.tasks.in.this.project', [
                    f.title,
                    f.assignee,
                  ]),
                }),
                f.status !== 'published'
                  ? FlowEmpty({
                      title: tr('flow.ui.this.form.is.a.draft'),
                      description: tr('flow.ui.publish.it.in.design.before.submitting'),
                    })
                  : form(
                      stack(
                        input('request-title', tr('flow.ui.request.title'), '', 'text', true),
                        ...f.fields.map((x) =>
                          x.type === 'textarea'
                            ? FlowTextarea({ id: 'answer-' + x.id, label: x.label, required: x.required })
                            : input(
                                'answer-' + x.id,
                                x.label,
                                '',
                                x.type === 'number' ? 'number' : 'text',
                                x.required,
                              ),
                        ),
                      ),
                      (v) =>
                        run(
                          'form.submit',
                          {
                            id: f.id,
                            title: v['request-title'],
                            answers: Object.fromEntries(f.fields.map((x) => [x.id, v['answer-' + x.id]])),
                          },
                          () => formTab.set('responses'),
                        ),
                      tr('flow.ui.submit.request'),
                      () => formTab.set('manage'),
                    ),
              )
            : FlowEmpty({ title: tr('flow.ui.select.a.form.in.manage') })
          : null,
        formTab() === 'responses'
          ? list(
              (d().formResponses ?? [])
                .filter(
                  (x) => items.some((f) => f.id === x.formId) && (!selected() || x.formId === selected()),
                )
                .map((x) =>
                  FlowListItem({
                    title: x.title,
                    description: `${x.person} · ${new Date(x.at).toLocaleString(flowLocaleTag())}`,
                    actions: nav(x.taskId, 'issue', { id: x.taskId, project: ctx.projectId() }),
                  }),
                ),
              tr('flow.ui.no.responses.yet'),
            )
          : null,
      ),
    })
  }
  const calendar = () => {
    const anchor = date() || todayDate(d().timezone),
      period = calendarPeriod(anchor, scale()),
      all = ctx.filtered()
    return stack(
      ctx.filterbar(),
      FlowToolbar({
        children: inline(
          btn(tr('flow.ui.previous'), () => date.set(shiftPeriod(anchor, scale(), -1))),
          btn(tr('flow.ui.today'), () => date.set(todayDate(d().timezone))),
          btn(tr('flow.ui.next'), () => date.set(shiftPeriod(anchor, scale(), 1))),
          html`<strong>${period.start} → ${period.end}</strong>`,
        ),
        trailing: FlowSegmented({
          label: tr('flow.ui.calendar.range'),
          value: scale(),
          options: [
            { value: 'week', label: tr('flow.ui.week') },
            { value: 'month', label: tr('flow.ui.month') },
          ],
          onChange: scale.set,
        }),
      }),
      FlowCalendar({
        days: period.days.map((day) => {
          const matches = all.filter((t) => t.dueDate === day)
          return {
            label: new Date(day + 'T00:00:00Z').toLocaleDateString(flowLocaleTag(), {
              weekday: 'short',
              day: 'numeric',
              month: 'numeric',
              timeZone: 'UTC',
            }),
            today: day === todayDate(d().timezone),
            children: stack(
              ...matches.slice(0, 3).map((t) =>
                FlowCalendarEvent({
                  label: t.id + ' · ' + t.title,
                  title: t.title,
                  meta: taskAssigneeNames(d(), t),
                  tone: isDone(d(), t) ? 'green' : 'blue',
                  onClick: () => openTask(t),
                }),
              ),
              matches.length > 3
                ? FlowDisclosure({
                    title: tr('flow.ui.tasks.acec1e', [matches.length - 3]),
                    children: stack(
                      ...matches
                        .slice(3)
                        .map((t) =>
                          FlowCalendarEvent({ label: t.id, title: t.title, onClick: () => openTask(t) }),
                        ),
                    ),
                  })
                : null,
            ),
          }
        }),
      }),
      FlowSection({
        title: tr('flow.ui.no.due.date'),
        children: list(all.filter((t) => !t.dueDate).map(taskRow), tr('flow.ui.all.tasks.have.due.dates')),
      }),
    )
  }

  const inbox = () => {
    const all = d().inbox.filter(ctx.inboxFilter ?? (() => true)),
      items = all.filter(
        (n) =>
          inboxTab() === 'all' ||
          (inboxTab() === 'unread' && !n.read) ||
          (inboxTab() === 'mentions' && n.kind === 'mention') ||
          (inboxTab() === 'action' && n.actionNeeded === true),
      )
    const openNotification = (n, t) => {
      const open = () => ctx.navigate(n.route ?? 'issue', { id: t.id, project: t.projectId })
      if (!n.read && ctx.canWrite()) run('inbox.read', { ids: [n.id] }, open)
      else open()
    }
    return FlowSection({
      title: tr('flow.ui.notifications'),
      actions: btn(
        tr('flow.ui.mark.all.visible.as.read'),
        () => run('inbox.read', { ids: items.map((n) => n.id) }),
        false,
        !items.some((n) => !n.read) || !ctx.canWrite(),
      ),
      children: stack(
        FlowToolbar({
          inset: 'none',
          children: FlowSegmented({
            label: tr('flow.ui.notification.groups'),
            value: inboxTab(),
            options: [
              { value: 'unread', label: tr('flow.ui.unread') },
              { value: 'mentions', label: tr('flow.ui.mentions') },
              { value: 'action', label: tr('flow.ui.action.needed') },
              { value: 'all', label: tr('flow.ui.all') },
            ],
            onChange: inboxTab.set,
          }),
          trailing: ctx.workspaceFilter(),
        }),
        FlowHint({ children: tr('flow.today.readPolicy') }),
        list(
          items.map((n) => {
            const t = d().tasks.find((t) => t.id === n.taskId),
              actor = d().members.find((m) => m.id === n.actorId) ?? { id: 'system', name: 'Flow' }
            return FlowListItem({
              title: n.titleKey ? tr(n.titleKey) : n.title,
              description: stack(t ? html`<strong>${t.id} · ${t.title}</strong>` : null, n.description),
              unread: !n.read,
              leading: FlowAvatarGroup({ users: [actor] }),
              meta: html`<small>${actor.name} · ${d().projects.find((p) => p.id === t?.projectId)?.title ?? ''} · ${n.createdAt ? new Date(n.createdAt).toLocaleDateString(flowLocaleTag()) : ''}</small>`,
              actions: inline(
                n.actionNeeded ? FlowTag({ label: tr('flow.ui.action.needed'), tone: 'yellow' }) : null,
                t
                  ? btn(
                      tr(
                        n.route === 'quality-review'
                          ? 'flow.ui.view.handover'
                          : n.kind === 'blocked'
                            ? 'flow.today.openBlocker'
                            : n.kind === 'mention'
                              ? 'flow.today.viewMention'
                              : 'flow.today.openTask',
                      ),
                      () => openNotification(n, t),
                    )
                  : null,
                !n.read
                  ? btn(tr('flow.ui.read'), () => run('inbox.read', { ids: [n.id] }), false, !ctx.canWrite())
                  : null,
              ),
            })
          }),
          tr('flow.ui.you.re.caught.up.on.this.group'),
        ),
      ),
    })
  }
  const views = () => {
    const items = d().views.filter((v) => !v.archived && v.projectId === ctx.projectId()),
      v = items.find((v) => v.id === selected())
    return FlowSection({
      title: tr('flow.ui.saved.views'),
      actions: btn(tr('flow.ui.save.current.view'), ctx.openSavedView, true, !ctx.canWrite()),
      children: stack(
        FlowHint({
          children: tr('flow.ui.views.save.project.filters.tasks.remain.in.their.original.project'),
        }),
        list(
          items.map((v) =>
            FlowListItem({
              title: v.title,
              description: v.description,
              meta: inline(
                html`<small>${d().members.find((m) => m.id === v.ownerId)?.name ?? d().user.name}</small>`,
                FlowTag({
                  label:
                    v.visibility === 'project' ? tr('flow.ui.share.with.project') : tr('flow.ui.personal'),
                }),
              ),
              actions: inline(
                nav(tr('flow.ui.open'), 'project-issues', {
                  project: v.projectId,
                  view: v.id,
                  q: v.query ?? '',
                  status: v.status ?? 'all',
                }),
                btn(
                  tr('flow.ui.manage'),
                  () => {
                    selected.set(v.id)
                    editor.set('view')
                  },
                  false,
                  !ctx.canWrite(),
                ),
              ),
            }),
          ),
        ),
        editor() === 'view' && v
          ? FlowDisclosure({
              title: tr('flow.ui.manage.b905b0') + v.title,
              open: true,
              children: stack(
                form(
                  stack(
                    input('title', tr('flow.ui.view.name'), v.title, 'text', true),
                    FlowTextarea({ id: 'description', label: tr('flow.ui.notes'), value: v.description }),
                    input('query', tr('flow.ui.saved.search'), v.query ?? ''),
                    select('status', tr('flow.ui.saved.status'), v.status ?? 'all', [
                      { value: 'all', label: tr('flow.ui.all.statuses') },
                      ...taskColumns(d(), ctx.projectId()).map((c) => ({ value: c.id, label: c.label })),
                    ]),
                    select('visibility', tr('flow.ui.who.can.use.this'), v.visibility ?? 'private', [
                      { value: 'private', label: tr('flow.ui.only.me') },
                      { value: 'project', label: tr('flow.ui.project.members') },
                    ]),
                  ),
                  (x) => run('view.save', { ...x, id: v.id }, () => editor.set('')),
                ),
                btn(
                  tr('flow.ui.archive.view'),
                  () => run('view.save', { id: v.id, archive: true }, () => editor.set('')),
                  false,
                  !ctx.canWrite(),
                ),
              ),
            })
          : null,
      ),
    })
  }
  const preferences = () =>
    FlowSection({
      title: tr('flow.ui.personal.preferences'),
      children: stack(
        ctx.themeControl(),
        form(
          stack(
            select(
              'notifications',
              tr('flow.ui.notifications'),
              d().personalPreferences?.notifications ?? 'mentions',
              [
                { value: 'all', label: tr('flow.ui.all.related.updates') },
                { value: 'mentions', label: tr('flow.ui.mentions.and.assignments') },
                { value: 'none', label: tr('flow.ui.disable.additional.notifications') },
              ],
            ),
            select(
              'timezone',
              tr('flow.ui.display.timezone'),
              d().personalPreferences?.timezone ?? d().timezone,
              ['Asia/Ho_Chi_Minh', 'Asia/Tokyo', 'Europe/London', 'America/New_York', 'UTC'].map((v) => ({
                value: v,
                label: v,
              })),
            ),
            FlowHint({
              children: tr(
                'flow.ui.preferences.apply.within.this.mock.session.project.calendars.use.the.organizatio',
              ),
            }),
          ),
          (v) => run('preferences.save', v),
          tr('flow.ui.save.preferences'),
          null,
        ),
      ),
    })
  return {
    view: (key) =>
      ({ forms, calendar, inbox, 'saved-views': views, 'personal-settings': preferences })[key](),
    reset() {
      editor.set('')
      selected.set('')
      formTab.set('manage')
      fields.set([])
      date.set('')
      inboxTab.set('unread')
    },
  }
}
