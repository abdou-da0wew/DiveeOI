import { createSignal, onMount, onCleanup, createEffect, mergeProps, JSX } from "solid-js"
import * as d3 from "d3"
import { MemoryNode, MemoryLink, MemoryType, LinkType, MemoryNodeID, SessionID } from "@diveeoi/memory/schema"
import { AbsolutePath } from "@diveeoi/db/schema"

export interface GraphViewProps {
  nodes?: MemoryNode[]
  links?: MemoryLink[]
  width?: number
  height?: number
  onNodeClick?: (node: MemoryNode) => void
  onLinkClick?: (link: MemoryLink) => void
  filterTypes?: MemoryType[]
  filterSessions?: string[]
  showLabels?: boolean
  showEdgeLabels?: boolean
  physicsEnabled?: boolean
  nodeSize?: number
  chargeStrength?: number
  linkDistance?: number
  centerForce?: boolean
  collisionRadius?: number
}

export interface GraphNode extends MemoryNode {
  x?: number
  y?: number
  vx?: number
  vy?: number
  fx?: number | null
  fy?: number | null
  index?: number
}

export interface GraphLink extends MemoryLink {
  source: GraphNode | string
  target: GraphNode | string
  index?: number
}

const TYPE_COLORS: Record<MemoryType, string> = {
  decision: "#8b5cf6",
  pattern: "#3b82f6",
  error: "#ef4444",
  entity: "#10b981",
  preference: "#f59e0b",
  fact: "#6366f1",
  constraint: "#ec4899",
  session: "#64748b",
}

const LINK_TYPE_COLORS: Record<LinkType, string> = {
  references: "#64748b",
  see_also: "#3b82f6",
  contradicts: "#ef4444",
  supersedes: "#8b5cf6",
}

const LINK_TYPE_DASH: Record<LinkType, string> = {
  references: "none",
  see_also: "5,5",
  contradicts: "2,2",
  supersedes: "8,4",
}

