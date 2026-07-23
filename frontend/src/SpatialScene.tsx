import { Html } from '@react-three/drei'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { createContext, Suspense, useContext, useRef } from 'react'
import type { ReactNode, RefObject } from 'react'
import { MathUtils, Vector3 } from 'three'
import { chapters } from './journey'

type Point3 = [number, number, number]

type SpatialSceneProps = {
  compact: boolean
  progress: RefObject<number>
}

const stagePositions = {
  entry: [0, 0, 0] as Point3,
  source: [-1.1, 0.1, -20] as Point3,
  units: [1.15, -0.1, -40] as Point3,
  node: [-1.1, 0.12, -60] as Point3,
  relations: [1, -0.12, -80] as Point3,
  library: [0, 0, -100] as Point3,
}

const chapterByClass = {
  'entry-world': 0,
  'source-world': 1,
  'units-world': 2,
  'node-world': 3,
  'relations-world': 4,
  'library-world': 5,
} as const

const JourneyProgressContext = createContext<RefObject<number> | null>(null)

const cameraPositions = [
  new Vector3(0, 0, 9),
  new Vector3(-0.25, 0.05, -7),
  new Vector3(0.35, -0.05, -27),
  new Vector3(-0.35, 0.06, -47),
  new Vector3(0.3, -0.05, -67),
  new Vector3(0, 0, -87),
]

function smooth(start: number, end: number, value: number) {
  if (end <= start) return value >= end ? 1 : 0
  const phase = MathUtils.clamp((value - start) / (end - start), 0, 1)
  return phase * phase * phase * (phase * (phase * 6 - 15) + 10)
}

function sampleCamera(progress: number, output: Vector3) {
  const last = chapters.length - 1
  if (progress >= chapters[last].stop) return output.copy(cameraPositions[last])
  const next = chapters.findIndex((chapter) => progress < chapter.stop)
  const start = Math.max(0, next - 1)
  const span = chapters[next].stop - chapters[start].stop
  const local = smooth(0.06, 0.94, (progress - chapters[start].stop) / span)
  return output.lerpVectors(cameraPositions[start], cameraPositions[next], local)
}

function chapterReveal(value: number, index: number) {
  if (index === 0) return 1
  const previous = chapters[index - 1].stop
  const stop = chapters[index].stop
  const span = stop - previous
  return smooth(previous + span * 0.28, previous + span * 0.8, value)
}

function chapterExit(value: number, index: number) {
  if (index === chapters.length - 1) return 0
  const stop = chapters[index].stop
  const next = chapters[index + 1].stop
  const span = next - stop
  return smooth(stop + span * 0.16, stop + span * 0.54, value)
}

function chapterPresence(value: number, index: number) {
  return chapterReveal(value, index) * (1 - chapterExit(value, index))
}

function WorldSection({
  children,
  className,
  position,
  rotation = [0, 0, 0],
}: {
  children: ReactNode
  className: keyof typeof chapterByClass
  position: Point3
  rotation?: Point3
}) {
  const panel = useRef<HTMLElement>(null)
  const motionElements = useRef<HTMLElement[]>([])
  const introElapsed = useRef(0)
  const progress = useContext(JourneyProgressContext)
  const compact = useThree((state) => state.size.width <= 760)
  const chapterIndex = chapterByClass[className]

  useFrame(({ clock }, delta) => {
    if (!panel.current || !progress) return
    introElapsed.current = Math.min(3.2, introElapsed.current + delta)
    const value = progress.current
    const exit = chapterExit(value, chapterIndex)
    let reveal = chapterReveal(value, chapterIndex)
    if (chapterIndex === 0) reveal *= smooth(0, 2.7, introElapsed.current)

    panel.current.style.opacity = chapterPresence(value, chapterIndex).toFixed(4)
    panel.current.style.setProperty('--section-exit', exit.toFixed(4))

    if (motionElements.current.length === 0) {
      motionElements.current = Array.from(panel.current.querySelectorAll<HTMLElement>('[data-motion]'))
    }

    motionElements.current.forEach((element, index) => {
      const delay = Number(element.dataset.motionDelay ?? Math.min(0.68, index * 0.055))
      const duration = Number(element.dataset.motionDuration ?? 0.34)
      const phase = MathUtils.clamp((reveal - delay) / duration, 0, 1)
      const eased = smooth(0, 1, phase)
      const idle = Number(element.dataset.motionIdle ?? 0)
      const settled = smooth(0.78, 1, eased) * (1 - exit)
      const driftX = Math.sin(clock.elapsedTime * 0.2 + index * 1.31) * idle * settled
      const driftY = Math.cos(clock.elapsedTime * 0.17 + index * 0.83) * idle * 0.58 * settled
      element.style.setProperty('--motion', eased.toFixed(4))
      element.style.setProperty('--motion-inverse', (1 - eased).toFixed(4))
      element.style.setProperty('--motion-exit', exit.toFixed(4))
      element.style.setProperty('--motion-opacity', eased.toFixed(4))
      element.style.setProperty('--drift-x', `${driftX.toFixed(3)}px`)
      element.style.setProperty('--drift-y', `${driftY.toFixed(3)}px`)
    })
  })

  return (
    <group
      position={[compact ? 0 : position[0], position[1], position[2]]}
      rotation={compact ? [0, 0, 0] : rotation}
    >
      <Html
        center
        distanceFactor={compact ? 4.05 : chapterIndex === 0 ? 4.8 : 4.8}
        transform
        wrapperClass="world-html"
        zIndexRange={[60, 0]}
      >
        <section className={`world-panel ${className}`} ref={panel}>{children}</section>
      </Html>
    </group>
  )
}

