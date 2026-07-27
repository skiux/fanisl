import { useEffect, useRef } from 'react'
import type { CSSProperties, RefObject } from 'react'
import ResearchBackdrop from './ResearchBackdrop'

type ArchiveSceneProps = {
  active: number
  openSearch: () => void
  progress: RefObject<number>
}

type MotionStyle = CSSProperties & {
  '--delay'?: number
}

const stageRanges = [
  [-0.2, 0.14],
  [0.07, 0.3],
  [0.22, 0.48],
  [0.4, 0.65],
  [0.58, 0.83],
  [0.76, 1.02],
] as const

function clamp(value: number) {
  return Math.min(1, Math.max(0, value))
}

function smoothstep(start: number, end: number, value: number) {
  const phase = clamp((value - start) / (end - start))
  return phase * phase * (3 - 2 * phase)
}

function motionStyle(delay: number): MotionStyle {
  return { '--delay': delay }
}

function StageLabel({ index, label }: { index: string; label: string }) {
  return (
    <p className="stage-label" data-animate style={motionStyle(0)}>
      <span>{index}</span>
      <i />
      {label}
    </p>
  )
}

function ArchiveScene({ active, openSearch, progress }: ArchiveSceneProps) {
  const stageRefs = useRef<Array<HTMLElement | null>>([])

  useEffect(() => {
    const stages = stageRefs.current.filter((stage): stage is HTMLElement => Boolean(stage))
    const animatedChildren = stages.map((stage) => Array.from(stage.querySelectorAll<HTMLElement>('[data-animate]')))
    let frame = 0

    const update = () => {
      const value = clamp(progress.current)

      stages.forEach((stage, index) => {
        const [start, end] = stageRanges[index]
        const phase = clamp((value - start) / (end - start))
        const arrival = index === 0 ? 1 : smoothstep(0, 0.2, phase)
        const departure = index === stageRanges.length - 1 ? 0 : smoothstep(0.76, 1, phase)
        const visibility = arrival * (1 - departure)

        stage.style.setProperty('--phase', phase.toFixed(4))
        stage.style.setProperty('--exit', departure.toFixed(4))
        stage.style.setProperty('--visibility', visibility.toFixed(4))

        animatedChildren[index].forEach((element) => {
          const delay = Number(element.style.getPropertyValue('--delay')) || 0
          const itemProgress = smoothstep(delay, Math.min(0.96, delay + 0.2), phase)
          element.style.setProperty('--move', itemProgress.toFixed(4))
          element.style.setProperty('--leave', departure.toFixed(4))
        })
      })

      frame = window.requestAnimationFrame(update)
    }

    frame = window.requestAnimationFrame(update)
    return () => window.cancelAnimationFrame(frame)
  }, [progress])

  return (
    <div className="archive-scene">
      <ResearchBackdrop progress={progress} />

      <section
        aria-hidden={active !== 0}
        className={`space-stage entry-stage ${active === 0 ? 'is-active' : ''}`}
        ref={(element) => { stageRefs.current[0] = element }}
      >
        <div className="entry-copy">
          <StageLabel index="00" label="KNOWLEDGE, WITH A MEMORY" />
          <h1>
            <span data-animate style={motionStyle(0.02)}>把一段观点，</span>
            <span data-animate style={motionStyle(0.1)}>带进长期知识。</span>
          </h1>
          <p className="entry-summary" data-animate style={motionStyle(0.2)}>
            FANISL 保存原始内容，拆出判断、方法与认知，再把一次表达沉淀为可以合并、修正和连接的知识。
          </p>
          <div className="entry-ledger" data-animate style={motionStyle(0.3)}>
            <span><b>18</b> 篇原始内容</span>
            <i />
            <span><b>247</b> 个知识单元</span>
            <i />
            <span><b>105</b> 个长期节点</span>
          </div>
        </div>
        <div className="entry-waypoint" data-animate style={motionStyle(0.25)}>
          <span>从原文出发</span>
          <i />
          <b>01</b>
        </div>
      </section>

      <section
        aria-hidden={active !== 1}
        className={`space-stage source-stage ${active === 1 ? 'is-active' : ''}`}
        ref={(element) => { stageRefs.current[1] = element }}
      >
        <div className="source-copy">
          <StageLabel index="01" label="SOURCE / 原始内容" />
          <h2 data-animate style={motionStyle(0.06)}>知识先保留来处。</h2>
          <p data-animate style={motionStyle(0.16)}>
            转录、发布时间、作者和逐字引文一起保存。任何结构化结果，都能退回它的原始语境。
          </p>
        </div>
        <article className="source-sheet" data-animate style={motionStyle(0.08)}>
          <header>
            <span>CONTENT · 2026.05.31</span>
            <b>已归档</b>
          </header>
          <div className="source-author">
            <i>01</i>
            <span><small>原始内容</small><strong>AI 时代的软件商业模式</strong></span>
          </div>
          <blockquote>“按量收费，是 AI 时代软件商业模式真正的起点。”</blockquote>
          <footer>
            <span>逐字引文 03:14—03:27</span>
            <span>返回原文 ↗</span>
          </footer>
        </article>
        <div className="source-note" data-animate style={motionStyle(0.28)}>
          <b>保留语境</b>
          <span>不是只存一段摘要</span>
        </div>
      </section>

      <section
        aria-hidden={active !== 2}
        className={`space-stage units-stage ${active === 2 ? 'is-active' : ''}`}
        ref={(element) => { stageRefs.current[2] = element }}
      >
        <div className="units-heading">
          <StageLabel index="02" label="EXTRACT / 知识单元" />
          <h2 data-animate style={motionStyle(0.04)}>一篇内容，拆成三种可用的知识。</h2>
        </div>
        <div className="unit-deck">
          <article className="unit-card judgment-card" data-animate style={motionStyle(0.09)}>
            <header><span>判断</span><b>CLAIM</b></header>
            <strong>标普 500<br />2026 年底 8200 点</strong>
            <footer><i /> 可被时间验证</footer>
          </article>
          <article className="unit-card method-card" data-animate style={motionStyle(0.17)}>
            <header><span>方法</span><b>METHOD</b></header>
            <strong>EMA 隧道识别<br />趋势与防守位</strong>
            <footer><i /> 可以重复执行</footer>
          </article>
          <article className="unit-card concept-card" data-animate style={motionStyle(0.25)}>
            <header><span>认知</span><b>CONCEPT</b></header>
            <strong>软件收费<br />席位 → 按量 → 按结果</strong>
            <footer><i /> 可以持续演进</footer>
          </article>
        </div>
        <div className="unit-index" data-animate style={motionStyle(0.34)}>
          <span>135 判断</span><span>23 方法</span><span>89 认知</span>
        </div>
      </section>

      <section
        aria-hidden={active !== 3}
        className={`space-stage node-stage ${active === 3 ? 'is-active' : ''}`}
        ref={(element) => { stageRefs.current[3] = element }}
      >
        <StageLabel index="03" label="MERGE / 长期节点" />
        <div className="node-copy">
          <h2 data-animate style={motionStyle(0.04)}>新的表达，不再成为新的孤岛。</h2>
          <p data-animate style={motionStyle(0.14)}>同一知识被重申、细化或修正时，时间线增长，节点不重复堆积。</p>
        </div>
        <article className="canonical-node" data-animate style={motionStyle(0.08)}>
          <header><span>KNOWLEDGE NODE · 047</span><b>认知</b></header>
          <h3>AI 时代的软件收费：<br />席位 → 按量 → 按结果</h3>
          <div className="node-timeline">
            <span data-animate style={motionStyle(0.18)}><i>05.31</i><b>首次提出</b><em>按量收费是唯一出路</em></span>
            <span data-animate style={motionStyle(0.27)}><i>06.21</i><b>修正</b><em>最终应当按结果收费</em></span>
          </div>
          <footer><span>2 次表达归并</span><span>完整历史仍可回看</span></footer>
        </article>
        <div className="merge-tag merge-tag-one" data-animate style={motionStyle(0.22)}>重申</div>
        <div className="merge-tag merge-tag-two" data-animate style={motionStyle(0.3)}>修正</div>
      </section>

      <section
        aria-hidden={active !== 4}
        className={`space-stage relations-stage ${active === 4 ? 'is-active' : ''}`}
        ref={(element) => { stageRefs.current[4] = element }}
      >
        <div className="relation-heading">
          <StageLabel index="04" label="DISCOVER / 知识关系" />
          <h2 data-animate style={motionStyle(0.04)}>知识连接之后，分歧才变得可见。</h2>
          <p data-animate style={motionStyle(0.13)}>系统发现对立、互补与跨源共识；关系必须回到两端证据，而不是凭空生成结论。</p>
        </div>
        <div className="relation-map">
          <article className="relation-node relation-left" data-animate style={motionStyle(0.1)}>
            <small>认知 · 半导体</small>
            <strong>高端算力形成<br />持续“数字地租”</strong>
            <span>结构已经改变</span>
          </article>
          <svg aria-hidden="true" className="relation-line" viewBox="0 0 500 160">
            <path d="M18 78 C150 18 344 142 482 78" data-animate pathLength="1" style={motionStyle(0.18)} />
          </svg>
          <div className="relation-verdict" data-animate style={motionStyle(0.25)}>
            <span>CONFLICT</span><b>解释冲突</b><small>1 条已发现</small>
          </div>
          <article className="relation-node relation-right" data-animate style={motionStyle(0.16)}>
            <small>认知 · 半导体</small>
            <strong>供需与库存仍在<br />驱动传统周期</strong>
            <span>周期没有消失</span>
          </article>
        </div>
      </section>

      <section
        aria-hidden={active !== 5}
        className={`space-stage library-stage ${active === 5 ? 'is-active' : ''}`}
        ref={(element) => { stageRefs.current[5] = element }}
      >
        <div className="library-copy">
          <StageLabel index="05" label="REMEMBER / 个人知识库" />
          <h2>
            <span data-animate style={motionStyle(0.03)}>抵达的不是终点，</span>
            <span data-animate style={motionStyle(0.1)}>而是一座继续生长的知识库。</span>
          </h2>
          <p data-animate style={motionStyle(0.2)}>
            新内容进入同一套结构：保留证据、归并节点、发现关系，并在未来的验证中继续更新。
          </p>
          <button data-animate onClick={openSearch} style={motionStyle(0.3)} type="button">
            浏览当前知识样本 <span>↗</span>
          </button>
        </div>
        <div className="library-shelf" aria-label="当前知识库样本">
          <span data-animate style={motionStyle(0.08)}><i>01</i><b>信源</b><strong>2</strong></span>
          <span data-animate style={motionStyle(0.14)}><i>02</i><b>内容</b><strong>18</strong></span>
          <span data-animate style={motionStyle(0.2)}><i>03</i><b>单元</b><strong>247</strong></span>
          <span data-animate style={motionStyle(0.26)}><i>04</i><b>节点</b><strong>105</strong></span>
        </div>
        <div className="library-status" data-animate style={motionStyle(0.36)}>
          <i /> KNOWLEDGE BASE · ACTIVE
        </div>
      </section>
    </div>
  )
}

export default ArchiveScene
