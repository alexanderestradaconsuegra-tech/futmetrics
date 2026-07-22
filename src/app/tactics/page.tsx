"use client"
import { useState, useRef, useCallback, useEffect } from "react"
import { Play, Square, Trash2, Move, Pencil, Save, Plus, Users, Circle } from "lucide-react"

// ── Types ──────────────────────────────────────────────────────────────────────
type MarkerTeam = "home" | "away" | "ball"
interface Marker {
  id: string
  x: number
  y: number
  team: MarkerTeam
  label?: string
}
interface Line {
  id: string
  type: "run" | "pass"
  points: [number, number][]
  color: string
}
interface Play {
  id: string
  name: string
  markers: Marker[]
  lines: Line[]
}

type Tool = "move" | "draw-run" | "draw-pass" | "add-home" | "add-away" | "add-ball"

// ── Constants ──────────────────────────────────────────────────────────────────
const ASSIGN_RADIUS = 8
const ANIM_DURATION = 1800 // ms per line segment

function uid() {
  return Math.random().toString(36).slice(2)
}

// Interpolate position along a polyline at fraction t ∈ [0,1]
function interpolatePath(points: [number, number][], t: number): [number, number] {
  if (points.length < 2) return points[0]
  let total = 0
  const segs: number[] = []
  for (let i = 1; i < points.length; i++) {
    const d = Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1])
    segs.push(d)
    total += d
  }
  let target = t * total
  for (let i = 0; i < segs.length; i++) {
    if (target <= segs[i]) {
      const frac = target / segs[i]
      const a = points[i], b = points[i + 1]
      return [a[0] + (b[0] - a[0]) * frac, a[1] + (b[1] - a[1]) * frac]
    }
    target -= segs[i]
  }
  return points[points.length - 1]
}

// ── Formation presets ──────────────────────────────────────────────────────────
const FORMATIONS: Record<string, { x: number; y: number }[]> = {
  "4-3-3": [
    { x: 5, y: 34 },
    { x: 20, y: 10 }, { x: 20, y: 25 }, { x: 20, y: 43 }, { x: 20, y: 58 },
    { x: 38, y: 18 }, { x: 38, y: 34 }, { x: 38, y: 50 },
    { x: 58, y: 12 }, { x: 58, y: 34 }, { x: 58, y: 56 },
  ],
  "4-4-2": [
    { x: 5, y: 34 },
    { x: 20, y: 10 }, { x: 20, y: 25 }, { x: 20, y: 43 }, { x: 20, y: 58 },
    { x: 42, y: 10 }, { x: 42, y: 28 }, { x: 42, y: 44 }, { x: 42, y: 62 },
    { x: 65, y: 24 }, { x: 65, y: 44 },
  ],
  "3-5-2": [
    { x: 5, y: 34 },
    { x: 20, y: 18 }, { x: 20, y: 34 }, { x: 20, y: 50 },
    { x: 35, y: 6 },  { x: 38, y: 20 }, { x: 38, y: 34 }, { x: 38, y: 48 }, { x: 35, y: 62 },
    { x: 62, y: 24 }, { x: 62, y: 44 },
  ],
}

const SAVED_KEY = "tactics_plays_v1"

