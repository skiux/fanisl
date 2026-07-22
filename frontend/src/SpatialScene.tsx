import { Html } from '@react-three/drei'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { createContext, Suspense, useContext, useEffect, useMemo, useRef } from 'react'
import type { RefObject, ReactNode } from 'react'
import {
  BufferGeometry,
  Color,
  Fog,
  Group,
  Line as ThreeLine,
  LineBasicMaterial,
  MathUtils,
  Vector3,
} from 'three'
import { chapters } from './journey'

type Point3 = [number, number, number]

type SpatialSceneProps = {
  compact: boolean
  progress: RefObject<number>
}

const palette = {
  ink: '#222a23',
  sage: '#849570',
  lime: '#dce8b9',
  lavender: '#c8c3dc',
  peach: '#e3bca8',
  paper: '#f4f2ea',
}

const panelPositions = {
  entry: [0, 0, 0] as Point3,
  source: [-2.4, 0, -19] as Point3,
  units: [2.4, 0, -40] as Point3,
  node: [-2.2, 0, -61] as Point3,
  relations: [2.2, 0, -82] as Point3,
  library: [0, 0, -103] as Point3,
}

const JourneyProgressContext = createContext<RefObject<number> | null>(null)

const chapterByClass = {
  'entry-world': 0,
  'source-world': 1,
  'units-world': 2,
  'node-world': 3,
  'relations-world': 4,
  'library-world': 5,
} as const

function random(index: number, salt: number) {
  return ((Math.sin(index * 127.1 + salt * 311.7) * 43758.5453) % 1 + 1) % 1
}

function easeOutBack(value: number, strength: number) {
  const offset = value - 1
  const tension = 1.70158 * strength
  return 1 + (tension + 1) * offset * offset * offset + tension * offset * offset
}

const motionSpring: Record<string, number> = {
  'card-center': 0.52,
  'card-left': 0.46,
  'card-right': 0.46,
  'card-turn': 0.42,
  number: 0.32,
  paper: 0.38,
  pop: 0.68,
}

function sampleJourney(points: Vector3[], progress: number, output: Vector3, lift = 0) {
  const last = chapters.length - 1
  if (progress >= chapters[last].stop) return output.copy(points[last])

  const next = chapters.findIndex((chapter) => progress < chapter.stop)
  const start = Math.max(0, next - 1)
  const span = chapters[next].stop - chapters[start].stop
  const raw = MathUtils.clamp((progress - chapters[start].stop) / span, 0, 1)
  const local = MathUtils.smootherstep(raw, 0.08, 0.88)
  output.lerpVectors(points[start], points[next], local)
  output.y += Math.sin(local * Math.PI) * lift
  return output
}

function PathLine({ color = palette.sage, opacity = 0.25, points }: { color?: string; opacity?: number; points: Point3[] }) {
  const geometry = useMemo(
    () => new BufferGeometry().setFromPoints(points.map((point) => new Vector3(...point))),
    [points],
  )
  const material = useMemo(() => new LineBasicMaterial({ color, opacity, transparent: true }), [color, opacity])
  const line = useMemo(() => new ThreeLine(geometry, material), [geometry, material])

  useEffect(() => () => {
    geometry.dispose()
    material.dispose()
  }, [geometry, material])

  return <primitive object={line} />
}

function ParticleField({ compact }: { compact: boolean }) {
  const count = compact ? 260 : 620
  const positions = useMemo(() => {
    const values = new Float32Array(count * 3)
    for (let index = 0; index < count; index += 1) {
      values[index * 3] = (random(index, 1) - 0.5) * 28
      values[index * 3 + 1] = (random(index, 2) - 0.5) * 16
      values[index * 3 + 2] = 6 - random(index, 3) * 122
    }
    return values
  }, [count])

  return (
    <points>
      <bufferGeometry>
        <bufferAttribute args={[positions, 3]} attach="attributes-position" />
      </bufferGeometry>
      <pointsMaterial color="#6f7c6b" opacity={0.28} size={0.034} sizeAttenuation transparent />
    </points>
  )
}

function Frame({ color = palette.sage, height = 7.2, width = 12.2 }: { color?: string; height?: number; width?: number }) {
  const x = width / 2
  const y = height / 2
  return (
    <group position={[0, 0, -0.08]}>
      <PathLine color={color} opacity={0.16} points={[[-x, -y, 0], [x, -y, 0], [x, y, 0], [-x, y, 0], [-x, -y, 0]]} />
      {[[x, y], [-x, y], [x, -y], [-x, -y]].map(([px, py], index) => (
        <mesh key={index} position={[px, py, 0]}>
          <sphereGeometry args={[0.035, 10, 10]} />
          <meshBasicMaterial color={color} opacity={0.52} transparent />
        </mesh>
      ))}
    </group>
  )
}

