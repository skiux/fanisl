import { useEffect, useRef } from 'react'
import type { RefObject } from 'react'

type KnowledgeBackdropProps = {
  progress: RefObject<number>
}

const bayStops = [0, 0.17, 0.36, 0.55, 0.74, 0.92] as const

function clamp(value: number) {
  return Math.min(1, Math.max(0, value))
}

function smoothstep(start: number, end: number, value: number) {
  const phase = clamp((value - start) / (end - start))
  return phase * phase * (3 - 2 * phase)
}

function KnowledgeBackdrop({ progress }: KnowledgeBackdropProps) {
  const root = useRef<HTMLDivElement>(null)
  const bays = useRef<Array<HTMLDivElement | null>>([])

  useEffect(() => {
    let frame = 0

    const update = (time: number) => {
      const journey = clamp(progress.current)
      const backdrop = root.current

      if (backdrop) {
        backdrop.style.setProperty('--journey', journey.toFixed(4))
        backdrop.style.setProperty('--breath', ((Math.sin(time * 0.00032) + 1) * 0.5).toFixed(4))
        backdrop.classList.add('is-ready')
      }

      bays.current.forEach((bay, index) => {
        if (!bay) return
        const phase = clamp((journey - bayStops[index] + 0.12) / 0.34)
        const arrival = smoothstep(0, 0.18, phase)
        const departure = index === bayStops.length - 1 ? 0 : smoothstep(0.76, 1, phase)
        const depth = -1080 + phase * 1390
        const blur = Math.max(0, (phase - 0.76) * 15)
        const lift = (0.42 - phase) * 24

        bay.style.setProperty('--bay-depth', `${depth.toFixed(1)}px`)
        bay.style.setProperty('--bay-opacity', (arrival * (1 - departure)).toFixed(4))
        bay.style.setProperty('--bay-blur', `${blur.toFixed(2)}px`)
        bay.style.setProperty('--bay-lift', `${lift.toFixed(1)}px`)
      })

      frame = window.requestAnimationFrame(update)
    }

    frame = window.requestAnimationFrame(update)
    return () => window.cancelAnimationFrame(frame)
  }, [progress])

  return (
    <div aria-hidden="true" className="knowledge-backdrop" ref={root}>
      <div className="archive-plate archive-plate-far" />
      <div className="archive-plate archive-plate-mid-left" />
      <div className="archive-plate archive-plate-mid-right" />
      <div className="archive-plate archive-plate-near-left" />
      <div className="archive-plate archive-plate-near-right" />

      <div className="archive-depth-field">
        {bayStops.map((_, index) => (
          <div
            className={`archive-bay archive-bay-${index + 1}`}
            key={index}
            ref={(element) => { bays.current[index] = element }}
          >
            <div className="bay-panel bay-panel-left">
              <i />
              <span><b /><b /><b /></span>
              <small>{String(index + 1).padStart(2, '0')}</small>
            </div>
            <div className="bay-panel bay-panel-right">
              <i />
              <span><b /><b /></span>
              <small>{String(index + 7).padStart(2, '0')}</small>
            </div>
            <div className="bay-folio bay-folio-a"><i /><i /><i /></div>
            <div className="bay-folio bay-folio-b"><i /><i /></div>
          </div>
        ))}
      </div>

      <div className="archive-daylight" />
      <div className="archive-floor-light" />
      <div className="archive-grade" />
    </div>
  )
}

export default KnowledgeBackdrop