function loadPlays(): Play[] {
  try {
    const raw = localStorage.getItem(SAVED_KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

function savePlays(plays: Play[]) {
  localStorage.setItem(SAVED_KEY, JSON.stringify(plays))
}

// ── Pitch SVG overlay ──────────────────────────────────────────────────────────
function PitchLines() {
  const s = "rgba(255,255,255,0.55)"
  const sw = 0.4
  return (
    <g stroke={s} strokeWidth={sw} fill="none">
      {/* Border */}
      <rect x="2" y="2" width="101" height="64" />
      {/* Centre line */}
      <line x1="52.5" y1="2" x2="52.5" y2="66" />
      {/* Centre circle */}
      <circle cx="52.5" cy="34" r="9.15" />
      <circle cx="52.5" cy="34" r="0.5" fill={s} />
      {/* Left penalty area */}
      <rect x="2" y="13.84" width="16.5" height="40.32" />
      {/* Left goal area */}
      <rect x="2" y="24.84" width="5.5" height="18.32" />
      {/* Left goal */}
      <rect x="0" y="29.68" width="2" height="8.64" />
      {/* Left penalty arc */}
      <path d="M18.5,26.6 A9.15,9.15 0 0 1 18.5,41.4" strokeDasharray="2 1" />
      {/* Right penalty area */}
      <rect x="86.5" y="13.84" width="16.5" height="40.32" />
      {/* Right goal area */}
      <rect x="97.5" y="24.84" width="5.5" height="18.32" />
      {/* Right goal */}
      <rect x="103" y="29.68" width="2" height="8.64" />
      {/* Right penalty arc */}
      <path d="M86.5,26.6 A9.15,9.15 0 0 0 86.5,41.4" strokeDasharray="2 1" />
      {/* Corner arcs */}
      <path d="M2,3.5 A1.5,1.5 0 0 1 3.5,2" />
      <path d="M101.5,2 A1.5,1.5 0 0 1 103,3.5" />
      <path d="M103,64.5 A1.5,1.5 0 0 1 101.5,66" />
      <path d="M3.5,66 A1.5,1.5 0 0 1 2,64.5" />
    </g>
  )
}

// ── Main component ─────────────────────────────────────────────────────────────
export default function TacticsPage() {
  const [plays, setPlays] = useState<Play[]>([])
  const [activePlay, setActivePlay] = useState<Play | null>(null)
  const [markers, setMarkers] = useState<Marker[]>([])
  const [lines, setLines] = useState<Line[]>([])
  const [tool, setTool] = useState<Tool>("move")
  const [drawing, setDrawing] = useState<[number, number][] | null>(null)
  const [dragging, setDragging] = useState<string | null>(null)
  const [animPositions, setAnimPositions] = useState<Record<string, [number, number]> | null>(null)
  const [animBall, setAnimBall] = useState<[number, number] | null>(null)
  const [playing, setPlaying] = useState(false)
  const [playName, setPlayName] = useState("Nueva jugada")
  const svgRef = useRef<SVGSVGElement>(null)
  const animRef = useRef<number>(0)

  useEffect(() => {
    setPlays(loadPlays())
  }, [])

  // ── SVG coordinate helper ──
  const toSVG = useCallback((clientX: number, clientY: number): [number, number] => {
    const svg = svgRef.current
    if (!svg) return [0, 0]
    const pt = svg.createSVGPoint()
    pt.x = clientX; pt.y = clientY
    const { x, y } = pt.matrixTransform(svg.getScreenCTM()!.inverse())
    return [Math.max(0, Math.min(105, x)), Math.max(0, Math.min(68, y))]
  }, [])

  // ── Animation ──
  function buildAssignments() {
    const assignments: { markerId: string; line: Line }[] = []
    const ball = markers.find(m => m.team === "ball")
    for (const line of lines) {
      if (line.type === "pass") {
        if (ball) assignments.push({ markerId: ball.id, line })
      } else {
        const start = line.points[0]
        let nearest: Marker | null = null
        let minDist = ASSIGN_RADIUS
        for (const m of markers) {
          if (m.team === "ball") continue
          const d = Math.hypot(m.x - start[0], m.y - start[1])
          if (d < minDist) { minDist = d; nearest = m }
        }
        if (nearest) assignments.push({ markerId: nearest.id, line })
      }
    }
    return assignments
  }

  function startAnimation() {
    const assignments = buildAssignments()
    if (assignments.length === 0) return
    setPlaying(true)

    const startPositions: Record<string, [number, number]> = {}
    for (const m of markers) startPositions[m.id] = [m.x, m.y]

    const ball = markers.find(m => m.team === "ball")
    let ballPos: [number, number] | null = ball ? [ball.x, ball.y] : null
    setAnimBall(ballPos)
    setAnimPositions({ ...startPositions })

    const startTime = performance.now()

    function frame(now: number) {
      const elapsed = now - startTime
      const t = Math.min(elapsed / ANIM_DURATION, 1)

      const newPos: Record<string, [number, number]> = { ...startPositions }
      let newBall: [number, number] | null = ballPos

      for (const { markerId, line } of assignments) {
        const pos = interpolatePath(line.points, t)
        if (line.type === "pass") {
          newBall = pos
        } else {
          newPos[markerId] = pos
        }
      }

      setAnimPositions(newPos)
      setAnimBall(newBall)

      if (t < 1) {
        animRef.current = requestAnimationFrame(frame)
      } else {
        setPlaying(false)
        setTimeout(() => {
          setAnimPositions(null)
          setAnimBall(null)
        }, 600)
      }
    }

    animRef.current = requestAnimationFrame(frame)
  }

  function stopAnimation() {
    cancelAnimationFrame(animRef.current)
    setPlaying(false)
    setAnimPositions(null)
    setAnimBall(null)
  }

  // ── Pointer handlers ──
  function onPointerDown(e: React.PointerEvent<SVGSVGElement>) {
    if (playing) return
    const pos = toSVG(e.clientX, e.clientY)

    if (tool === "move") {
      const hit = markers.find(m => Math.hypot(m.x - pos[0], m.y - pos[1]) < 4)
      if (hit) { setDragging(hit.id); e.currentTarget.setPointerCapture(e.pointerId) }
    } else if (tool === "draw-run" || tool === "draw-pass") {
      setDrawing([pos])
      e.currentTarget.setPointerCapture(e.pointerId)
    } else if (tool === "add-home") {
      setMarkers(ms => [...ms, { id: uid(), x: pos[0], y: pos[1], team: "home", label: String(ms.filter(m => m.team === "home").length + 1) }])
    } else if (tool === "add-away") {
      setMarkers(ms => [...ms, { id: uid(), x: pos[0], y: pos[1], team: "away", label: String(ms.filter(m => m.team === "away").length + 1) }])
    } else if (tool === "add-ball") {
      setMarkers(ms => [...ms.filter(m => m.team !== "ball"), { id: uid(), x: pos[0], y: pos[1], team: "ball" }])
    }
  }

  function onPointerMove(e: React.PointerEvent<SVGSVGElement>) {
    if (playing) return
    const pos = toSVG(e.clientX, e.clientY)
    if (dragging) {
      setMarkers(ms => ms.map(m => m.id === dragging ? { ...m, x: pos[0], y: pos[1] } : m))
    } else if (drawing) {
      setDrawing(d => [...d!, pos])
    }
  }

  function onPointerUp() {
    if (dragging) { setDragging(null); return }
    if (drawing && drawing.length >= 2) {
      const color = tool === "draw-pass" ? "#facc15" : "#60a5fa"
      setLines(ls => [...ls, { id: uid(), type: tool === "draw-pass" ? "pass" : "run", points: drawing, color }])
    }
    setDrawing(null)
  }

  // ── Formation ──
  function applyFormation(key: string) {
    const positions = FORMATIONS[key]
    if (!positions) return
    const ball = markers.find(m => m.team === "ball")
    const newMarkers: Marker[] = positions.map((p, i) => ({
      id: uid(), x: p.x, y: p.y, team: "home" as MarkerTeam,
      label: i === 0 ? "P" : String(i),
    }))
    if (ball) newMarkers.push(ball)
    setMarkers(newMarkers)
    setLines([])
  }

  // ── Save / load ──
  function savePlay() {
    const play: Play = { id: uid(), name: playName, markers, lines }
    const updated = [...plays.filter(p => p.id !== activePlay?.id), play]
    setPlays(updated)
    setActivePlay(play)
    savePlays(updated)
  }

  function loadPlay(play: Play) {
    setActivePlay(play)
    setMarkers(play.markers)
    setLines(play.lines)
    setPlayName(play.name)
    setAnimPositions(null)
    setAnimBall(null)
    stopAnimation()
  }

  function deletePlay(id: string) {
    const updated = plays.filter(p => p.id !== id)
    setPlays(updated)
    savePlays(updated)
    if (activePlay?.id === id) {
      setActivePlay(null)
      setMarkers([])
      setLines([])
    }
  }

  function newPlay() {
    setActivePlay(null)
    setMarkers([])
    setLines([])
    setPlayName("Nueva jugada")
    stopAnimation()
  }

  // ── Render marker positions (real or animated) ──
  function getMarkerPos(m: Marker): [number, number] {
    if (animPositions && animPositions[m.id]) return animPositions[m.id]
    return [m.x, m.y]
  }

  const ball = markers.find(m => m.team === "ball")
  const ballPos = animBall ?? (ball ? [ball.x, ball.y] as [number, number] : null)

  return (
    <div className="min-h-screen bg-slate-50 pb-24 md:pb-0 md:pl-64">
      <div className="max-w-6xl mx-auto px-4 py-6">
        <h1 className="text-2xl font-bold text-slate-900 mb-6">Tabla Táctica</h1>

        <div className="flex flex-col lg:flex-row gap-6">
          {/* ── Pitch ── */}
          <div className="flex-1">
            {/* Toolbar */}
            <div className="flex flex-wrap gap-2 mb-3">
              {[
                { t: "move" as Tool, icon: Move, label: "Mover" },
                { t: "draw-run" as Tool, icon: Pencil, label: "Movimiento", color: "text-blue-500" },
                { t: "draw-pass" as Tool, icon: Pencil, label: "Pase", color: "text-yellow-500" },
                { t: "add-home" as Tool, icon: Users, label: "+ Local", color: "text-blue-600" },
                { t: "add-away" as Tool, icon: Users, label: "+ Visita", color: "text-red-500" },
                { t: "add-ball" as Tool, icon: Circle, label: "+ Balón", color: "text-white" },
              ].map(({ t, icon: Icon, label, color }) => (
                <button
                  key={t}
                  onClick={() => setTool(t)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all ${
                    tool === t
                      ? "bg-[#0B5CFF] text-white border-[#0B5CFF] shadow"
                      : "bg-white text-slate-600 border-slate-200 hover:border-blue-300"
                  }`}
                >
                  <Icon size={13} className={tool !== t ? color : ""} />
                  {label}
                </button>
              ))}
              <div className="flex items-center gap-1 ml-auto">
                <select
                  className="text-xs border border-slate-200 rounded-lg px-2 py-1.5 bg-white text-slate-700"
                  onChange={e => applyFormation(e.target.value)}
                  defaultValue=""
                >
                  <option value="" disabled>Formación…</option>
                  {Object.keys(FORMATIONS).map(f => <option key={f} value={f}>{f}</option>)}
                </select>
                <button
                  onClick={() => { setLines([]); setMarkers([]) }}
                  className="p-1.5 rounded-lg border border-slate-200 bg-white text-slate-400 hover:text-red-500 hover:border-red-200 transition-colors"
                  title="Borrar todo"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>

            {/* Pitch */}
            <div className="relative w-[90%] mx-auto rounded-xl overflow-hidden bg-gradient-to-b from-emerald-600 to-emerald-700 select-none touch-none aspect-[105/68] shadow-xl">
              <svg
                ref={svgRef}
                viewBox="0 0 105 68"
                className="absolute inset-0 w-full h-full cursor-crosshair"
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
              >
                <PitchLines />

                {/* Drawn lines */}
                {lines.map(line => (
                  <polyline
                    key={line.id}
                    points={line.points.map(p => p.join(",")).join(" ")}
                    stroke={line.color}
                    strokeWidth={0.8}
                    fill="none"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    markerEnd={`url(#arrow-${line.type})`}
                    opacity={0.85}
                  />
                ))}

                {/* In-progress line */}
                {drawing && drawing.length >= 2 && (
                  <polyline
                    points={drawing.map(p => p.join(",")).join(" ")}
                    stroke={tool === "draw-pass" ? "#facc15" : "#60a5fa"}
                    strokeWidth={0.8}
                    fill="none"
                    strokeLinecap="round"
                    strokeDasharray="2 1"
                    opacity={0.7}
                  />
                )}

                {/* Arrow markers */}
                <defs>
                  <marker id="arrow-run" markerWidth="4" markerHeight="4" refX="3" refY="2" orient="auto">
                    <path d="M0,0 L4,2 L0,4 Z" fill="#60a5fa" />
                  </marker>
                  <marker id="arrow-pass" markerWidth="4" markerHeight="4" refX="3" refY="2" orient="auto">
                    <path d="M0,0 L4,2 L0,4 Z" fill="#facc15" />
                  </marker>
                </defs>

                {/* Player markers */}
                {markers.filter(m => m.team !== "ball").map(m => {
                  const [mx, my] = getMarkerPos(m)
                  const isHome = m.team === "home"
                  return (
                    <g key={m.id} style={{ cursor: tool === "move" ? "grab" : "default" }}>
                      <circle cx={mx} cy={my} r={3.2}
                        fill={isHome ? "#1d4ed8" : "#dc2626"}
                        stroke="white" strokeWidth={0.5}
                      />
                      {m.label && (
                        <text x={mx} y={my + 0.8} textAnchor="middle" dominantBaseline="middle"
                          fontSize={2.2} fontWeight="bold" fill="white"
                        >{m.label}</text>
                      )}
                    </g>
                  )
                })}

                {/* Ball */}
                {ballPos && (
                  <g>
                    <circle cx={ballPos[0]} cy={ballPos[1]} r={2.2}
                      fill="white" stroke="#d1d5db" strokeWidth={0.4}
                    />
                  </g>
                )}
              </svg>
            </div>

            {/* Play controls */}
            <div className="flex items-center justify-center gap-3 mt-4">
              <button
                onClick={playing ? stopAnimation : startAnimation}
                disabled={lines.length === 0}
                className="flex items-center gap-2 px-5 py-2 rounded-xl bg-[#0B5CFF] text-white text-sm font-semibold shadow hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                {playing ? <><Square size={15} /> Detener</> : <><Play size={15} /> Ver jugada</>}
              </button>
            </div>
          </div>

          {/* ── Sidebar: save & plays list ── */}
          <div className="lg:w-72 space-y-4">
            {/* Save form */}
            <div className="bg-white rounded-2xl border border-slate-100 p-4 shadow-sm">
              <h2 className="text-sm font-semibold text-slate-700 mb-3">Guardar jugada</h2>
              <input
                value={playName}
                onChange={e => setPlayName(e.target.value)}
                placeholder="Nombre de la jugada"
                className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 mb-3 focus:outline-none focus:border-blue-400"
              />
              <div className="flex gap-2">
                <button
                  onClick={savePlay}
                  className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-[#0B5CFF] text-white text-xs font-semibold hover:bg-blue-700 transition-colors"
                >
                  <Save size={13} /> Guardar
                </button>
                <button
                  onClick={newPlay}
                  className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 text-slate-600 text-xs font-semibold hover:bg-slate-50 transition-colors"
                >
                  <Plus size={13} /> Nueva
                </button>
              </div>
            </div>

            {/* Plays list */}
            {plays.length > 0 && (
              <div className="bg-white rounded-2xl border border-slate-100 p-4 shadow-sm">
                <h2 className="text-sm font-semibold text-slate-700 mb-3">Jugadas guardadas</h2>
                <div className="space-y-2">
                  {plays.map(play => (
                    <div
                      key={play.id}
                      className={`flex items-center gap-2 p-2.5 rounded-xl border cursor-pointer transition-all ${
                        activePlay?.id === play.id
                          ? "border-blue-300 bg-blue-50"
                          : "border-slate-100 hover:border-slate-200 hover:bg-slate-50"
                      }`}
                      onClick={() => loadPlay(play)}
                    >
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-semibold text-slate-800 truncate">{play.name}</p>
                        <p className="text-[10px] text-slate-400">{play.markers.length} jugadores · {play.lines.length} líneas</p>
                      </div>
                      <button
                        onClick={e => { e.stopPropagation(); deletePlay(play.id) }}
                        className="w-6 h-6 flex items-center justify-center rounded-lg text-slate-300 hover:text-red-500 hover:bg-red-50 transition-colors"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