function WorldSection({ children, className, frameColor, position, rotation = [0, 0, 0] }: {
  children: ReactNode
  className: string
  frameColor?: string
  position: Point3
  rotation?: Point3
}) {
  const panel = useRef<HTMLElement>(null)
  const motionElements = useRef<HTMLElement[]>([])
  const introElapsed = useRef(0)
  const motionElapsed = useRef(0)
  const worldPosition = useMemo(() => new Vector3(...position), [position])
  const compact = useThree((state) => state.size.width <= 760)
  const journeyProgress = useContext(JourneyProgressContext)
  const chapterIndex = chapterByClass[className as keyof typeof chapterByClass]

  useFrame(({ camera }, delta) => {
    if (!panel.current) return
    const distance = camera.position.distanceTo(worldPosition)
    const depthGap = camera.position.z - position[2]
    const farVisibility = 1 - MathUtils.smoothstep(distance, 22, 30)
    const nearVisibility = MathUtils.smoothstep(distance, 3.2, 6.2)
    const frontVisibility = MathUtils.smoothstep(depthGap, 7.8, 10.5)
    const opacity = MathUtils.clamp(farVisibility * nearVisibility * frontVisibility, 0, 1)
    panel.current.style.opacity = opacity.toFixed(3)
    panel.current.style.visibility = opacity < 0.008 ? 'hidden' : 'visible'
    if (opacity < 0.008 && distance > 30) return

    if (motionElements.current.length === 0) {
      motionElements.current = Array.from(panel.current.querySelectorAll<HTMLElement>('[data-motion]'))
    }

    introElapsed.current = Math.min(4.4, introElapsed.current + delta)
    motionElapsed.current += delta
    const arrival = 1 - MathUtils.smoothstep(distance, 13.5, 28)
    let sectionReveal = arrival
    if (chapterIndex === 0) {
      sectionReveal *= MathUtils.smootherstep(introElapsed.current / 4.4, 0, 1)
    } else if (journeyProgress) {
      const previousStop = chapters[chapterIndex - 1].stop
      const stop = chapters[chapterIndex].stop
      const localProgress = MathUtils.clamp((journeyProgress.current - previousStop) / (stop - previousStop), 0, 1)
      sectionReveal = localProgress
    }

    motionElements.current.forEach((element, index) => {
      const motion = element.dataset.motion ?? ''
      const delay = Number(element.dataset.motionDelay ?? Math.min(0.66, index * 0.048))
      const duration = Number(element.dataset.motionDuration ?? 0.32)
      const phase = MathUtils.clamp((sectionReveal - delay) / duration, 0, 1)
      const reveal = MathUtils.smootherstep(phase, 0, 1)
      const spring = Number(element.dataset.motionSpring ?? motionSpring[motion] ?? 0)
      const movement = spring > 0 ? easeOutBack(phase, spring) : reveal
      const exitOffset = Number(element.dataset.motionExit ?? delay * 0.7)
      const exitStart = 7.45 + exitOffset
      const exit = 1 - MathUtils.smoothstep(depthGap, exitStart, exitStart + 3.1)
      const idle = Number(element.dataset.motionIdle ?? 0)
      const hold = MathUtils.smootherstep(reveal, 0.82, 1) * (1 - exit)
      const driftX = Math.sin(motionElapsed.current * 0.46 + index * 1.37) * idle * hold
      const driftY = Math.cos(motionElapsed.current * 0.39 + index * 0.91) * idle * 0.55 * hold
      const driftRotate = Math.sin(motionElapsed.current * 0.31 + index * 0.74) * idle * 0.045 * hold
      element.style.setProperty('--motion', movement.toFixed(4))
      element.style.setProperty('--motion-inverse', (1 - movement).toFixed(4))
      element.style.setProperty('--motion-exit', exit.toFixed(4))
      element.style.setProperty('--motion-opacity', (reveal * (1 - exit)).toFixed(4))
      element.style.setProperty('--motion-drift-x', `${driftX.toFixed(3)}px`)
      element.style.setProperty('--motion-drift-y', `${driftY.toFixed(3)}px`)
      element.style.setProperty('--motion-drift-r', `${driftRotate.toFixed(4)}deg`)
    })
  })

  return (
    <group position={position} rotation={rotation}>
      {className !== 'entry-world' && <Frame color={frameColor} />}
      <Html center distanceFactor={compact || className === 'entry-world' ? 6 : 4.6} transform wrapperClass="world-html" zIndexRange={[80, 0]}>
        <section className={`world-panel ${className}`} ref={panel}>{children}</section>
      </Html>
    </group>
  )
}

