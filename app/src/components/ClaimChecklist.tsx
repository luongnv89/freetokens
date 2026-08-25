import { useEffect, useState } from "react"
import { readClaimProgress, writeClaimProgress } from "../lib/personalState"

/**
 * Checkable claim runbook (build.py `_claim_step_parts` + `_CHECKLIST_JS`).
 * Real checkboxes so ticking works with JS disabled; persistence and the
 * live progress readout are a hydrate-time enhancement via personalState,
 * honouring legacy `ft-claim-<slug>` bare arrays.
 */
export function ClaimChecklist({ slug, steps }: { slug: string; steps: readonly string[] }) {
  const [done, setDone] = useState<number[]>([])
  const total = steps.length
  const completed = done.filter((i) => i >= 0 && i < total).length
  const key = slug || "offer"

  useEffect(() => {
    setDone(readClaimProgress(slug))
  }, [slug])

  function toggle(index: number) {
    setDone((prev) => {
      const next = prev.includes(index) ? prev.filter((i) => i !== index) : [...prev, index]
      writeClaimProgress(slug, next)
      return next
    })
  }

  const readout = completed === 0 ? `${total}-step guide` : `${completed}/${total} done`

  return (
    <section className="od-steps" data-ft-checklist data-ft-offer-id={key}>
      <header className="od-steps-head">
        <h2>How to claim</h2>
        <p className="steps-progress">
          <span className="progress-readout" id="ft-progress-readout" role="status" aria-live="polite">
            {readout}
          </span>
          <span className="progress-track" aria-hidden="true">
            <span
              className="progress-fill"
              style={{ transform: `scaleX(${total ? completed / total : 0})` }}
            ></span>
          </span>
        </p>
      </header>
      <ol className="claim-list" role="list">
        {steps.map((step, i) => (
          <li className="claim-step" key={i}>
            <input
              type="checkbox"
              id={`ft-step-${key}-${i + 1}`}
              checked={done.includes(i)}
              onChange={() => toggle(i)}
            />
            <label htmlFor={`ft-step-${key}-${i + 1}`}>
              <span className="step-num" aria-hidden="true">
                <span className="num">{i + 1}</span>
                <span className="tick">&#10003;</span>
              </span>
              <span className="step-text">{step}</span>
            </label>
          </li>
        ))}
      </ol>
    </section>
  )
}