function EntryWorld() {
  return (
    <WorldSection className="entry-world" position={stagePositions.entry}>
      <div className="entry-copy">
        <p className="world-eyebrow" data-motion="eyebrow" data-motion-delay="0.03">
          <span>FANISL</span> · PERSONAL INVESTMENT KNOWLEDGE ENGINE
        </p>
        <h1>
          <span data-motion="line" data-motion-delay="0.1">把分散的投资内容，</span>
          <span data-motion="line" data-motion-delay="0.2"><em>沉淀成自己的知识。</em></span>
        </h1>
        <p className="world-summary" data-motion="copy" data-motion-delay="0.32">
          保存逐字证据，拆出判断、方法与认知，记录它们如何被重申、修正、反驳，并在到期后接受市场裁决。
        </p>
      </div>
      <div className="entry-object" data-motion="object" data-motion-delay="0.23" data-motion-duration="0.5" data-motion-idle="0.75" aria-hidden="true">
        <span className="entry-core">KN</span>
        <i /><i /><i />
        <b>证据</b><b>演进</b><b>关系</b>
      </div>
      <div className="entry-ledger" data-motion="ledger" data-motion-delay="0.42">
        <span data-motion="cell" data-motion-delay="0.5"><b>18</b>篇内容</span>
        <span data-motion="cell" data-motion-delay="0.57"><b>247</b>个知识单元</span>
        <span data-motion="cell" data-motion-delay="0.64"><b>105</b>个知识节点</span>
      </div>
    </WorldSection>
  )
}

function SourceWorld() {
  return (
    <WorldSection className="source-world" position={stagePositions.source} rotation={[0, 0.07, -0.01]}>
      <div className="world-copy">
        <p className="world-eyebrow" data-motion="eyebrow" data-motion-delay="0.05">01 · CONTENT / IMMUTABLE</p>
        <h2>
          <span data-motion="line" data-motion-delay="0.12">知识的第一层，</span>
          <span data-motion="line" data-motion-delay="0.21"><em>不是总结，是证据。</em></span>
        </h2>
        <p className="world-summary" data-motion="copy" data-motion-delay="0.33">
          一期内容完整保留转录、画面信息、发布时间与信源。后面的任何结论，都能沿路径退回这段原文。
        </p>
        <div className="source-index" data-motion="rail" data-motion-delay="0.43">
          <span><b>13,657</b>逐字转录</span>
          <span><b>12</b>画面笔记</span>
          <span><b>1</b>原始内容</span>
        </div>
      </div>
      <article className="evidence-sheet" data-motion="paper" data-motion-delay="0.22" data-motion-duration="0.52" data-motion-idle="0.55">
        <header data-motion="rail" data-motion-delay="0.4">
          <span>CONTENT 018</span><small>16:42 · 逐字证据</small>
        </header>
        <div className="evidence-title">
          <span data-motion="line" data-motion-delay="0.47">AI 与百年前的</span>
          <strong data-motion="line" data-motion-delay="0.54">电力革命</strong>
        </div>
        <blockquote data-motion="quote" data-motion-delay="0.62">
          真正改变生产率的，不是基础设施建成的那一天，而是组织方式开始随之变化。
        </blockquote>
        <footer data-motion="rail" data-motion-delay="0.72">
          <span>逐字证据</span><span>画面信息</span><span>原文不可变</span>
        </footer>
      </article>
    </WorldSection>
  )
}