function EntryWorld() {
  const ring = useRef<Group>(null)
  const stage = useMemo(() => new Vector3(...panelPositions.entry), [])
  useFrame(({ camera }, delta) => {
    if (!ring.current) return
    const presence = 1 - MathUtils.smoothstep(camera.position.distanceTo(stage), 14, 30)
    ring.current.rotation.z += delta * (0.004 + presence * 0.006)
    ring.current.children.forEach((child, index) => {
      child.rotation.z += delta * (0.006 + index * 0.003 + presence * 0.004)
      child.scale.setScalar(0.78 + presence * 0.22)
    })
  })

  return (
    <>
      <group position={panelPositions.entry} ref={ring}>
        {[3.6, 4.45, 5.35].map((radius, index) => (
          <mesh key={radius} rotation={[index * 0.09, index * -0.07, index * 0.3]}>
            <torusGeometry args={[radius, index === 0 ? 0.018 : 0.011, 8, 180]} />
            <meshBasicMaterial color={[palette.sage, palette.lavender, palette.peach][index]} opacity={0.28} transparent />
          </mesh>
        ))}
      </group>
      <WorldSection className="entry-world" position={panelPositions.entry}>
        <p className="world-eyebrow" data-motion="eyebrow" data-motion-delay="0.03" data-motion-duration="0.24"><span>FANISL</span> · PERSONAL INVESTMENT KNOWLEDGE ENGINE</p>
        <h1>
          <span data-motion="line" data-motion-delay="0.11" data-motion-duration="0.34">把分散的投资内容，</span>
          <span data-motion="line" data-motion-delay="0.22" data-motion-duration="0.38"><em>沉淀成自己的知识。</em></span>
        </h1>
        <p className="world-summary" data-motion="paragraph" data-motion-delay="0.34" data-motion-duration="0.34">保存原文，拆出判断、方法与认知，再让它们归并、演进并彼此连接。滚动不是把页面向上推，而是沿着一条知识形成的路径继续向里。</p>
        <div className="entry-stats" data-motion="panel-rise" data-motion-delay="0.47" data-motion-duration="0.38" data-motion-idle="0.45">
          <span data-motion="cell" data-motion-delay="0.55" data-motion-duration="0.26"><b>18</b>篇内容</span><i data-motion="rule-y" data-motion-delay="0.59" data-motion-duration="0.3" />
          <span data-motion="cell" data-motion-delay="0.63" data-motion-duration="0.26"><b>247</b>个知识单元</span><i data-motion="rule-y" data-motion-delay="0.67" data-motion-duration="0.3" />
          <span data-motion="cell" data-motion-delay="0.71" data-motion-duration="0.26"><b>105</b>个知识节点</span>
        </div>
      </WorldSection>
    </>
  )
}

