import { tr } from './i18n.mjs'
export const routes = {
  'workspace-settings': {
    get title() {
      return tr('flow.ui.workspace.setup')
    },
    get group() {
      return tr('flow.ui.workspace.844042')
    },
    pattern: 'workspace',
  },
  'personal-settings': {
    get title() {
      return tr('flow.ui.personal.settings')
    },
    get group() {
      return tr('flow.ui.personal')
    },
    pattern: 'workspace',
  },
  'my-work': {
    get title() {
      return tr('flow.ui.my.tasks')
    },
    get group() {
      return tr('flow.ui.work')
    },
    pattern: 'list',
  },
  'all-issues': {
    get title() {
      return tr('flow.ui.all.tasks')
    },
    get group() {
      return tr('flow.ui.work')
    },
    pattern: 'list',
  },
  'issue-filter': {
    get title() {
      return tr('flow.ui.filter.and.group.tasks')
    },
    get group() {
      return tr('flow.ui.work')
    },
    pattern: 'list',
  },
  board: {
    get title() {
      return tr('flow.ui.task.board')
    },
    get group() {
      return tr('flow.ui.projects')
    },
    pattern: 'canvas',
  },
  'board-move': {
    get title() {
      return tr('flow.ui.change.status')
    },
    get group() {
      return tr('flow.ui.projects')
    },
    pattern: 'record',
  },
  'project-issues': {
    get title() {
      return tr('flow.ui.project.task.list')
    },
    get group() {
      return tr('flow.ui.projects')
    },
    pattern: 'list',
  },
  'issue-new': {
    get title() {
      return tr('flow.ui.create.task')
    },
    get group() {
      return tr('flow.ui.projects')
    },
    pattern: 'record',
  },
  issue: {
    get title() {
      return tr('flow.ui.task.kv.142')
    },
    get group() {
      return tr('flow.ui.work')
    },
    pattern: 'record',
  },
  'issue-move': {
    get title() {
      return tr('flow.ui.change.status.e85b57')
    },
    get group() {
      return tr('flow.ui.work')
    },
    pattern: 'record',
  },
  'issue-sprint': {
    get title() {
      return tr('flow.ui.assign.to.sprint')
    },
    get group() {
      return tr('flow.ui.work')
    },
    pattern: 'record',
  },
  'subtask-new': {
    get title() {
      return tr('flow.ui.add.subtask')
    },
    get group() {
      return tr('flow.ui.work')
    },
    pattern: 'record',
  },
  'dependency-new': {
    get title() {
      return tr('flow.ui.add.dependency')
    },
    get group() {
      return tr('flow.ui.work')
    },
    pattern: 'record',
  },
  comment: {
    get title() {
      return tr('flow.ui.comments.and.mentions')
    },
    get group() {
      return tr('flow.ui.work')
    },
    pattern: 'record',
  },
  description: {
    get title() {
      return tr('flow.ui.collaborative.description')
    },
    get group() {
      return tr('flow.ui.work')
    },
    pattern: 'record',
  },
  projects: {
    get title() {
      return tr('flow.ui.project.list')
    },
    get group() {
      return tr('flow.ui.projects')
    },
    pattern: 'list',
  },
  'project-new': {
    get title() {
      return tr('flow.ui.create.project')
    },
    get group() {
      return tr('flow.ui.projects')
    },
    pattern: 'record',
  },
  'project-profile': {
    get title() {
      return tr('flow.ui.project.profile')
    },
    get group() {
      return tr('flow.ui.projects')
    },
    pattern: 'record',
  },
  settings: {
    get title() {
      return tr('flow.ui.project.setup')
    },
    get group() {
      return tr('flow.ui.projects')
    },
    pattern: 'workspace',
  },
  'column-edit': {
    get title() {
      return tr('flow.ui.task.statuses.d92c22')
    },
    get group() {
      return tr('flow.ui.projects')
    },
    pattern: 'record',
  },
  'type-edit': {
    get title() {
      return tr('flow.ui.task.type')
    },
    get group() {
      return tr('flow.ui.projects')
    },
    pattern: 'record',
  },
  'field-edit': {
    get title() {
      return tr('flow.ui.custom.fields')
    },
    get group() {
      return tr('flow.ui.projects')
    },
    pattern: 'record',
  },
  'tag-edit': {
    get title() {
      return tr('flow.ui.labels')
    },
    get group() {
      return tr('flow.ui.projects')
    },
    pattern: 'record',
  },
  tags: {
    get title() {
      return tr('flow.ui.shared.labels')
    },
    get group() {
      return tr('flow.ui.setup')
    },
    pattern: 'list',
  },
  sprints: {
    title: 'Sprint',
    get group() {
      return tr('flow.ui.planning')
    },
    pattern: 'workspace',
  },
  'sprint-new': {
    get title() {
      return tr('flow.ui.create.sprint')
    },
    get group() {
      return tr('flow.ui.planning')
    },
    pattern: 'record',
  },
  'sprint-close': {
    get title() {
      return tr('flow.ui.close.sprint')
    },
    get group() {
      return tr('flow.ui.planning')
    },
    pattern: 'record',
  },
  epics: {
    get title() {
      return tr('flow.ui.project.epics')
    },
    get group() {
      return tr('flow.ui.planning')
    },
    pattern: 'workspace',
  },
  'epic-new': {
    get title() {
      return tr('flow.ui.create.epic')
    },
    get group() {
      return tr('flow.ui.planning')
    },
    pattern: 'record',
  },
  'all-epics': {
    get title() {
      return tr('flow.ui.all.epics')
    },
    get group() {
      return tr('flow.ui.planning')
    },
    pattern: 'list',
  },
  epic: {
    get title() {
      return tr('flow.ui.epic.sales.channel.integration')
    },
    get group() {
      return tr('flow.ui.planning')
    },
    pattern: 'record',
  },
  pages: {
    get title() {
      return tr('flow.ui.project.documents')
    },
    get group() {
      return tr('flow.ui.documents')
    },
    pattern: 'workspace',
  },
  'page-new': {
    get title() {
      return tr('flow.ui.create.document')
    },
    get group() {
      return tr('flow.ui.documents')
    },
    pattern: 'record',
  },
  'all-pages': {
    get title() {
      return tr('flow.ui.document.library')
    },
    get group() {
      return tr('flow.ui.documents')
    },
    pattern: 'list',
  },
  page: {
    get title() {
      return tr('flow.ui.documents')
    },
    get group() {
      return tr('flow.ui.documents')
    },
    pattern: 'record',
  },
  'page-child': {
    get title() {
      return tr('flow.ui.add.child.document')
    },
    get group() {
      return tr('flow.ui.documents')
    },
    pattern: 'record',
  },
  'page-move': {
    get title() {
      return tr('flow.ui.move.document')
    },
    get group() {
      return tr('flow.ui.documents')
    },
    pattern: 'record',
  },
  'page-archived': {
    get title() {
      return tr('flow.ui.archived.document')
    },
    get group() {
      return tr('flow.ui.documents')
    },
    pattern: 'list',
  },
  'issue-archive': {
    get title() {
      return tr('flow.ui.archive.task')
    },
    get group() {
      return tr('flow.ui.work')
    },
    pattern: 'record',
  },
  'issues-archived': {
    get title() {
      return tr('flow.ui.archived.tasks')
    },
    get group() {
      return tr('flow.ui.projects')
    },
    pattern: 'list',
  },
  'subtask-link': {
    get title() {
      return tr('flow.ui.link.existing.subtask')
    },
    get group() {
      return tr('flow.ui.work')
    },
    pattern: 'record',
  },
  follow: {
    get title() {
      return tr('flow.ui.follow.task')
    },
    get group() {
      return tr('flow.ui.work')
    },
    pattern: 'record',
  },
  history: {
    get title() {
      return tr('flow.ui.change.history')
    },
    get group() {
      return tr('flow.ui.work')
    },
    pattern: 'record',
  },
  'filter-limit': {
    get title() {
      return tr('flow.ui.filter.limit.exceeded')
    },
    get group() {
      return tr('flow.ui.projects')
    },
    pattern: 'list',
  },
  timezone: {
    get title() {
      return tr('flow.ui.business.timezone')
    },
    get group() {
      return tr('flow.ui.setup')
    },
    pattern: 'record',
  },
  'sprint-report': {
    get title() {
      return tr('flow.ui.sprint.summary')
    },
    get group() {
      return tr('flow.ui.planning')
    },
    pattern: 'workspace',
  },
  cmdk: {
    get title() {
      return tr('flow.ui.command.palette')
    },
    get group() {
      return tr('flow.ui.work')
    },
    pattern: 'overlay',
  },
  'issue-peek': {
    get title() {
      return tr('flow.ui.task.preview')
    },
    get group() {
      return tr('flow.ui.work')
    },
    pattern: 'overlay',
  },
  inbox: {
    get title() {
      return tr('flow.ui.inbox')
    },
    get group() {
      return tr('flow.ui.work')
    },
    pattern: 'list',
  },
  display: {
    get title() {
      return tr('flow.ui.display.options')
    },
    get group() {
      return tr('flow.ui.work')
    },
    pattern: 'record',
  },
  bulk: {
    get title() {
      return tr('flow.ui.select.and.bulk.edit')
    },
    get group() {
      return tr('flow.ui.work')
    },
    pattern: 'list',
  },
}