function UnitsWorld() {
  return (
    <WorldSection className="units-world" position={stagePositions.units} rotation={[0, -0.07, 0.01]}>
      <header className="world-heading">
        <div>
          <p className="world-eyebrow" data-motion="eyebrow" data-motion-delay="0.05">02 · EXTRACT / L1</p>
          <h2>
            <span data-motion="line" data-motion-delay="0.12">同一篇内容，</span>
            <span data-motion="line" data-motion-delay="0.21"><em>分流成三种知识。</em></span>
          </h2>
        </div>
        <p className="world-summary" data-motion="copy" data-motion-delay="0.3">
          每一条都携带逐字引文与出处，但进入不同的长期结构。
        </p>
      </header>
      <div className="unit-grid">
        <article className="claim" data-motion="card-left" data-motion-delay="0.3" data-motion-duration="0.43" data-motion-idle="0.55">
          <span>01 / CLAIM</span><strong data-motion="number" data-motion-delay="0.43">135</strong>
          <b data-motion="rise" data-motion-delay="0.5">判断</b>
          <p data-motion="copy" data-motion-delay="0.58">有方向、期限和冻结判据；到期后接受机械评分。</p>
          <i data-motion="rail" data-motion-delay="0.66">TIME-BOUND</i>
        </article>
        <article className="method" data-motion="card-center" data-motion-delay="0.39" data-motion-duration="0.46" data-motion-idle="0.7">
          <span>02 / METHOD</span><strong data-motion="number" data-motion-delay="0.51">23</strong>
          <b data-motion="rise" data-motion-delay="0.58">方法</b>
          <p data-motion="copy" data-motion-delay="0.66">可复述、执行和测试的研究规则。</p>
          <i data-motion="rail" data-motion-delay="0.73">REPEATABLE</i>
        </article>
        <article className="concept" data-motion="card-right" data-motion-delay="0.48" data-motion-duration="0.44" data-motion-idle="0.6">
          <span>03 / CONCEPT</span><strong data-motion="number" data-motion-delay="0.6">89</strong>
          <b data-motion="rise" data-motion-delay="0.67">认知</b>
          <p data-motion="copy" data-motion-delay="0.74">可以跨越一次行情反复调用的理解。</p>
          <i data-motion="rail" data-motion-delay="0.8">DURABLE</i>
        </article>
      </div>
    </WorldSection>
  )
}

function NodeWorld() {
  return (
    <WorldSection className="node-world" position={stagePositions.node} rotation={[0, 0.07, -0.008]}>
      <div className="world-copy">
        <p className="world-eyebrow" data-motion="eyebrow" data-motion-delay="0.05">03 · MERGE / EVOLUTION</p>
        <h2>
          <span data-motion="line" data-motion-delay="0.12">表达会变化，</span>
          <span data-motion="line" data-motion-delay="0.21"><em>知识不丢失历史。</em></span>
        </h2>
        <p className="world-summary" data-motion="copy" data-motion-delay="0.32">
          重申、细化、修正和反驳依次挂回同一节点；当前表述更新，旧证据仍然保留。
        </p>
        <div className="evolution-key" data-motion="rail" data-motion-delay="0.43">
          <span>RESTATES</span><span>REFINES</span><span>SUPERSEDES</span><span>CONTRADICTS</span>
        </div>
      </div>
      <article className="node-card" data-motion="paper" data-motion-delay="0.23" data-motion-duration="0.52" data-motion-idle="0.5">
        <header data-motion="rail" data-motion-delay="0.4">
          <span>NODE 005 · 认知</span><small>CURRENT CANONICAL</small>
        </header>
        <p>
          <span data-motion="line" data-motion-delay="0.47">软件定价从席位制，</span>
          <span data-motion="line" data-motion-delay="0.54">经过按量收费，</span>
          <strong data-motion="quote" data-motion-delay="0.62">最终转向按结果收费。</strong>
        </p>
        <div className="node-timeline" data-motion="rail" data-motion-delay="0.7">
          <span><i />05.31 首次提及</span><b>修正取代</b><span><i />06.21 更新节点</span>
        </div>
      </article>
    </WorldSection>
  )
}