function SourceWorld() {
  const fragments = useRef<Group>(null)
  const fragmentElapsed = useRef(0)
  const stage = useMemo(() => new Vector3(...panelPositions.source), [])
  useFrame(({ camera }, delta) => {
    if (!fragments.current) return
    const presence = 1 - MathUtils.smoothstep(camera.position.distanceTo(stage), 15, 34)
    fragmentElapsed.current += delta
    fragments.current.rotation.z += delta * (0.003 + presence * 0.006)
    fragments.current.rotation.y = (1 - presence) * -0.18
    fragments.current.children.forEach((child, index) => {
      const reveal = MathUtils.smootherstep(presence, index * 0.07, 0.58 + index * 0.06)
      const targetX = index % 2 ? 4.9 : -5.3
      const targetY = index % 2 ? -2.8 : 2.5
      child.position.x = targetX * (0.42 + reveal * 0.58)
      child.position.y = targetY * (0.5 + reveal * 0.5) + Math.sin(fragmentElapsed.current * 0.32 + index) * 0.025 * reveal
      child.scale.setScalar(0.28 + reveal * 0.72)
      child.rotation.z += delta * (index % 2 ? -0.012 : 0.01) * reveal
    })
  })

  return (
    <>
      <WorldSection className="source-world" frameColor={palette.lavender} position={panelPositions.source} rotation={[0, 0.12, -0.015]}>
        <div className="world-copy">
          <p className="world-eyebrow" data-motion="eyebrow" data-motion-delay="0.1" data-motion-duration="0.24">01 · CONTENT / L0</p>
          <h2>
            <span data-motion="line" data-motion-delay="0.18" data-motion-duration="0.34">所有知识，先有一段</span>
            <span data-motion="line" data-motion-delay="0.28" data-motion-duration="0.36">可以返回的原文。</span>
          </h2>
          <p className="world-summary" data-motion="paragraph" data-motion-delay="0.39" data-motion-duration="0.34">转录、画面信息、发布时间与信源完整留存。后面的任何提取和归并，都能沿路径退回证据。</p>
        </div>
        <article className="source-document" data-motion="paper" data-motion-delay="0.25" data-motion-duration="0.46" data-motion-idle="0.7">
          <header data-motion="rise" data-motion-delay="0.43" data-motion-duration="0.27"><span>CONTENT 018</span><small>16:42 · 原始内容</small></header>
          <div className="source-title"><span data-motion="line" data-motion-delay="0.5" data-motion-duration="0.29">AI 与百年前的</span><strong data-motion="line" data-motion-delay="0.57" data-motion-duration="0.3">电力革命</strong></div>
          <blockquote data-motion="highlight" data-motion-delay="0.65" data-motion-duration="0.29">“真正改变生产率的，不是基础设施建成的那一天，而是组织方式开始随之变化。”</blockquote>
          <footer data-motion="rule" data-motion-delay="0.73" data-motion-duration="0.25"><span>逐字转录 13,657</span><span>画面笔记 12</span></footer>
        </article>
      </WorldSection>
      <group position={panelPositions.source} ref={fragments}>
        {[-14, -16.2, -21.8, -24].map((z, index) => (
          <mesh key={z} position={[index % 2 ? 4.9 : -5.3, index % 2 ? -2.8 : 2.5, z - panelPositions.source[2]]} rotation={[0, index % 2 ? -0.25 : 0.25, index * 0.05]}>
            <boxGeometry args={[2.6, 1.65, 0.06]} />
            <meshStandardMaterial color={index % 2 ? palette.lavender : palette.paper} opacity={0.28} roughness={0.5} transparent />
          </mesh>
        ))}
      </group>
    </>
  )
}

