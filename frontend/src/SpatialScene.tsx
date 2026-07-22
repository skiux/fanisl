import { Html } from '@react-three/drei'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Suspense, useEffect, useMemo, useRef } from 'react'
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

function random(index: number, salt: number) {
  return ((Math.sin(index * 127.1 + salt * 311.7) * 43758.5453) % 1 + 1) % 1
}

function sampleJourney(points: Vector3[], progress: number, output: Vector3, lift = 0) {
  const last = chapters.length - 1
  if (progress >= chapters[last].stop) return output.copy(points[last])

  const next = chapters.findIndex((chapter) => progress < chapter.stop)
  const start = Math.max(0, next - 1)
  const span = chapters[next].stop - chapters[start].stop
  const raw = MathUtils.clamp((progress - chapters[start].stop) / span, 0, 1)
  const local = MathUtils.smootherstep(raw, 0, 1)
  output.lerpVectors(points[start], points[next], local)
  output.y += Math.sin(raw * Math.PI) * lift
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
  const worldPosition = useMemo(() => new Vector3(...position), [position])
  const compact = useThree((state) => state.size.width <= 760)

  useFrame(({ camera }) => {
    if (!panel.current) return
    const distance = camera.position.distanceTo(worldPosition)
    const farVisibility = 1 - MathUtils.smoothstep(distance, 22, 30)
    const nearVisibility = MathUtils.smoothstep(distance, 3.2, 6.2)
    const frontVisibility = MathUtils.smoothstep(camera.position.z - position[2], 8, 11)
    const opacity = MathUtils.clamp(farVisibility * nearVisibility * frontVisibility, 0, 1)
    panel.current.style.opacity = opacity.toFixed(3)
    panel.current.style.visibility = opacity < 0.008 ? 'hidden' : 'visible'
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
  useFrame((_, delta) => {
    if (ring.current) ring.current.rotation.z += delta * 0.018
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
        <p className="world-eyebrow"><span>FANISL</span> · PERSONAL INVESTMENT KNOWLEDGE ENGINE</p>
        <h1>把分散的投资内容，<br /><em>沉淀成自己的知识。</em></h1>
        <p className="world-summary">保存原文，拆出判断、方法与认知，再让它们归并、演进并彼此连接。滚动不是把页面向上推，而是沿着一条知识形成的路径继续向里。</p>
        <div className="entry-stats">
          <span><b>18</b>篇内容</span><i />
          <span><b>247</b>个知识单元</span><i />
          <span><b>105</b>个知识节点</span>
        </div>
      </WorldSection>
    </>
  )
}

function SourceWorld() {
  return (
    <>
      <WorldSection className="source-world" frameColor={palette.lavender} position={panelPositions.source} rotation={[0, 0.12, -0.015]}>
        <div className="world-copy">
          <p className="world-eyebrow">01 · CONTENT / L0</p>
          <h2>所有知识，先有一段<br />可以返回的原文。</h2>
          <p className="world-summary">转录、画面信息、发布时间与信源完整留存。后面的任何提取和归并，都能沿路径退回证据。</p>
        </div>
        <article className="source-document">
          <header><span>CONTENT 018</span><small>16:42 · 原始内容</small></header>
          <div className="source-title"><span>AI 与百年前的</span><strong>电力革命</strong></div>
          <blockquote>“真正改变生产率的，不是基础设施建成的那一天，而是组织方式开始随之变化。”</blockquote>
          <footer><span>逐字转录 13,657</span><span>画面笔记 12</span></footer>
        </article>
      </WorldSection>
      {[-14, -16.2, -21.8, -24].map((z, index) => (
        <mesh key={z} position={[index % 2 ? 4.9 : -5.3, index % 2 ? -2.8 : 2.5, z]} rotation={[0, index % 2 ? -0.25 : 0.25, index * 0.05]}>
          <boxGeometry args={[2.6, 1.65, 0.06]} />
          <meshStandardMaterial color={index % 2 ? palette.lavender : palette.paper} opacity={0.28} roughness={0.5} transparent />
        </mesh>
      ))}
    </>
  )
}

function UnitsWorld() {
  return (
    <>
      <WorldSection className="units-world" frameColor={palette.peach} position={panelPositions.units} rotation={[0, -0.12, 0.012]}>
        <header className="world-heading">
          <div><p className="world-eyebrow">02 · EXTRACT / L1</p><h2>一篇内容被拆开，<br />三种知识各自留下。</h2></div>
          <p className="world-summary">它们不是同一种对象，也没有主次之分。每一条都带着逐字引文与出处。</p>
        </header>
        <div className="unit-grid">
          <article className="claim"><span>01 · CLAIM</span><b>判断</b><strong>135</strong><p>带时点、方向、条件和承诺度的市场主张。</p></article>
          <article className="method"><span>02 · METHOD</span><b>方法</b><strong>23</strong><p>可以复述、执行与测试的研究规则。</p></article>
          <article className="concept"><span>03 · CONCEPT</span><b>认知</b><strong>89</strong><p>可以跨越一次行情反复调用的理解。</p></article>
        </div>
      </WorldSection>
      {Array.from({ length: 22 }, (_, index) => (
        <mesh
          key={index}
          position={[
            panelPositions.units[0] + (random(index, 4) - 0.5) * 15,
            (random(index, 5) - 0.5) * 9,
            panelPositions.units[2] + (random(index, 6) - 0.5) * 8,
          ]}
          rotation={[random(index, 7), random(index, 8), random(index, 9)]}
        >
          <boxGeometry args={[0.12 + random(index, 10) * 0.22, 0.18 + random(index, 11) * 0.4, 0.05]} />
          <meshBasicMaterial color={[palette.peach, palette.lavender, palette.lime][index % 3]} opacity={0.58} transparent />
        </mesh>
      ))}
    </>
  )
}

function NodeWorld() {
  const core = useRef<Group>(null)
  useFrame((_, delta) => {
    if (core.current) core.current.rotation.y += delta * 0.06
  })

  return (
    <>
      <WorldSection className="node-world" frameColor={palette.lime} position={panelPositions.node} rotation={[0, 0.1, -0.01]}>
        <div className="world-copy">
          <p className="world-eyebrow">03 · MERGE / MEMORY</p>
          <h2>重复不再堆积，<br />新的表达回到同一节点。</h2>
          <p className="world-summary">相同命题进入规范节点；重申、细化、修正和反驳成为它的时间演进。</p>
        </div>
        <article className="canonical-document">
          <header><span>NODE 005 · 认知</span><small>CURRENT CANONICAL</small></header>
          <p>软件定价从席位制，经过按量收费，<strong>最终转向按结果收费。</strong></p>
          <div className="node-timeline">
            <span><i />05.31 首次提及</span><b>supersedes</b><span><i />06.21 修正取代</span>
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
  [2.2, 0, -82.3],
  [-2.6, 2.8, -84],
  [6.2, 2.3, -85],
  [-2.1, -3, -86],
  [6.1, -2.7, -87.3],
  [2.4, 4.3, -89],
  [8, -0.3, -90],
  [-4, -0.2, -91],
]

function RelationsWorld() {
  return (
    <>
      <WorldSection className="relations-world" frameColor={palette.lavender} position={panelPositions.relations} rotation={[0, -0.1, 0.01]}>
        <header className="world-heading">
          <div><p className="world-eyebrow">04 · DISCOVER / RELATIONS</p><h2>当知识彼此连接，<br />研究才真正开始。</h2></div>
          <p className="world-summary">节点不再只是摘要。关系让分歧、补充和正在形成的跨源共识变得可见。</p>
        </header>
        <div className="relation-grid">
          <article><i className="opposition" /><strong>对立</strong><span>不能同时成立的解释</span><b>1</b></article>
          <article><i className="complement" /><strong>互补</strong><span>不同尺度的知识拼合</span><b>5</b></article>
          <article><i className="consensus" /><strong>共识</strong><span>跨信源的共同结构</span><b>持续发现</b></article>
        </div>
      </WorldSection>
      {relationNodes.map((node, index) => (
        <mesh key={index} position={node}>
          <sphereGeometry args={[index === 0 ? 0.34 : 0.12 + (index % 3) * 0.035, 18, 18]} />
          <meshStandardMaterial color={[palette.sage, palette.lavender, palette.peach, palette.lime][index % 4]} opacity={0.72} transparent />
        </mesh>
      ))}
      {relationNodes.slice(1).map((node, index) => (
        <PathLine color={index % 3 === 0 ? palette.peach : index % 2 ? palette.lavender : palette.sage} key={index} opacity={0.22} points={[relationNodes[0], node]} />
      ))}
    </>
  )
}

function LibraryWorld() {
  const ring = useRef<Group>(null)
  useFrame((_, delta) => {
    if (ring.current) ring.current.rotation.z -= delta * 0.015
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
        <p className="world-eyebrow">05 · REMEMBER / THE LIBRARY</p>
        <h2>抵达的不是终点，<br /><em>而是一座会继续生长的知识库。</em></h2>
        <p className="world-summary">它从 2 位信源和 18 篇内容开始。规模仍小，但每次新增都进入同一套证据、归并、演进与发现结构。</p>
        <div className="library-grid">
          <span><b>2</b>信源</span><span><b>18</b>内容</span><span><b>247</b>单元</span><span><b>105</b>节点</span>
        </div>
        <footer>原文证据 · 时点版本 · 演进关系 · 选择性验证</footer>
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
    smoothProgress.current = MathUtils.damp(smoothProgress.current, progress.current, 6.5, delta)
    const value = MathUtils.clamp(smoothProgress.current, 0, 1)
    sampleJourney(cameraPoints, value, desiredPosition.current, compact ? 0.12 : 0.26)
    sampleJourney(targetPoints, value, desiredTarget.current)
    desiredPosition.current.x += pointer.x * (compact ? 0.08 : 0.2)
    desiredPosition.current.y += pointer.y * (compact ? 0.05 : 0.12)
    camera.position.lerp(desiredPosition.current, 1 - Math.exp(-delta * 7))
    camera.lookAt(desiredTarget.current)

    mixed.current.lerpColors(paper, finalSage, MathUtils.smoothstep(value, 0.72, 1))
    if (scene.background instanceof Color) scene.background.copy(mixed.current)
    if (scene.fog instanceof Fog) scene.fog.color.copy(mixed.current)
  })

  return (
    <>
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
    </>
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
