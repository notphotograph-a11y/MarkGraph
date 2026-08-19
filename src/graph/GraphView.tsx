/**
 * 全库力导向图谱（F4）：d3-force 布局 + canvas 渲染。
 * 交互对齐 style-samples：悬停高亮邻居、拖拽节点、空白平移、滚轮缩放、双击复位。
 */
import { useEffect, useRef, useState } from 'react'
import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  type Simulation,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from 'd3-force'
import { useStore } from '@/state/store'
import { bus } from '@/shell/bus'
import type { GraphEdge, GraphNode } from './indexer'

interface SimNode extends SimulationNodeDatum {
  id: string
  name: string
  folder: string
  ghost: boolean
  degree: number
  colorIndex: number
  pinned?: boolean
}

interface SimLink extends SimulationLinkDatum<SimNode> {
  resolved: boolean
}

interface Palette {
  colors: [string, string, string]
  edge: string
  label: string
  accent: string
  broken: string
  content: string
}

interface ViewState {
  scale: number
  panX: number
  panY: number
}

function readPalette(): Palette {
  const cs = getComputedStyle(document.documentElement)
  return {
    colors: [
      cs.getPropertyValue('--mg-g1').trim() || '#0071e3',
      cs.getPropertyValue('--mg-g2').trim() || '#7d5be0',
      cs.getPropertyValue('--mg-g3').trim() || '#e08600',
    ],
    edge: cs.getPropertyValue('--mg-g-edge').trim() || 'rgba(0,0,0,.16)',
    label: cs.getPropertyValue('--mg-g-label').trim() || '#48484d',
    accent: cs.getPropertyValue('--primary').trim() || '#0071e3',
    broken: cs.getPropertyValue('--mg-broken').trim() || '#c2372f',
    content: cs.getPropertyValue('--mg-content-bg').trim() || '#fff',
  }
}

function groupKey(folder: string): string {
  if (!folder) return '（根目录）'
  return folder.split('/')[0]
}

function radiusOf(degree: number): number {
  return 4.4 + 2.15 * Math.min(degree, 8)
}

function asSimNode(v: string | number | SimNode): SimNode | null {
  return typeof v === 'object' && v != null ? v : null
}

function linkEnds(l: SimLink): { a: SimNode; b: SimNode } | null {
  const a = asSimNode(l.source)
  const b = asSimNode(l.target)
  if (!a || !b) return null
  return { a, b }
}

function buildSimGraph(nodes: GraphNode[], edges: GraphEdge[]): { nodes: SimNode[]; links: SimLink[]; groups: string[] } {
  const deg = new Map<string, number>()
  for (const e of edges) {
    deg.set(e.source, (deg.get(e.source) ?? 0) + 1)
    deg.set(e.target, (deg.get(e.target) ?? 0) + 1)
  }
  const groups = [...new Set(nodes.map(n => groupKey(n.folder)))].sort((a, b) => a.localeCompare(b, 'zh'))
  const colorOf = (folder: string) => Math.max(0, groups.indexOf(groupKey(folder))) % 3
  const simNodes: SimNode[] = nodes.map((n, i) => {
    const g = groups.indexOf(groupKey(n.folder))
    const a = (Math.max(0, g) * 2.1 + i * 0.47) % (Math.PI * 2)
    const ring = 90 + Math.max(0, g) * 48
    return {
      id: n.id,
      name: n.name,
      folder: n.folder,
      ghost: n.ghost,
      degree: deg.get(n.id) ?? 0,
      colorIndex: colorOf(n.folder),
      x: Math.cos(a) * ring,
      y: Math.sin(a) * ring,
    }
  })
  const idSet = new Set(simNodes.map(n => n.id))
  const links: SimLink[] = edges
    .filter(e => idSet.has(e.source) && idSet.has(e.target))
    .map(e => ({ source: e.source, target: e.target, resolved: e.resolved }))
  return { nodes: simNodes, links, groups }
}