export function GraphView(props: GraphViewProps) {
  const {
    nodes = [],
    links = [],
    width = 800,
    height = 600,
    onNodeClick,
    onLinkClick,
    filterTypes,
    filterSessions,
    showLabels = true,
    showEdgeLabels = false,
    physicsEnabled = true,
    nodeSize = 8,
    chargeStrength = -300,
    linkDistance = 100,
    centerForce = true,
    collisionRadius = 12,
  } = props

  const [svgRef, setSvgRef] = createSignal<SVGSVGElement | null>(null)
  const [simulation, setSimulation] = createSignal<d3.Simulation<GraphNode, GraphLink> | null>(null)
  const [selectedNode, setSelectedNode] = createSignal<GraphNode | null>(null)
  const [hoveredNode, setHoveredNode] = createSignal<GraphNode | null>(null)
  const [transform, setTransform] = createSignal<{ x: number; y: number; k: number }>({ x: 0, y: 0, k: 1 })
  const [filteredNodes, setFilteredNodes] = createSignal<GraphNode[]>([])
  const [filteredLinks, setFilteredLinks] = createSignal<GraphLink[]>([])
  const [isDragging, setIsDragging] = createSignal(false)
  const [dragStart, setDragStart] = createSignal<{ x: number; y: number } | null>(null)

  const colorForType = (type: MemoryType) => TYPE_COLORS[type] || "#64748b"
  const colorForLinkType = (type: LinkType) => LINK_TYPE_COLORS[type] || "#64748b"
  const dashForLinkType = (type: LinkType) => LINK_TYPE_DASH[type] || "none"

  const applyFilters = () => {
    let filtered = nodes as GraphNode[]
    if (filterTypes && filterTypes.length > 0) {
      filtered = filtered.filter(n => filterTypes!.includes(n.type))
    }
    if (filterSessions && filterSessions.length > 0) {
      filtered = filtered.filter(n => filterSessions!.includes(n.sessionId))
    }
    const nodeIds = new Set(filtered.map(n => n.id))
    const filteredL = links.filter(l => nodeIds.has(l.sourceId) && nodeIds.has(l.targetId))
    setFilteredNodes(filtered)
    setFilteredLinks(filteredL as GraphLink[])
  }

  createEffect(applyFilters)

  const initializeSimulation = () => {
    const sim = d3.forceSimulation<GraphNode, GraphLink>(filteredNodes())
      .force("charge", d3.forceManyBody().strength(chargeStrength))
      .force("link", d3.forceLink<GraphNode, GraphLink>(filteredLinks())
        .id((d: any) => d.id)
        .distance(linkDistance)
        .strength(0.7))
      .force("collision", d3.forceCollide().radius(collisionRadius))
      .force("x", centerForce ? d3.forceX(width / 2).strength(0.05) : null)
      .force("y", centerForce ? d3.forceY(height / 2).strength(0.05) : null)
      .alphaDecay(0.02)
      .velocityDecay(0.4)

    if (!physicsEnabled) {
      sim.stop()
    }

    setSimulation(sim)
    return sim
  }

  const renderGraph = () => {
    const svg = svgRef()
    if (!svg) return

    d3.select(svg).selectAll("*").remove()

    const g = d3.select(svg)
      .append("g")
      .attr("transform", `translate(${transform().x},${transform().y}) scale(${transform().k})`)

    const link = g.append("g")
      .attr("class", "links")
      .selectAll("line")
      .data(filteredLinks())
      .join("line")
      .attr("class", "graph-link")
      .attr("stroke", (d: any) => colorForLinkType(d.type))
      .attr("stroke-width", 1.5)
      .attr("stroke-dasharray", (d: any) => dashForLinkType(d.type))
      .attr("opacity", 0.6)

    if (showEdgeLabels) {
      g.append("g")
        .attr("class", "edge-labels")
        .selectAll("text")
        .data(filteredLinks())
        .join("text")
        .attr("class", "edge-label")
        .attr("font-size", "10px")
        .attr("fill", "#64748b")
        .attr("text-anchor", "middle")
        .attr("dominant-baseline", "middle")
        .attr("pointer-events", "none")
        .text((d: any) => d.type)
    }

    const node = g.append("g")
      .attr("class", "nodes")
      .selectAll("circle")
      .data(filteredNodes())
      .join("circle")
      .attr("class", "graph-node")
      .attr("r", nodeSize)
      .attr("fill", (d: any) => colorForType(d.type))
      .attr("stroke", (d: any) => d === selectedNode() ? "#fff" : (d === hoveredNode() ? "#fff" : "none"))
      .attr("stroke-width", (d: any) => d === selectedNode() || d === hoveredNode() ? 2 : 0)
      .attr("cursor", "pointer")
      .on("click", (event: any, d: GraphNode) => {
        event.stopPropagation()
        setSelectedNode(d)
        onNodeClick?.(d)
      })
      .on("mouseenter", (event: any, d: GraphNode) => {
        setHoveredNode(d)
      })
      .on("mouseleave", () => {
        setHoveredNode(null)
      })

    if (showLabels) {
      g.append("g")
        .attr("class", "node-labels")
        .selectAll("text")
        .data(filteredNodes())
        .join("text")
        .attr("class", "node-label")
        .attr("font-size", "11px")
        .attr("fill", "#e2e8f0")
        .attr("text-anchor", "middle")
        .attr("dominant-baseline", "middle")
        .attr("pointer-events", "none")
        .attr("dy", nodeSize + 14)
        .text((d: any) => d.title.length > 20 ? d.title.slice(0, 20) + "..." : d.title)
    }

    if (simulation()) {
      simulation()!.on("tick", () => {
        link
          .attr("x1", (d: any) => d.source.x)
          .attr("y1", (d: any) => d.source.y)
          .attr("x2", (d: any) => d.target.x)
          .attr("y2", (d: any) => d.target.y)

        node
          .attr("cx", (d: any) => d.x)
          .attr("cy", (d: any) => d.y)

        if (showLabels) {
          g.selectAll(".node-label")
            .attr("x", (d: any) => d.x)
            .attr("y", (d: any) => d.y)
        }

        if (showEdgeLabels) {
          g.selectAll(".edge-label")
            .attr("x", (d: any) => (d.source.x + d.target.x) / 2)
            .attr("y", (d: any) => (d.source.y + d.target.y) / 2)
        }
      })
    }
  }

  const handleZoom = (event: WheelEvent) => {
    event.preventDefault()
    const delta = event.deltaY > 0 ? 0.9 : 1.1
    const newK = Math.min(Math.max(transform().k * delta, 0.1), 5)
    setTransform(prev => ({ ...prev, k: newK }))
    renderGraph()
  }

  const handleDragStart = (event: MouseEvent) => {
    if (event.button !== 0) return
    setIsDragging(true)
    setDragStart({ x: event.clientX, y: event.clientY })
  }

  const handleDrag = (event: MouseEvent) => {
    if (!isDragging() || !dragStart()) return
    const dx = event.clientX - dragStart()!.x
    const dy = event.clientY - dragStart()!.y
    setTransform(prev => ({ x: prev.x + dx, y: prev.y + dy, k: prev.k }))
    setDragStart({ x: event.clientX, y: event.clientY })
    renderGraph()
  }

  const handleDragEnd = () => {
    setIsDragging(false)
    setDragStart(null)
  }

  const resetView = () => {
    setTransform({ x: 0, y: 0, k: 1 })
    if (simulation()) {
      simulation()!.alpha(0.5).restart()
    }
    renderGraph()
  }

  const centerOnNode = (node: GraphNode) => {
    const newX = width / 2 - (node.x ?? 0) * transform().k
    const newY = height / 2 - (node.y ?? 0) * transform().k
    setTransform(prev => ({ ...prev, x: newX, y: newY }))
    renderGraph()
  }

  onMount(() => {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg")
    svg.style.width = "100%"
    svg.style.height = "100%"
    svg.style.overflow = "visible"
    setSvgRef(svg)
    initializeSimulation()
    renderGraph()

    window.addEventListener("wheel", handleZoom, { passive: false })
    window.addEventListener("mousedown", handleDragStart)
    window.addEventListener("mousemove", handleDrag)
    window.addEventListener("mouseup", handleDragEnd)

    const resizeObserver = new ResizeObserver(() => renderGraph())
    resizeObserver.observe(svg)
  })

  onCleanup(() => {
    window.removeEventListener("wheel", handleZoom)
    window.removeEventListener("mousedown", handleDragStart)
    window.removeEventListener("mousemove", handleDrag)
    window.removeEventListener("mouseup", handleDragEnd)
    simulation()?.stop()
  })

  return (
    <div class="graph-view" style={{ width: "100%", height: "100%", position: "relative" }}>
      <div class="graph-controls" style={{
        position: "absolute",
        top: "12px",
        right: "12px",
        "z-index": 10,
        display: "flex",
        gap: "8px",
        "flex-direction": "column",
        background: "rgba(15, 23, 42, 0.9)",
        padding: "12px",
        "border-radius": "8px",
        border: "1px solid rgba(148, 163, 184, 0.2)",
        "backdrop-filter": "blur(8px)",
      }}>
        <button onClick={resetView} class="control-btn" title="Reset View">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
            <path d="M21 12a9 9 0 1 1-9 9 9.75 9.75 0 0 1 6.74-2.74L21 16" />
          </svg>
        </button>
        <button onClick={() => simulation()?.alpha(0.3).restart()} class="control-btn" title="Restart Physics">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M23 4v6h-6" />
            <path d="M1 20v-6h6" />
            <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
          </svg>
        </button>
        <button onClick={() => physicsEnabled && simulation()?.alpha(0.5).restart()} class="control-btn" title="Pause Physics">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="6" y="4" width="4" height="16" />
            <rect x="14" y="4" width="4" height="16" />
          </svg>
        </button>
      </div>

      <div class="graph-legend" style={{
        position: "absolute",
        bottom: "12px",
        left: "12px",
        "z-index": 10,
        background: "rgba(15, 23, 42, 0.9)",
        padding: "12px",
        "border-radius": "8px",
        border: "1px solid rgba(148, 163, 184, 0.2)",
        "backdrop-filter": "blur(8px)",
        "font-size": "11px",
        color: "#94a3b8",
      }}>
        <div style={{ "font-weight": 600, color: "#e2e8f0", "margin-bottom": "8px" }}>Node Types</div>
        <div style={{ display: "flex", "flex-wrap": "wrap", gap: "8px" }}>
          {Object.entries(TYPE_COLORS).map(([type, color]) => (
            <span style={{
              display: "flex",
              "align-items": "center",
              gap: "4px",
              padding: "2px 6px",
              "border-radius": "4px",
              background: "rgba(148, 163, 184, 0.1)",
            }}>
              <span style={{
                width: "10px",
                height: "10px",
                "border-radius": "50%",
                background: color,
              }} />
              {type}
            </span>
          ))}
        </div>
        <div style={{ "margin-top": "12px", "font-weight": 600, color: "#e2e8f0" }}>Link Types</div>
        <div style={{ display: "flex", "flex-wrap": "wrap", gap: "8px" }}>
          {Object.entries(LINK_TYPE_COLORS).map(([type, color]) => (
            <span style={{
              display: "flex",
              "align-items": "center",
              gap: "4px",
              padding: "2px 6px",
              "border-radius": "4px",
              background: "rgba(148, 163, 184, 0.1)",
            }}>
              <span style={{
                width: "20px",
                height: "2px",
                background: color,
                "border-top": `2px ${dashForLinkType(type as LinkType)} ${color}`,
              }} />
              {type}
            </span>
          ))}
        </div>
      </div>

      <svg
        ref={setSvgRef}
        style={{
          width: "100%",
          height: "100%",
          cursor: isDragging() ? "grabbing" : "grab",
          background: "transparent",
        }}
        onWheel={handleZoom}
      />
    </div>
  )
}

