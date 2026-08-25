// @ts-nocheck Dependency-free shared browser/SSR view.
// A per-epic dependency map, ported from PhaseAtlas's TaskMap.svelte
// (apps/ui/src/lib/TaskMap.svelte in the phaseatlas repo — read in full as the
// reference for this port, styling included): issues are laid out in columns
// by the longest chain of "blocks" dependencies leading into them (read left
// to right), with an SVG arrow from each blocking issue to the issue it
// blocks. Unlike that component this stays server-renderable and
// link-navigable rather than a stateful Svelte selection panel — clicking a
// node goes straight to its issue detail page, which this admin already has.
const LABELS = {
  vi: {
    eyebrow: 'Bản đồ phụ thuộc',
    title: 'Task map',
    hint: 'Đọc từ trái sang phải. Kéo để xem toàn bộ bản đồ.',
    empty: 'Epic này chưa có công việc nào.',
    done: 'Xong',
    active: 'Đang làm',
    ready: 'Sẵn sàng',
    blocked: 'Đang chặn',
    unassigned: 'Chưa gán',
    waitingFor: 'Chờ',
  },
  en: {
    eyebrow: 'Dependency atlas',
    title: 'Task map',
    hint: 'Read delivery from left to right. Drag the canvas to pan through large epics.',
    empty: 'This epic has no issues yet.',
    done: 'Done',
    active: 'In progress',
    ready: 'Ready',
    blocked: 'Waiting on dependency',
    unassigned: 'Unassigned',
    waitingFor: 'Waiting for',
  },
}

const LAYOUT = { nodeWidth: 208, nodeHeight: 120, columnGap: 72, rowGap: 14, padding: 32 }

const dataOf = (props) => {
  const fallback = LABELS[String(props.lang).toLowerCase().startsWith('en') ? 'en' : 'vi']
  try {
    const value = JSON.parse(String(props.data ?? '{}'))
    return {
      epicTitle: String(value.epicTitle ?? ''),
      nodes: Array.isArray(value.nodes) ? value.nodes : [],
      edges: Array.isArray(value.edges) ? value.edges : [],
      labels: { ...fallback, ...(value.labels && typeof value.labels === 'object' ? value.labels : {}) },
    }
  } catch {
    return { epicTitle: '', nodes: [], edges: [], labels: fallback }
  }
}

/** Column-by-dependency-depth layout, then a bezier path per edge — direct port of buildMap/edgePath. */
function buildMap(nodes, edges) {
  const byId = new Map(nodes.map((node) => [node.id, node]))
  const incoming = new Map(nodes.map((node) => [node.id, []]))
  for (const edge of edges) {
    if (byId.has(edge.source) && byId.has(edge.target)) incoming.get(edge.target).push(edge.source)
  }
  const depthCache = new Map()
  const depthFor = (id, trail) => {
    if (depthCache.has(id)) return depthCache.get(id)
    if (trail.has(id)) return 0
    const nextTrail = new Set(trail).add(id)
    const sources = incoming.get(id) ?? []
    const depth = sources.length ? Math.max(...sources.map((source) => depthFor(source, nextTrail) + 1)) : 0
    depthCache.set(id, depth)
    return depth
  }
  const columns = new Map()
  for (const node of nodes) {
    const depth = depthFor(node.id, new Set())
    columns.set(depth, [...(columns.get(depth) ?? []), node])
  }
  const columnCount = columns.size ? Math.max(...columns.keys()) + 1 : 0
  const largestColumn = Math.max(...[...columns.values()].map((column) => column.length), 1)
  const rowPitch = LAYOUT.nodeHeight + LAYOUT.rowGap
  const height = LAYOUT.padding * 2 + largestColumn * LAYOUT.nodeHeight + (largestColumn - 1) * LAYOUT.rowGap
  const positioned = []
  for (let columnIndex = 0; columnIndex < columnCount; columnIndex++) {
    const columnNodes = (columns.get(columnIndex) ?? [])
      .slice()
      .sort((a, b) => a.title.localeCompare(b.title))
    const columnHeight =
      columnNodes.length * LAYOUT.nodeHeight + Math.max(columnNodes.length - 1, 0) * LAYOUT.rowGap
    const top = LAYOUT.padding + Math.max((height - LAYOUT.padding * 2 - columnHeight) / 2, 0)
    columnNodes.forEach((node, row) => {
      positioned.push({
        ...node,
        x: LAYOUT.padding + columnIndex * (LAYOUT.nodeWidth + LAYOUT.columnGap),
        y: top + row * rowPitch,
      })
    })
  }
  const byKey = new Map(positioned.map((node) => [node.id, node]))
  const positionedEdges = edges
    .map((edge) => ({ source: byKey.get(edge.source), target: byKey.get(edge.target) }))
    .filter((edge) => edge.source && edge.target)
  return {
    nodes: positioned,
    edges: positionedEdges,
    width:
      LAYOUT.padding * 2 + columnCount * LAYOUT.nodeWidth + Math.max(columnCount - 1, 0) * LAYOUT.columnGap,
    height,
    // The canvas itself is full height (every node needs a fixed position),
    // but the scroll region is capped — otherwise one column with hundreds
    // of nodes stacked vertically (no "blocks" edges between them) stretches
    // the whole admin page to match instead of scrolling in place. Found by
    // opening a 141-issue epic with no dependency edges: the page came out
    // ~15000px tall. Same min/max bounds as the PhaseAtlas source this was
    // ported from.
    viewportHeight: Math.min(Math.max(height, 420), 1000),
  }
}

