import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Translator } from '@ketvietlab/ketjs'
import { renderToString } from '@ketvietlab/ketjs-view'
import { issueDetailScreen } from '../packages/ketsuite/src/modules/flow_backend/screens/issue-detail.tsx'

const messages: Record<string, string> = {
  'flow_backend.action.addComment': 'Post comment',
  'flow_backend.action.assignSprint': 'Assign sprint',
  'flow_backend.action.cancel': 'Cancel',
  'flow_backend.action.move': 'Change status',
  'flow_backend.action.remove': 'Remove',
  'flow_backend.action.save': 'Save',
  'flow_backend.action.unfollow': 'Stop following',
  'flow_backend.attachments.choose': 'Choose file',
  'flow_backend.attachments.empty': 'No files',
  'flow_backend.attachments.emptyHint': 'Drop a file here.',
  'flow_backend.attachments.title': 'Attachments',
  'flow_backend.attachments.upload': 'Upload',
  'flow_backend.comments.followingHint': 'You follow this issue.',
  'flow_backend.comments.quietHint': 'You do not follow this issue.',
  'flow_backend.comments.mentionHint': 'Mentioned people are notified.',
  'flow_backend.comments.title': 'Comments',
  'flow_backend.dependencies.add': 'Add dependency',
  'flow_backend.dependencies.incoming': 'incoming',
  'flow_backend.dependencies.outgoing': 'outgoing',
  'flow_backend.dependencies.target': 'Related issue',
  'flow_backend.dependency.blocks': 'Blocks',
  'flow_backend.dependency.related': 'Related',
  'flow_backend.empty.hint': 'No records yet.',
  'flow_backend.empty.title': 'Nothing here yet',
  'flow_backend.field.assignee': 'Assignee',
  'flow_backend.field.column': 'Status',
  'flow_backend.field.comment': 'Comment',
  'flow_backend.field.createdAt': 'Created',
  'flow_backend.field.dueDate': 'Due date',
  'flow_backend.field.epic': 'Epic',
  'flow_backend.field.estimate': 'Estimate',
  'flow_backend.field.mentions': 'Notify',
  'flow_backend.field.priority': 'Priority',
  'flow_backend.field.progress': 'Progress',
  'flow_backend.field.project': 'Project',
  'flow_backend.field.relation': 'Relation',
  'flow_backend.field.sprint': 'Sprint',
  'flow_backend.field.startDate': 'Start date',
  'flow_backend.field.tags': 'Tags',
  'flow_backend.field.title': 'Title',
  'flow_backend.field.type': 'Type',
  'flow_backend.field.updatedAt': 'Updated',
  'flow_backend.issue.attributes': 'Issue information',
  'flow_backend.issue.description': 'Description',
  'flow_backend.issue.summary': 'Summary',
  'flow_backend.subtasks.add': 'Add subtask',
  'flow_backend.subtasks.detach': 'Detach',
  'flow_backend.subtasks.newTitle': 'Subtask title',
  'flow_backend.subtasks.parent': 'Parent',
  'flow_backend.subtasks.title': 'Subtasks',
  'flow.dependency.blocks': 'Blocks',
  'flow.priority.high': 'High',
  'backend.table.columns': 'Columns',
  'backend.table.selectAll': 'Select all',
  'backend.table.selectRow': 'Select row',
}

const translate = ((key: string) => messages[key] ?? key) as Translator
translate.locale = 'en'
translate.has = (key) => key in messages
translate.resolves = translate.has

const row = {
  id: 'issue-login',
  title: 'Finish login',
  version: 4,
  projectId: 'platform',
  projectName: 'Internal platform',
  columnId: 'doing',
  columnName: 'Doing',
  priority: 'high',
  assigneeName: 'Administrator',
  typeName: 'Task',
  epicTitle: 'Authentication',
  sprintId: 'sprint-1',
  sprintName: 'Sprint 1',
  progress: 50,
  subtaskDone: 1,
  subtaskTotal: 2,
  children: [{ id: 'child-1', title: 'Child issue', version: 2, columnName: 'To do' }],
  dependencies: [
    {
      id: 'dependency-1',
      dependsOnIssueId: 'issue-api',
      dependsOnTitle: 'Finish API',
      relation: 'blocks',
    },
  ],
  comments: [{ id: 'comment-1', body: 'Ready for review', createdAt: '2026-08-27T01:00:00Z' }],
  tags: [{ id: 'security', name: 'Security' }],
  following: true,
  fieldValues: { environment: 'Production' },
}