function UnitsWorld() {
  const shards = useRef<Group>(null)
  const shardElapsed = useRef(0)
  const stage = useMemo(() => new Vector3(...panelPositions.units), [])
  useFrame(({ camera }, delta) => {
    if (!shards.current) return
    const presence = 1 - MathUtils.smoothstep(camera.position.distanceTo(stage), 14, 34)
    shardElapsed.current += delta
    shards.current.rotation.z += delta * (0.004 + presence * 0.01)
    shards.current.rotation.y = (1 - presence) * 0.28
    shards.current.children.forEach((child, index) => {
      const delay = (index % 7) * 0.045
      const reveal = MathUtils.smootherstep(presence, delay, Math.min(1, 0.55 + delay))
      const targetX = (random(index, 4) - 0.5) * 15
      const targetY = (random(index, 5) - 0.5) * 9
      const targetZ = (random(index, 6) - 0.5) * 8
      child.position.x = targetX * (0.12 + reveal * 0.88)
      child.position.y = targetY * (0.12 + reveal * 0.88) + Math.sin(shardElapsed.current * 0.38 + index) * 0.035 * reveal
      child.position.z = targetZ * (0.12 + reveal * 0.88)
      child.scale.setScalar(0.12 + reveal * 0.88)
      child.rotation.x += delta * (0.025 + (index % 4) * 0.007) * reveal
      child.rotation.y += delta * (0.018 + (index % 5) * 0.006) * reveal
    })
  })

  return (
    <>
      <WorldSection className="units-world" frameColor={palette.peach} position={panelPositions.units} rotation={[0, -0.12, 0.012]}>
        <header className="world-heading">
          <div><p className="world-eyebrow" data-motion="eyebrow" data-motion-delay="0.08" data-motion-duration="0.24">02 · EXTRACT / L1</p><h2><span data-motion="line" data-motion-delay="0.15" data-motion-duration="0.34">一篇内容被拆开，</span><span data-motion="line" data-motion-delay="0.24" data-motion-duration="0.36">三种知识各自留下。</span></h2></div>
          <p className="world-summary" data-motion="paragraph" data-motion-delay="0.31" data-motion-duration="0.35">它们不是同一种对象，也没有主次之分。每一条都带着逐字引文与出处。</p>
        </header>
        <div className="unit-grid" data-motion="panel-rise" data-motion-delay="0.28" data-motion-duration="0.5">
          <article className="claim" data-motion="card-left" data-motion-delay="0.34" data-motion-duration="0.42" data-motion-idle="0.65"><span data-motion="eyebrow" data-motion-delay="0.44" data-motion-duration="0.24">01 · CLAIM</span><b data-motion="rise" data-motion-delay="0.5" data-motion-duration="0.28">判断</b><strong data-motion="number" data-motion-delay="0.47" data-motion-duration="0.31">135</strong><p data-motion="paragraph" data-motion-delay="0.6" data-motion-duration="0.3">带时点、方向、条件和承诺度的市场主张。</p></article>
          <article className="method" data-motion="card-center" data-motion-delay="0.43" data-motion-duration="0.44" data-motion-idle="0.8"><span data-motion="eyebrow" data-motion-delay="0.53" data-motion-duration="0.24">02 · METHOD</span><b data-motion="rise" data-motion-delay="0.59" data-motion-duration="0.28">方法</b><strong data-motion="number" data-motion-delay="0.56" data-motion-duration="0.31">23</strong><p data-motion="paragraph" data-motion-delay="0.69" data-motion-duration="0.28">可以复述、执行与测试的研究规则。</p></article>
          <article className="concept" data-motion="card-right" data-motion-delay="0.52" data-motion-duration="0.44" data-motion-idle="0.7"><span data-motion="eyebrow" data-motion-delay="0.62" data-motion-duration="0.23">03 · CONCEPT</span><b data-motion="rise" data-motion-delay="0.68" data-motion-duration="0.27">认知</b><strong data-motion="number" data-motion-delay="0.65" data-motion-duration="0.3">89</strong><p data-motion="paragraph" data-motion-delay="0.77" data-motion-duration="0.22">可以跨越一次行情反复调用的理解。</p></article>
        </div>
      </WorldSection>
      <group position={panelPositions.units} ref={shards}>
        {Array.from({ length: 22 }, (_, index) => (
          <mesh
            key={index}
            position={[
              (random(index, 4) - 0.5) * 15,
              (random(index, 5) - 0.5) * 9,
              (random(index, 6) - 0.5) * 8,
            ]}
            rotation={[random(index, 7), random(index, 8), random(index, 9)]}
          >
            <boxGeometry args={[0.12 + random(index, 10) * 0.22, 0.18 + random(index, 11) * 0.4, 0.05]} />
            <meshBasicMaterial color={[palette.peach, palette.lavender, palette.lime][index % 3]} opacity={0.58} transparent />
          </mesh>
        ))}
      </group>
    </>
  )
}

function NodeWorld() {
  const core = useRef<Group>(null)
  const stage = useMemo(() => new Vector3(...panelPositions.node), [])
  useFrame(({ camera }, delta) => {
    if (!core.current) return
    const presence = 1 - MathUtils.smoothstep(camera.position.distanceTo(stage), 13, 32)
    core.current.rotation.y += delta * (0.012 + presence * 0.028)
    core.current.rotation.x = (1 - presence) * -0.32
    core.current.children.forEach((child, index) => {
      const reveal = MathUtils.smootherstep(presence, index * 0.09, 0.62 + index * 0.06)
      child.scale.setScalar(0.18 + reveal * 0.82)
      child.rotation.z += delta * (0.01 + index * 0.006) * reveal
    })
  })

  return (
    <>
      <WorldSection className="node-world" frameColor={palette.lime} position={panelPositions.node} rotation={[0, 0.1, -0.01]}>
        <div className="world-copy">
          <p className="world-eyebrow" data-motion="eyebrow" data-motion-delay="0.09" data-motion-duration="0.24">03 · MERGE / MEMORY</p>
          <h2><span data-motion="line" data-motion-delay="0.17" data-motion-duration="0.34">重复不再堆积，</span><span data-motion="line" data-motion-delay="0.27" data-motion-duration="0.36">新的表达回到同一节点。</span></h2>
          <p className="world-summary" data-motion="paragraph" data-motion-delay="0.39" data-motion-duration="0.34">相同命题进入规范节点；重申、细化、修正和反驳成为它的时间演进。</p>
        </div>
        <article className="canonical-document" data-motion="card-turn" data-motion-delay="0.26" data-motion-duration="0.47" data-motion-idle="0.6">
          <header data-motion="rise" data-motion-delay="0.43" data-motion-duration="0.27"><span>NODE 005 · 认知</span><small>CURRENT CANONICAL</small></header>
          <p><span data-motion="line" data-motion-delay="0.5" data-motion-duration="0.31">软件定价从席位制，经过按量收费，</span><strong data-motion="highlight" data-motion-delay="0.61" data-motion-duration="0.29">最终转向按结果收费。</strong></p>
          <div className="node-timeline" data-motion="rule" data-motion-delay="0.69" data-motion-duration="0.28">
            <span data-motion="cell" data-motion-delay="0.72" data-motion-duration="0.25"><i />05.31 首次提及</span><b data-motion="cell" data-motion-delay="0.77" data-motion-duration="0.22">supersedes</b><span data-motion="cell" data-motion-delay="0.81" data-motion-duration="0.18"><i />06.21 修正取代</span>
          </div>
        </article>
      </WorldSection>
      <group position={[panelPositions.node[0] + 6.2, -3.1, panelPositions.node[2] - 1]} ref={core}>
        <mesh>
          <icosahedronGeometry args={[0.68, 2]} />
          <meshStandardMaterial color={palette.sage} opacity={0.48} transparent />
        </mesh>
        {[1.05, 1.38, 1.75].map((radius, index) => (
          <mesh key={radius} rotation={[index * 0.4, index * 0.55, index * 0.2]}>
            <torusGeometry args={[radius, 0.01, 8, 80]} />
            <meshBasicMaterial color={[palette.lime, palette.lavender, palette.peach][index]} opacity={0.3} transparent />
          </mesh>
        ))}
      </group>
    </>
  )
}