const edgePath = (edge) => {
  const startX = edge.source.x + LAYOUT.nodeWidth
  const startY = edge.source.y + LAYOUT.nodeHeight / 2
  const endX = edge.target.x
  const endY = edge.target.y + LAYOUT.nodeHeight / 2
  const bendX = startX + (endX - startX) * 0.5
  return `M ${startX} ${startY} C ${bendX} ${startY}, ${bendX} ${endY}, ${endX} ${endY}`
}

export function createFlowMapView(runtime, props) {
  const { each, html } = runtime
  const data = dataOf(props)
  const labels = data.labels
  const byId = new Map(data.nodes.map((node) => [node.id, node]))
  // Blocked: a "blocks" edge whose source is not done. Active: someone has
  // picked it up but it's not done or blocked. Ready: unassigned, unblocked.
  // Three states Flow's own schema already carries (terminal column,
  // assignee, dependency graph) — no state PhaseAtlas tracks that Flow does
  // not, so nothing here is invented.
  const blockedBy = new Map()
  for (const edge of data.edges) {
    const source = byId.get(edge.source)
    if (source && !source.done) {
      const list = blockedBy.get(edge.target) ?? []
      list.push(source.title)
      blockedBy.set(edge.target, list)
    }
  }
  const nodes = data.nodes.map((node) => {
    const waitingFor = blockedBy.get(node.id) ?? []
    const tone = node.done ? 'done' : waitingFor.length ? 'blocked' : node.assigneeName ? 'active' : 'ready'
    return { ...node, tone, waitingFor }
  })
  const model = buildMap(nodes, data.edges)
  const summary = {
    done: nodes.filter((node) => node.tone === 'done').length,
    active: nodes.filter((node) => node.tone === 'active').length,
    blocked: nodes.filter((node) => node.tone === 'blocked').length,
    ready: nodes.filter((node) => node.tone === 'ready').length,
  }
  const toneLabel = (tone) =>
    tone === 'done'
      ? labels.done
      : tone === 'blocked'
        ? labels.blocked
        : tone === 'active'
          ? labels.active
          : labels.ready

  return () => html`<section data-ui="flow-map">
    <header data-ui="flow-map-header">
      <div>
        <p data-ui="flow-map-eyebrow">${labels.eyebrow}</p>
        <h2>${labels.title}</h2>
        <p data-ui="flow-map-hint">${labels.hint}</p>
      </div>
      <div data-ui="flow-map-summary">
        <span data-tone="done"><strong>${summary.done}</strong>${labels.done}</span>
        <span data-tone="active"><strong>${summary.active}</strong>${labels.active}</span>
        <span data-tone="blocked"><strong>${summary.blocked}</strong>${labels.blocked}</span>
        <span data-tone="ready"><strong>${summary.ready}</strong>${labels.ready}</span>
      </div>
    </header>
    <div data-ui="flow-map-legend">
      ${each(
        ['done', 'active', 'ready', 'blocked'],
        (tone) => tone,
        (tone) => html`<span data-tone=${tone}><i></i>${toneLabel(tone)}</span>`,
      )}
      <span data-ui="flow-map-epic-name">${data.epicTitle}</span>
    </div>
    ${
      model.nodes.length === 0
        ? html`<p data-ui="flow-map-empty">${labels.empty}</p>`
        : html`<div data-ui="flow-map-scroll" style=${`height:${model.viewportHeight}px`}>
          <div data-ui="flow-map-canvas" style=${`width:${model.width}px;height:${model.height}px`}>
            <svg data-ui="flow-map-edges" viewBox=${`0 0 ${model.width} ${model.height}`} aria-hidden="true">
              <defs>
                <marker id="flow-map-arrow-default" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto" markerUnits="strokeWidth"><path d="M0,0 L8,4 L0,8 z"></path></marker>
                <marker id="flow-map-arrow-done" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto" markerUnits="strokeWidth"><path d="M0,0 L8,4 L0,8 z"></path></marker>
                <marker id="flow-map-arrow-blocked" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto" markerUnits="strokeWidth"><path d="M0,0 L8,4 L0,8 z"></path></marker>
              </defs>
              ${each(
                model.edges,
                (edge, index) => `${edge.source.id}->${edge.target.id}:${index}`,
                (edge) =>
                  html`<path data-ui="flow-map-edge" data-tone=${edge.source.tone} d=${edgePath(edge)} marker-end=${`url(#flow-map-arrow-${edge.source.tone === 'done' ? 'done' : edge.source.tone === 'blocked' ? 'blocked' : 'default'})`}></path>`,
              )}
            </svg>
            ${each(
              model.nodes,
              (node) => node.id,
              (
                node,
              ) => html`<a data-ui="flow-map-node" data-tone=${node.tone} href=${`/admin/flow/issues/${node.id}`}
                style=${`left:${node.x}px;top:${node.y}px;width:${LAYOUT.nodeWidth}px;height:${LAYOUT.nodeHeight}px`}>
                <span data-ui="flow-map-node-top">
                  <span data-ui="flow-map-node-column">${node.columnName ?? ''}</span>
                  <span data-ui="flow-map-node-state"><i></i>${toneLabel(node.tone)}</span>
                </span>
                <strong data-ui="flow-map-node-title">${node.title}</strong>
                <span data-ui="flow-map-node-foot">
                  ${
                    node.waitingFor.length
                      ? html`<span data-ui="flow-map-node-waiting">${labels.waitingFor} ${node.waitingFor.join(', ')}</span>`
                      : html`<span>${node.assigneeName ?? labels.unassigned}</span>`
                  }
                </span>
              </a>`,
            )}
          </div>
        </div>`
    }
  </section>`
}