const options = {
  fields: [{ name: 'title', label: 'Title', value: 'Finish login', required: true }],
  columns: [
    { id: 'todo', name: 'To do' },
    { id: 'doing', name: 'Doing' },
  ],
  sprints: [{ id: 'sprint-1', name: 'Sprint 1' }],
  controls: {
    dependencyTarget: <span data-island="relation-select">Issue picker</span>,
    mentions: <span data-island="relation-select">Mention picker</span>,
  },
  editor: <div data-island="livedoc.editor">Collaborative editor</div>,
  attachments: [{ id: 'attachment-1', name: 'brief.pdf', size: 1200, mimetype: 'application/pdf' }],
  fieldDefs: [{ id: 'environment', code: 'environment', name: 'Environment' }],
  locale: '?lang=en',
  idempotencyKey: 'issue-detail-once',
}

test('flow issue detail: FormPage keeps record identity, collaboration and operational sections', () => {
  const html = renderToString(issueDetailScreen(translate, {}, row, options))
  const textContent = html.replace(/<!--k\[?-->/g, '')

  assert.match(html, /data-ui="form-page" data-scope="flow-issue-detail-form-page"/)
  assert.doesNotMatch(html, /data-ui="record-workspace"/)
  assert.match(textContent, /data-ui="form-page-title">Finish login/)
  assert.match(textContent, /data-ui="form-page-description">Internal platform/)
  assert.match(textContent, /data-ui="form-page-status"[^>]*>.*Doing/)
  assert.match(textContent, /High/)
  assert.match(textContent, /Assignee: Administrator/)
  assert.match(html, /type="submit" form="flow-issue-detail-form"/)
  assert.match(html, /id="flow-issue-detail-form"/)
  assert.match(html, /action="\/admin\/flow\/issues\/issue-login\?lang=en"/)
  assert.match(html, /name="idempotencyKey" value="issue-detail-once"/)
  assert.match(html, /href="\/admin\/flow\/issues\/issue-login\?lang=en&amp;dialog=move"/)
  assert.match(html, /href="\/admin\/flow\/issues\/issue-login\?lang=en&amp;dialog=assignSprint"/)
  assert.doesNotMatch(html, /id="flow-issue-move-form"|id="flow-issue-assignSprint-form"/)
  assert.match(html, /data-island="livedoc.editor"/)
  assert.match(html, /data-island="relation-select"/)
  assert.match(html, /data-ui="form-page-aside"/)
  assert.match(textContent, /Environment.*Production/)
  assert.match(html, /action="\/admin\/flow\/issues\/issue-login\/attachments\?lang=en"/)
  assert.match(html, /href="\/admin\/flow\/issues\/child-1\?lang=en"/)
  assert.match(html, /href="\/admin\/flow\/issues\/issue-api\?lang=en"/)
  assert.match(textContent, /Collaborative editor/)
  assert.match(textContent, /Ready for review/)
})

test('flow issue detail: one-field status action is a URL-owned modal with rejected state', () => {
  const html = renderToString(
    issueDetailScreen(translate, {}, row, {
      ...options,
      dialog: 'move',
      submitted: { columnId: 'missing' },
      errors: { action: 'move', messages: ['That status is unavailable'] },
    }),
  )

  assert.match(html, /data-ui="form-page"/)
  assert.match(html, /data-ui="modal-layer" data-route-modal="true"/)
  assert.match(html, /id="flow-issue-move-form"/)
  assert.match(html, /action="\/admin\/flow\/issues\/issue-login\?lang=en&amp;dialog=move"/)
  assert.match(html, /name="action" value="move"/)
  assert.match(html, /name="expectedVersion" value="4"/)
  assert.match(html, /name="idempotencyKey" value="issue-detail-once"/)
  assert.match(html, /<option value="missing" selected="true">/)
  assert.match(html, /That status is unavailable/)
  assert.match(html, /data-ui="modal-close" href="\/admin\/flow\/issues\/issue-login\?lang=en"/)
})