function RelationsWorld() {
  return (
    <WorldSection className="relations-world" position={stagePositions.relations} rotation={[0, -0.065, 0.008]}>
      <header className="world-heading">
        <div>
          <p className="world-eyebrow" data-motion="eyebrow" data-motion-delay="0.05">04 · DISCOVER / RELATIONS</p>
          <h2>
            <span data-motion="line" data-motion-delay="0.12">不是更多摘要，</span>
            <span data-motion="line" data-motion-delay="0.21"><em>而是新的研究结构。</em></span>
          </h2>
        </div>
        <p className="world-summary" data-motion="copy" data-motion-delay="0.31">
          关系把不能同时成立的解释、可以互补的知识和跨信源共识推到视野中央。
        </p>
      </header>
      <div className="relation-map" data-motion="map" data-motion-delay="0.3" data-motion-duration="0.5">
        <div className="relation-axis" aria-hidden="true"><i /><i /><i /><i /></div>
        <article className="conflict" data-motion="row-left" data-motion-delay="0.36">
          <i data-motion="stamp" data-motion-delay="0.45" /><div><span>CONFLICTS</span><strong>对立</strong></div>
          <p>数字地租改变周期<br />传统周期解释仍然存在</p><b>1 组</b>
        </article>
        <article className="relates" data-motion="row-right" data-motion-delay="0.48">
          <i data-motion="stamp" data-motion-delay="0.57" /><div><span>RELATES</span><strong>互补</strong></div>
          <p>不同尺度的知识拼合<br />读其一，应同时看另一</p><b>5 组</b>
        </article>
        <article className="consensus" data-motion="row-left" data-motion-delay="0.6">
          <i data-motion="stamp" data-motion-delay="0.69" /><div><span>CROSS-SOURCE</span><strong>共识</strong></div>
          <p>相同结构被不同信源<br />独立重复表达</p><b>持续发现</b>
        </article>
      </div>
    </WorldSection>
  )
}

function LibraryWorld() {
  return (
    <WorldSection className="library-world" position={stagePositions.library}>
      <div className="library-copy">
        <p className="world-eyebrow" data-motion="eyebrow" data-motion-delay="0.04">05 · THE LIBRARY / GROWING</p>
        <h2>
          <span data-motion="line" data-motion-delay="0.1">库很小。</span>
          <span data-motion="line" data-motion-delay="0.2"><em>但每一条都来路清楚。</em></span>
        </h2>
        <p className="world-summary" data-motion="copy" data-motion-delay="0.33">
          它从 2 位信源、18 篇内容开始。规模不被夸大，证据、演进、关系与市场裁决共同决定一条知识能否留下。
        </p>
      </div>
      <div className="library-shelf" data-motion="shelf" data-motion-delay="0.27" data-motion-duration="0.52" aria-hidden="true">
        {Array.from({ length: 15 }, (_, index) => <i key={index} />)}
      </div>
      <div className="library-ledger" data-motion="ledger" data-motion-delay="0.43">
        <span data-motion="cell" data-motion-delay="0.5"><b>2</b>信源</span>
        <span data-motion="cell" data-motion-delay="0.56"><b>18</b>内容</span>
        <span data-motion="cell" data-motion-delay="0.62"><b>247</b>单元</span>
        <span data-motion="cell" data-motion-delay="0.68"><b>105</b>节点</span>
        <span data-motion="cell" data-motion-delay="0.74"><b>62</b>已到期时点</span>
      </div>
      <footer data-motion="rail" data-motion-delay="0.8">逐字证据 · 冻结判据 · 演进历史 · 关系发现</footer>
    </WorldSection>
  )
}

function World({ compact, progress }: SpatialSceneProps) {
  const smoothedProgress = useRef(0)
  const desiredPosition = useRef(new Vector3())
  const desiredTarget = useRef(new Vector3())

  useFrame(({ camera, pointer }, delta) => {
    smoothedProgress.current = MathUtils.damp(smoothedProgress.current, progress.current, 4.2, delta)
    const value = MathUtils.clamp(smoothedProgress.current, 0, 1)
    sampleCamera(value, desiredPosition.current)
    desiredPosition.current.x += pointer.x * (compact ? 0.025 : 0.08)
    desiredPosition.current.y += pointer.y * (compact ? 0.018 : 0.05)
    camera.position.lerp(desiredPosition.current, 1 - Math.exp(-delta * 5))
    desiredTarget.current.set(camera.position.x, camera.position.y, camera.position.z - 7.5)
    camera.lookAt(desiredTarget.current)
  })

  return (
    <JourneyProgressContext.Provider value={progress}>
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
      camera={{ far: 130, fov: 42, near: 0.1, position: [0, 0, 9] }}
      dpr={[1, props.compact ? 1.1 : 1.35]}
      gl={{ alpha: true, antialias: false, powerPreference: 'low-power' }}
    >
      <Suspense fallback={null}>
        <World {...props} />
      </Suspense>
    </Canvas>
  )
}
