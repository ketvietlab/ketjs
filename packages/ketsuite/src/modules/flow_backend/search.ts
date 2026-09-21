// What the search-filter bar offers on the Flow lists that are not the issue
// list.
//
// The issue lists already carry a real `ListSearchSpec` (`issueListSearch` in
// the domain), so they keep it and only change the chrome that renders it. The
// lists here are of two kinds:
//
//   - Projects, epics and every document: paged and searched by their own
//     domain function, which takes a `search` string and nothing else. Their
//     specs declare the query alone, and the route maps it onto that argument.
//     Projects keep their all/mine/archived tabs, because an archived project
//     is a place the reader goes rather than a filter left on by accident.
//   - Sprints: one project's sprints, read whole, so the spec covers exactly
//     the columns its table renders.
import { defineRowList } from '../backend/row-list.ts'
import type { ListSearchShape } from '@ketvietlab/ketjs'

/** Projects, as `flow.project.list` can answer them. */
export const projectListSearch: ListSearchShape = {
  key: 'flow.projects',
  searchable: [{ key: 'name' }, { key: 'key' }],
  sortable: [],
}

/** Every epic, as `flow.epic.listAll` can answer them. */
export const epicListSearch: ListSearchShape = {
  key: 'flow.epics',
  searchable: [{ key: 'title' }],
  sortable: [],
}

/** Every document, as `flow.page.listAll` can answer them. */
export const pageListSearch: ListSearchShape = {
  key: 'flow.pages',
  searchable: [{ key: 'title' }],
  sortable: [],
}

const SPRINT_STATES = ['planned', 'active', 'closed'] as const

export const sprintListSearch = defineRowList({
  key: 'flow.sprints',
  searchable: [{ key: 'name' }, { key: 'state' }, { key: 'startDate' }, { key: 'endDate' }],
  filterable: [
    { key: 'name', label: 'flow_backend.field.name', type: 'text' },
    { key: 'state', label: 'flow_backend.field.state', type: 'selection', choices: SPRINT_STATES },
    { key: 'startDate', label: 'flow_backend.field.startDate', type: 'date' },
    { key: 'endDate', label: 'flow_backend.field.endDate', type: 'date' },
  ],
  groupable: [{ key: 'state', label: 'flow_backend.field.state' }],
  sortable: [
    { key: 'name', label: 'flow_backend.field.name' },
    { key: 'startDate', label: 'flow_backend.field.startDate' },
  ],
  presets: SPRINT_STATES.map((state) => ({
    key: state,
    label: `flow.sprint.${state}`,
    group: 'state',
    match: (row: Record<string, unknown>) => row.state === state,
  })),
  defaultSort: [{ key: 'startDate', dir: 'desc' }],
})
