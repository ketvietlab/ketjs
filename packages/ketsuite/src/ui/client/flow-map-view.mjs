// @ts-nocheck Dependency-free shared browser/SSR view.
// A per-epic dependency map, ported from PhaseAtlas's TaskMap.svelte
// (apps/ui/src/lib/TaskMap.svelte in the phaseatlas repo — read in full as the
// reference for this port): issues are laid out in columns by the longest
// chain of "blocks" dependencies leading into them (read left to right), with
// an SVG arrow from each blocking issue to the issue it blocks. Unlike that
// component this stays server-renderable and link-navigable rather than a
// stateful Svelte selection panel — clicking a node goes straight to its
// issue detail page, which this admin already has.
const LABELS = {
  vi: {
    title: 'Bản đồ phụ thuộc',
    hint: 'Đọc từ trái sang phải. Kéo để xem toàn bộ bản đồ.',
    empty: 'Epic này chưa có công việc nào.',
    done: 'Xong',
    blocked: 'Đang chặn',
    remaining: 'Còn lại',
    waitingFor: 'Chờ',
  },
  en: {
    title: 'Dependency map',
    hint: 'Read left to right. Drag to pan the map.',
    empty: 'This epic has no issues yet.',
    done: 'Done',
    blocked: 'Blocked',
    remaining: 'Remaining',
    waitingFor: 'Waiting for',
  },
}

const LAYOUT = { nodeWidth: 200, nodeHeight: 92, columnGap: 72, rowGap: 14, padding: 32 }

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
    const columnNodes = (columns.get(columnIndex) ?? []).slice().sort((a, b) => a.title.localeCompare(b.title))
    const columnHeight = columnNodes.length * LAYOUT.nodeHeight + Math.max(columnNodes.length - 1, 0) * LAYOUT.rowGap
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
    width: LAYOUT.padding * 2 + columnCount * LAYOUT.nodeWidth + Math.max(columnCount - 1, 0) * LAYOUT.columnGap,
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
  const blockedIds = new Set(data.edges.filter((edge) => !data.nodes.find((n) => n.id === edge.source)?.done).map((edge) => edge.target))
  const nodes = data.nodes.map((node) => ({
    ...node,
    tone: node.done ? 'done' : blockedIds.has(node.id) ? 'blocked' : 'ready',
  }))
  const model = buildMap(nodes, data.edges)
  const summary = {
    done: nodes.filter((node) => node.tone === 'done').length,
    blocked: nodes.filter((node) => node.tone === 'blocked').length,
    remaining: nodes.filter((node) => node.tone === 'ready').length,
  }

  return () => html`<section data-ui="flow-map">
    <header data-ui="flow-map-header">
      <div>
        <p data-ui="flow-map-eyebrow">${labels.title}</p>
        <h2>${data.epicTitle}</h2>
        <p>${labels.hint}</p>
      </div>
      <div data-ui="flow-map-summary">
        <span data-tone="done"><strong>${summary.done}</strong>${labels.done}</span>
        <span data-tone="blocked"><strong>${summary.blocked}</strong>${labels.blocked}</span>
        <span data-tone="ready"><strong>${summary.remaining}</strong>${labels.remaining}</span>
      </div>
    </header>
    ${model.nodes.length === 0
      ? html`<p data-ui="flow-map-empty">${labels.empty}</p>`
      : html`<div data-ui="flow-map-scroll" style=${`height:${model.viewportHeight}px`}>
          <div data-ui="flow-map-canvas" style=${`width:${model.width}px;height:${model.height}px`}>
            <svg data-ui="flow-map-edges" viewBox=${`0 0 ${model.width} ${model.height}`} aria-hidden="true">
              <defs>
                <marker id="flow-map-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto" markerUnits="strokeWidth">
                  <path d="M0,0 L8,4 L0,8 z"></path>
                </marker>
              </defs>
              ${each(model.edges, (edge, index) => `${edge.source.id}->${edge.target.id}:${index}`, (edge) =>
                html`<path data-ui="flow-map-edge" data-tone=${edge.source.tone} d=${edgePath(edge)} marker-end="url(#flow-map-arrow)"></path>`,
              )}
            </svg>
            ${each(
              model.nodes,
              (node) => node.id,
              (node) => html`<a data-ui="flow-map-node" data-tone=${node.tone} href=${`/admin/flow/issues/${node.id}`}
                style=${`left:${node.x}px;top:${node.y}px;width:${LAYOUT.nodeWidth}px;height:${LAYOUT.nodeHeight}px`}>
                <span data-ui="flow-map-node-state">${node.tone === 'done' ? labels.done : node.tone === 'blocked' ? labels.blocked : node.columnName}</span>
                <strong>${node.title}</strong>
                <span data-ui="flow-map-node-meta">${node.assigneeName ?? '—'}</span>
              </a>`,
            )}
          </div>
        </div>`}
  </section>`
}