export function GraphViewDemo() {
  const mockNodes: MemoryNode[] = [
    { id: MemoryNodeID.make("mem_1"), type: "decision", title: "Use SQLite for memory index", content: "Chose SQLite over PostgreSQL for the memory system's metadata index because it's lightweight and embedded", tags: ["database", "architecture", "sqlite"], sessionId: SessionID.make("ses_1"), created: Date.now() - 86400000, updated: Date.now() - 86400000, confidence: 0.95, path: AbsolutePath.make("/memory/ses_1/mem_1") },
    { id: MemoryNodeID.make("mem_2"), type: "pattern", title: "Effect v4 beta.74 API patterns", content: "Documented all breaking changes in Effect v4 beta.74: catchAll→catch, forkDaemon→forkScoped, etc.", tags: ["effect", "typescript", "api"], sessionId: SessionID.make("ses_1"), created: Date.now() - 172800000, updated: Date.now() - 172800000, confidence: 0.9, path: AbsolutePath.make("/memory/ses_1/mem_2") },
    { id: MemoryNodeID.make("mem_3"), type: "error", title: "Drizzle adapter raw SQL bug", content: "Raw SQL with ? placeholders silently drops params. Must use sql template literals.", tags: ["drizzle", "sqlite", "bug"], sessionId: SessionID.make("ses_1"), created: Date.now() - 259200000, updated: Date.now() - 259200000, confidence: 1.0, path: AbsolutePath.make("/memory/ses_1/mem_3") },
    { id: MemoryNodeID.make("mem_4"), type: "entity", title: "DiveeOI server architecture", content: "Effect-TS HttpRouter/HttpApi framework with SolidJS frontend", tags: ["architecture", "effect", "solidjs"], sessionId: SessionID.make("ses_1"), created: Date.now() - 345600000, updated: Date.now() - 345600000, confidence: 0.95, path: AbsolutePath.make("/memory/ses_1/mem_4") },
    { id: MemoryNodeID.make("mem_5"), type: "preference", title: "TypeScript strict mode", content: "Always use verbatimModuleSyntax: true and noUncheckedIndexedAccess: true", tags: ["typescript", "config", "strict"], sessionId: SessionID.make("ses_1"), created: Date.now() - 432000000, updated: Date.now() - 432000000, confidence: 0.85, path: AbsolutePath.make("/memory/ses_1/mem_5") },
    { id: MemoryNodeID.make("mem_6"), type: "fact", title: "AMD Radeon HD 6350 constraints", content: "TeraScale 2 GPU needs texture2D() not texture(), no ivec/uvec, max 16 samplers", tags: ["gpu", "glsl", "terascale"], sessionId: SessionID.make("ses_2"), created: Date.now() - 518400000, updated: Date.now() - 518400000, confidence: 1.0, path: AbsolutePath.make("/memory/ses_2/mem_6") },
    { id: MemoryNodeID.make("mem_7"), type: "constraint", title: "Memory package size limit", content: "Max 1000 nodes per session, 20 edges per node for performance", tags: ["memory", "performance", "limits"], sessionId: SessionID.make("ses_1"), created: Date.now() - 604800000, updated: Date.now() - 604800000, confidence: 0.9, path: AbsolutePath.make("/memory/ses_1/mem_7") },
    { id: MemoryNodeID.make("mem_8"), type: "pattern", title: "LayerNode composition pattern", content: "Use LayerNode.group for parallel composition, LayerNode.make for single services", tags: ["effect", "layer", "pattern"], sessionId: SessionID.make("ses_1"), created: Date.now() - 691200000, updated: Date.now() - 691200000, confidence: 0.88, path: AbsolutePath.make("/memory/ses_1/mem_8") },
    { id: MemoryNodeID.make("mem_9"), type: "decision", title: "Use D3 for graph visualization", content: "D3 force-directed layout provides best Obsidian-like experience", tags: ["d3", "visualization", "graph"], sessionId: SessionID.make("ses_1"), created: Date.now() - 777600000, updated: Date.now() - 777600000, confidence: 0.92, path: AbsolutePath.make("/memory/ses_1/mem_9") },
    { id: MemoryNodeID.make("mem_10"), type: "entity", title: "Obsidian graph view", content: "Force-directed graph with charge, link, collision, and center forces", tags: ["obsidian", "graph", "visualization"], sessionId: SessionID.make("ses_1"), created: Date.now() - 864000000, updated: Date.now() - 864000000, confidence: 0.9, path: AbsolutePath.make("/memory/ses_1/mem_10") },
  ]

  const mockLinks: MemoryLink[] = [
    { sourceId: MemoryNodeID.make("mem_1"), targetId: MemoryNodeID.make("mem_2"), type: "references", created: Date.now() - 100000 },
    { sourceId: MemoryNodeID.make("mem_2"), targetId: MemoryNodeID.make("mem_3"), type: "see_also", created: Date.now() - 200000 },
    { sourceId: MemoryNodeID.make("mem_1"), targetId: MemoryNodeID.make("mem_4"), type: "references", created: Date.now() - 300000 },
    { sourceId: MemoryNodeID.make("mem_4"), targetId: MemoryNodeID.make("mem_8"), type: "see_also", created: Date.now() - 400000 },
    { sourceId: MemoryNodeID.make("mem_8"), targetId: MemoryNodeID.make("mem_9"), type: "references", created: Date.now() - 500000 },
    { sourceId: MemoryNodeID.make("mem_9"), targetId: MemoryNodeID.make("mem_10"), type: "see_also", created: Date.now() - 600000 },
    { sourceId: MemoryNodeID.make("mem_3"), targetId: MemoryNodeID.make("mem_7"), type: "contradicts", created: Date.now() - 700000 },
    { sourceId: MemoryNodeID.make("mem_5"), targetId: MemoryNodeID.make("mem_2"), type: "references", created: Date.now() - 800000 },
    { sourceId: MemoryNodeID.make("mem_6"), targetId: MemoryNodeID.make("mem_9"), type: "see_also", created: Date.now() - 900000 },
    { sourceId: MemoryNodeID.make("mem_4"), targetId: MemoryNodeID.make("mem_5"), type: "supersedes", created: Date.now() - 1000000 },
  ]

  return (
    <div style={{ width: "100%", height: "100vh", background: "#0f172a" }}>
      <GraphView
        nodes={mockNodes}
        links={mockLinks}
        width={1400}
        height={900}
        showLabels={true}
        showEdgeLabels={true}
        physicsEnabled={true}
        nodeSize={10}
        chargeStrength={-400}
        linkDistance={120}
        centerForce={true}
        collisionRadius={16}
        onNodeClick={(node) => console.log("Node clicked:", node)}
        onLinkClick={(link) => console.log("Link clicked:", link)}
      />
    </div>
  )
}