const relationNodes: Point3[] = [
  [0, 0, -0.3],
  [-4.8, 2.8, -2],
  [4, 2.3, -3],
  [-4.3, -3, -4],
  [3.9, -2.7, -5.3],
  [0.2, 4.3, -7],
  [5.8, -0.3, -8],
  [-6.2, -0.2, -9],
]

function RelationsWorld() {
  const network = useRef<Group>(null)
  const stage = useMemo(() => new Vector3(...panelPositions.relations), [])
  useFrame(({ camera }, delta) => {
    if (!network.current) return
    const presence = 1 - MathUtils.smoothstep(camera.position.distanceTo(stage), 14, 35)
    network.current.rotation.z += delta * (0.002 + presence * 0.005)
    network.current.rotation.y = (1 - presence) * -0.42
    network.current.children.forEach((child, index) => {
      if (index < relationNodes.length) {
        const reveal = MathUtils.smootherstep(presence, index * 0.045, 0.5 + index * 0.035)
        const target = relationNodes[index]
        child.position.set(target[0] * (0.2 + reveal * 0.8), target[1] * (0.2 + reveal * 0.8), target[2] * (0.2 + reveal * 0.8))
        child.scale.setScalar(0.16 + reveal * 0.84)
        return
      }
      const lineIndex = index - relationNodes.length
      const reveal = MathUtils.smootherstep(presence, 0.2 + lineIndex * 0.055, 0.64 + lineIndex * 0.045)
      child.scale.setScalar(reveal)
      if (child instanceof ThreeLine) {
        const material = child.material as LineBasicMaterial
        material.opacity = 0.06 + reveal * 0.16
      }
    })
  })

  return (
    <>
      <WorldSection className="relations-world" frameColor={palette.lavender} position={panelPositions.relations} rotation={[0, -0.1, 0.01]}>
        <header className="world-heading">
          <div><p className="world-eyebrow" data-motion="eyebrow" data-motion-delay="0.08" data-motion-duration="0.24">04 · DISCOVER / RELATIONS</p><h2><span data-motion="line" data-motion-delay="0.16" data-motion-duration="0.34">当知识彼此连接，</span><span data-motion="line" data-motion-delay="0.25" data-motion-duration="0.37">研究才真正开始。</span></h2></div>
          <p className="world-summary" data-motion="paragraph" data-motion-delay="0.33" data-motion-duration="0.36">节点不再只是摘要。关系让分歧、补充和正在形成的跨源共识变得可见。</p>
        </header>
        <div className="relation-grid" data-motion="panel-rise" data-motion-delay="0.3" data-motion-duration="0.48" data-motion-idle="0.35">
          <article data-motion="row-left" data-motion-delay="0.39" data-motion-duration="0.39"><i className="opposition" data-motion="pop" data-motion-delay="0.48" data-motion-duration="0.28" /><strong data-motion="cell" data-motion-delay="0.52" data-motion-duration="0.28">对立</strong><span data-motion="cell" data-motion-delay="0.56" data-motion-duration="0.28">不能同时成立的解释</span><b data-motion="number" data-motion-delay="0.6" data-motion-duration="0.28">1</b></article>
          <article data-motion="row-right" data-motion-delay="0.53" data-motion-duration="0.4"><i className="complement" data-motion="pop" data-motion-delay="0.62" data-motion-duration="0.27" /><strong data-motion="cell" data-motion-delay="0.66" data-motion-duration="0.27">互补</strong><span data-motion="cell" data-motion-delay="0.7" data-motion-duration="0.27">不同尺度的知识拼合</span><b data-motion="number" data-motion-delay="0.74" data-motion-duration="0.25">5</b></article>
          <article data-motion="row-left" data-motion-delay="0.66" data-motion-duration="0.33"><i className="consensus" data-motion="pop" data-motion-delay="0.75" data-motion-duration="0.23" /><strong data-motion="cell" data-motion-delay="0.78" data-motion-duration="0.21">共识</strong><span data-motion="cell" data-motion-delay="0.81" data-motion-duration="0.18">跨信源的共同结构</span><b data-motion="number" data-motion-delay="0.84" data-motion-duration="0.15">持续发现</b></article>
        </div>
      </WorldSection>
      <group position={panelPositions.relations} ref={network}>
        {relationNodes.map((node, index) => (
          <mesh key={index} position={node}>
            <sphereGeometry args={[index === 0 ? 0.34 : 0.12 + (index % 3) * 0.035, 18, 18]} />
            <meshStandardMaterial color={[palette.sage, palette.lavender, palette.peach, palette.lime][index % 4]} opacity={0.72} transparent />
          </mesh>
        ))}
        {relationNodes.slice(1).map((node, index) => (
          <PathLine color={index % 3 === 0 ? palette.peach : index % 2 ? palette.lavender : palette.sage} key={index} opacity={0.22} points={[relationNodes[0], node]} />
        ))}
      </group>
    </>
  )
}