export function GraphView() {
  const index = useStore(s => s.index)
  const theme = useStore(s => s.theme)
  const lastNotePath = useStore(s => s.lastNotePath)
  const openNote = useStore(s => s.openNote)
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const currentRef = useRef<string | null>(null)
  const indexRef = useRef(index)
  const paletteRef = useRef<Palette>(readPalette())
  const signature = index
    ? `${index.nodes.map(n => `${n.id}:${n.ghost}`).join('\n')}\n${index.edges.map(e => `${e.source}>${e.target}:${e.resolved}`).join('\n')}`
    : ''
  const [hoverName, setHoverName] = useState<string | null>(null)
  const [legendOn, setLegendOn] = useState(true)
  const [groups, setGroups] = useState<string[]>([])

  currentRef.current = lastNotePath
  indexRef.current = index
  paletteRef.current = readPalette()

  useEffect(() => {
    paletteRef.current = readPalette()
  }, [theme])

  useEffect(() => {
    const canvas = canvasRef.current
    const wrap = wrapRef.current
    const snap = indexRef.current
    if (!canvas || !wrap || !snap) return

    const built = buildSimGraph(snap.nodes, snap.edges)
    setGroups(built.groups)
    const nodes = built.nodes
    const links = built.links
    const neighbors = new Map<string, Set<string>>()
    for (const e of built.links) {
      const s = typeof e.source === 'object' ? e.source.id : String(e.source)
      const t = typeof e.target === 'object' ? e.target.id : String(e.target)
      if (!neighbors.has(s)) neighbors.set(s, new Set())
      if (!neighbors.has(t)) neighbors.set(t, new Set())
      neighbors.get(s)!.add(t)
      neighbors.get(t)!.add(s)
    }

    const view: ViewState = { scale: 1, panX: 0, panY: 0 }
    let w = 0
    let h = 0
    let dpr = 1
    let hover: SimNode | null = null
    let drag: SimNode | null = null
    let panning = false
    let moved = false
    let pointerDown = false
    let raf = 0

    const nodeById = new Map(nodes.map(n => [n.id, n]))
    const sim: Simulation<SimNode, SimLink> = forceSimulation(nodes)
      .force(
        'link',
        forceLink<SimNode, SimLink>(links)
          .id(d => d.id)
          .distance(d => {
            const s = typeof d.source === 'object' ? d.source : nodeById.get(String(d.source))
            const t = typeof d.target === 'object' ? d.target : nodeById.get(String(d.target))
            return 72 + Math.min((s?.degree ?? 0) + (t?.degree ?? 0), 10) * 4
          })
          .strength(0.35),
      )
      .force('charge', forceManyBody<SimNode>().strength(d => (d.ghost ? -80 : -160) - d.degree * 12))
      .force('center', forceCenter(0, 0).strength(0.05))
      .force('x', forceX(0).strength(0.02))
      .force('y', forceY(0).strength(0.02))
      .force(
        'collide',
        forceCollide<SimNode>()
          .radius(d => radiusOf(d.degree) + 8)
          .iterations(2),
      )
      .alpha(1)
      .alphaDecay(0.022)

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const resize = () => {
      const r = wrap.getBoundingClientRect()
      w = r.width
      h = r.height
      dpr = window.devicePixelRatio || 1
      canvas.width = Math.max(1, Math.round(w * dpr))
      canvas.height = Math.max(1, Math.round(h * dpr))
    }

    const toWorld = (offsetX: number, offsetY: number) => ({
      x: (offsetX - w / 2 - view.panX) / view.scale,
      y: (offsetY - h / 2 - view.panY) / view.scale,
    })

    const hit = (offsetX: number, offsetY: number): SimNode | null => {
      const p = toWorld(offsetX, offsetY)
      let best: SimNode | null = null
      let bestD = Infinity
      for (const n of nodes) {
        if (n.x == null || n.y == null) continue
        const dx = p.x - n.x
        const dy = p.y - n.y
        const lim = radiusOf(n.degree) + 6
        const d2 = dx * dx + dy * dy
        if (d2 <= lim * lim && d2 < bestD) {
          best = n
          bestD = d2
        }
      }
      return best
    }

    const draw = () => {
      const palette = paletteRef.current
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, w, h)
      ctx.save()
      ctx.translate(w / 2 + view.panX, h / 2 + view.panY)
      ctx.scale(view.scale, view.scale)

      const current = currentRef.current
      const hoverId = hover?.id ?? null
      const nb = hoverId ? neighbors.get(hoverId) : undefined

      for (const l of links) {
        const ends = linkEnds(l)
        if (!ends || ends.a.x == null || ends.a.y == null || ends.b.x == null || ends.b.y == null) continue
        const lit = hoverId != null && (ends.a.id === hoverId || ends.b.id === hoverId)
        const dim = hoverId != null && !lit
        ctx.globalAlpha = dim ? 0.16 : 1
        ctx.strokeStyle = lit ? palette.accent : l.resolved ? palette.edge : palette.broken
        ctx.lineWidth = (lit ? 2 : 1) / view.scale
        if (!l.resolved) ctx.setLineDash([4 / view.scale, 4 / view.scale])
        else ctx.setLineDash([])
        ctx.beginPath()
        ctx.moveTo(ends.a.x, ends.a.y)
        ctx.lineTo(ends.b.x, ends.b.y)
        ctx.stroke()
      }
      ctx.setLineDash([])

      for (const n of nodes) {
        if (n.x == null || n.y == null) continue
        const r = radiusOf(n.degree)
        const isHover = hoverId === n.id
        const isNb = !!nb?.has(n.id)
        const dim = hoverId != null && !isHover && !isNb
        ctx.globalAlpha = dim ? 0.2 : 1
        if (n.ghost) {
          ctx.fillStyle = palette.content
          ctx.strokeStyle = palette.broken
          ctx.lineWidth = 1.4 / view.scale
          ctx.setLineDash([3 / view.scale, 2.5 / view.scale])
          ctx.beginPath()
          ctx.arc(n.x, n.y, r, 0, Math.PI * 2)
          ctx.fill()
          ctx.stroke()
          ctx.setLineDash([])
        } else {
          ctx.fillStyle = palette.colors[n.colorIndex]
          ctx.beginPath()
          ctx.arc(n.x, n.y, r, 0, Math.PI * 2)
          ctx.fill()
        }
        if (n.id === current && !n.ghost) {
          ctx.strokeStyle = palette.accent
          ctx.lineWidth = 2 / view.scale
          ctx.beginPath()
          ctx.arc(n.x, n.y, r + 3.4 / view.scale, 0, Math.PI * 2)
          ctx.stroke()
        }
        if (isHover || n.degree >= 4 || n.id === current) {
          ctx.globalAlpha = dim ? 0.25 : 0.92
          ctx.fillStyle = palette.label
          ctx.font = `${11 / view.scale}px -apple-system, "PingFang SC", sans-serif`
          ctx.fillText(n.name, n.x + r + 6 / view.scale, n.y + 3.5 / view.scale)
        }
      }
      ctx.globalAlpha = 1
      ctx.restore()
    }

    const loop = () => {
      draw()
      raf = requestAnimationFrame(loop)
    }

    const resetView = () => {
      view.scale = 1
      view.panX = 0
      view.panY = 0
      sim.alpha(0.7).restart()
    }

    const onPointerDown = (e: PointerEvent) => {
      const i = hit(e.offsetX, e.offsetY)
      canvas.setPointerCapture(e.pointerId)
      pointerDown = true
      moved = false
      if (i) {
        drag = i
        i.fx = i.x
        i.fy = i.y
        sim.alphaTarget(0.28).restart()
      } else {
        panning = true
        canvas.classList.add('grabbing')
      }
    }

    const onPointerMove = (e: PointerEvent) => {
      if (Math.abs(e.movementX) + Math.abs(e.movementY) > 2) moved = true
      if (drag) {
        const p = toWorld(e.offsetX, e.offsetY)
        drag.fx = p.x
        drag.fy = p.y
        drag.x = p.x
        drag.y = p.y
      } else if (panning) {
        view.panX += e.movementX
        view.panY += e.movementY
      } else {
        const next = hit(e.offsetX, e.offsetY)
        if (next !== hover) {
          hover = next
          setHoverName(next ? (next.ghost ? `${next.name}（断链）` : next.name) : null)
          canvas.style.cursor = next ? 'pointer' : 'grab'
        }
      }
    }

    const onPointerUp = () => {
      const target = drag
      const wasClick = pointerDown && !moved
      if (drag) {
        drag.pinned = true
        drag.fx = drag.x
        drag.fy = drag.y
        sim.alphaTarget(0)
      }
      drag = null
      panning = false
      pointerDown = false
      canvas.classList.remove('grabbing')
      if (wasClick && target && !target.ghost) {
        bus.emit('link:navigate', target.id)
        void openNote(target.id)
      }
    }

    const onPointerLeave = () => {
      if (drag || panning) return
      hover = null
      setHoverName(null)
      canvas.style.cursor = 'grab'
    }

    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const f = Math.exp(-e.deltaY * 0.0012)
      const ns = Math.min(2.8, Math.max(0.35, view.scale * f))
      view.panX = e.offsetX - w / 2 - ((e.offsetX - w / 2 - view.panX) * ns) / view.scale
      view.panY = e.offsetY - h / 2 - ((e.offsetY - h / 2 - view.panY) * ns) / view.scale
      view.scale = ns
    }

    const onDblClick = (e: MouseEvent) => {
      if (hit(e.offsetX, e.offsetY)) return
      e.preventDefault()
      resetView()
    }

    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(wrap)
    canvas.addEventListener('pointerdown', onPointerDown)
    canvas.addEventListener('pointermove', onPointerMove)
    canvas.addEventListener('pointerup', onPointerUp)
    canvas.addEventListener('pointercancel', onPointerUp)
    canvas.addEventListener('pointerleave', onPointerLeave)
    canvas.addEventListener('wheel', onWheel, { passive: false })
    canvas.addEventListener('dblclick', onDblClick)
    raf = requestAnimationFrame(loop)

    return () => {
      cancelAnimationFrame(raf)
      sim.stop()
      ro.disconnect()
      canvas.removeEventListener('pointerdown', onPointerDown)
      canvas.removeEventListener('pointermove', onPointerMove)
      canvas.removeEventListener('pointerup', onPointerUp)
      canvas.removeEventListener('pointercancel', onPointerUp)
      canvas.removeEventListener('pointerleave', onPointerLeave)
      canvas.removeEventListener('wheel', onWheel)
      canvas.removeEventListener('dblclick', onDblClick)
    }
  }, [signature, openNote])

  if (!index) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-[var(--muted-foreground)]">
        正在构建索引…
      </div>
    )
  }

  if (index.nodes.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-[var(--muted-foreground)]">
        还没有笔记，图谱是空的。
      </div>
    )
  }

  return (
    <div ref={wrapRef} className="relative min-h-0 flex-1">
      <canvas ref={canvasRef} className="mg-graph-canvas absolute inset-0 h-full w-full" />
      <div className="pointer-events-none absolute bottom-3 left-3 rounded-full border border-[var(--border)] bg-[var(--mg-panel)] px-2.5 py-1 text-[11px] text-[var(--muted-foreground)]">
        {hoverName ?? '悬停高亮邻居 · 拖拽节点 · 滚轮缩放 · 双击复位'}
      </div>
      <div className="absolute right-3 bottom-3 flex flex-col items-end gap-1.5">
        <button
          type="button"
          onClick={() => setLegendOn(v => !v)}
          className="rounded-full border border-[var(--border)] bg-[var(--mg-panel)] px-2.5 py-1 text-[11px] text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
        >
          图例
        </button>
        {legendOn && (
          <ul className="min-w-28 rounded-lg border border-[var(--border)] bg-[var(--mg-panel)] px-2.5 py-2 text-[11px] text-[var(--muted-foreground)] shadow-[var(--mg-shadow)]">
            {groups.map((g, i) => (
              <li key={g} className="flex items-center gap-1.5 py-0.5">
                <i
                  className="h-2 w-2 rounded-full"
                  style={{ background: `var(--mg-g${(i % 3) + 1})` }}
                />
                <span className="truncate">{g}</span>
              </li>
            ))}
            {index.nodes.some(n => n.ghost) && (
              <li className="mt-1 flex items-center gap-1.5 border-t border-[var(--border)] pt-1">
                <i className="h-2 w-2 rounded-full border border-dashed border-[var(--mg-broken)]" />
                <span>断链</span>
              </li>
            )}
          </ul>
        )}
      </div>
    </div>
  )
}