function LibraryWorld() {
  const ring = useRef<Group>(null)
  const stage = useMemo(() => new Vector3(...panelPositions.library), [])
  useFrame(({ camera }, delta) => {
    if (!ring.current) return
    const presence = 1 - MathUtils.smoothstep(camera.position.distanceTo(stage), 14, 36)
    ring.current.rotation.z -= delta * (0.003 + presence * 0.006)
    ring.current.rotation.x = (1 - presence) * 0.22
    ring.current.children.forEach((child, index) => {
      const reveal = MathUtils.smootherstep(presence, index * 0.14, 0.72 + index * 0.08)
      child.scale.setScalar(0.58 + reveal * 0.42)
      child.rotation.z += delta * (index ? 0.008 : -0.006) * reveal
    })
  })

  return (
    <>
      <group position={panelPositions.library} ref={ring}>
        {[5.1, 5.75].map((radius, index) => (
          <mesh key={radius} rotation={[index * 0.1, index * 0.14, index * 0.45]}>
            <torusGeometry args={[radius, index === 0 ? 0.025 : 0.012, 8, 180]} />
            <meshBasicMaterial color={index ? palette.lavender : palette.sage} opacity={0.28} transparent />
          </mesh>
        ))}
      </group>
      <WorldSection className="library-world" frameColor={palette.sage} position={panelPositions.library}>
        <p className="world-eyebrow" data-motion="eyebrow" data-motion-delay="0.08" data-motion-duration="0.25">05 · REMEMBER / THE LIBRARY</p>
        <h2><span data-motion="line" data-motion-delay="0.16" data-motion-duration="0.36">抵达的不是终点，</span><span data-motion="line" data-motion-delay="0.27" data-motion-duration="0.4"><em>而是一座会继续生长的知识库。</em></span></h2>
        <p className="world-summary" data-motion="paragraph" data-motion-delay="0.39" data-motion-duration="0.36">它从 2 位信源和 18 篇内容开始。规模仍小，但每次新增都进入同一套证据、归并、演进与发现结构。</p>
        <div className="library-grid" data-motion="panel-rise" data-motion-delay="0.45" data-motion-duration="0.43" data-motion-idle="0.4">
          <span data-motion="cell" data-motion-delay="0.53" data-motion-duration="0.3"><b data-motion="number" data-motion-delay="0.57" data-motion-duration="0.3">2</b>信源</span><span data-motion="cell" data-motion-delay="0.61" data-motion-duration="0.3"><b data-motion="number" data-motion-delay="0.65" data-motion-duration="0.3">18</b>内容</span><span data-motion="cell" data-motion-delay="0.69" data-motion-duration="0.28"><b data-motion="number" data-motion-delay="0.73" data-motion-duration="0.26">247</b>单元</span><span data-motion="cell" data-motion-delay="0.77" data-motion-duration="0.22"><b data-motion="number" data-motion-delay="0.81" data-motion-duration="0.18">105</b>节点</span>
        </div>
        <footer data-motion="rise" data-motion-delay="0.84" data-motion-duration="0.15">原文证据 · 时点版本 · 演进关系 · 选择性验证</footer>
      </WorldSection>
    </>
  )
}

function DepthPath() {
  const points: Point3[] = [
    [0, -4.2, 5],
    [-2.4, -4.1, -19],
    [2.4, -4, -40],
    [-2.2, -4.1, -61],
    [2.2, -4, -82],
    [0, -4.1, -103],
  ]
  return (
    <>
      <PathLine color={palette.sage} opacity={0.16} points={points} />
      {points.map((point, index) => (
        <mesh key={index} position={point}>
          <sphereGeometry args={[0.055, 12, 12]} />
          <meshBasicMaterial color={index % 2 ? palette.lavender : palette.sage} opacity={0.65} transparent />
        </mesh>
      ))}
    </>
  )
}

function World({ compact, progress }: SpatialSceneProps) {
  const smoothProgress = useRef(0)
  const cameraPoints = useMemo(() => [
    new Vector3(0, 0, 13),
    new Vector3(-1.25, 0, -7),
    new Vector3(1.25, 0, -28),
    new Vector3(-1.1, 0, -49),
    new Vector3(1.1, 0, -70),
    new Vector3(0, 0, -91),
  ], [])
  const targetPoints = useMemo(() => [
    new Vector3(...panelPositions.entry),
    new Vector3(...panelPositions.source),
    new Vector3(...panelPositions.units),
    new Vector3(...panelPositions.node),
    new Vector3(...panelPositions.relations),
    new Vector3(...panelPositions.library),
  ], [])
  const desiredPosition = useRef(new Vector3())
  const desiredTarget = useRef(new Vector3())
  const paper = useMemo(() => new Color('#f3f1e9'), [])
  const finalSage = useMemo(() => new Color('#e1e6da'), [])
  const mixed = useRef(new Color())

  useFrame(({ camera, pointer, scene }, delta) => {
    smoothProgress.current = MathUtils.damp(smoothProgress.current, progress.current, 5.2, delta)
    const value = MathUtils.clamp(smoothProgress.current, 0, 1)
    sampleJourney(cameraPoints, value, desiredPosition.current, compact ? 0.12 : 0.26)
    sampleJourney(targetPoints, value, desiredTarget.current)
    desiredPosition.current.x += pointer.x * (compact ? 0.08 : 0.2)
    desiredPosition.current.y += pointer.y * (compact ? 0.05 : 0.12)
    camera.position.lerp(desiredPosition.current, 1 - Math.exp(-delta * 6.2))
    camera.lookAt(desiredTarget.current)

    mixed.current.lerpColors(paper, finalSage, MathUtils.smoothstep(value, 0.72, 1))
    if (scene.background instanceof Color) scene.background.copy(mixed.current)
    if (scene.fog instanceof Fog) scene.fog.color.copy(mixed.current)
  })

  return (
    <JourneyProgressContext.Provider value={progress}>
      <ambientLight intensity={1.6} />
      <directionalLight color="#fffdf6" intensity={2.1} position={[4, 7, 9]} />
      <directionalLight color={palette.lavender} intensity={0.6} position={[-5, -2, -42]} />
      <ParticleField compact={compact} />
      <DepthPath />
      <EntryWorld />
      <SourceWorld />
      <UnitsWorld />
      <NodeWorld />
      <RelationsWorld />
      <LibraryWorld />
    </JourneyProgressContext.Provider>
  )
}

export default function SpatialScene(props: SpatialSceneProps) {
  return (
    <Canvas
      aria-label="Fanisl 知识形成空间"
      camera={{ far: 160, fov: 43, near: 0.1, position: [0, 0, 13] }}
      dpr={[1, props.compact ? 1.2 : 1.6]}
      gl={{ alpha: false, antialias: true, powerPreference: 'high-performance' }}
    >
      <color args={['#f3f1e9']} attach="background" />
      <fog args={['#f3f1e9', 14, 62]} attach="fog" />
      <Suspense fallback={null}>
        <World {...props} />
      </Suspense>
    </Canvas>
  )
}
