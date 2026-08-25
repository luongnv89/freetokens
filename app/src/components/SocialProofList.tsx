import {
  PROOF_LINK_LABELS,
  renderableProofs,
  resolveAsset,
  type SocialProof,
} from "../lib/offerDetails"

function ProofCard({ entry, relPrefix }: { entry: SocialProof; relPrefix: string }) {
  if (entry.type === "screenshot") {
    const src = resolveAsset(entry.image, relPrefix)
    return (
      <figure className="proof-card proof-screenshot">
        <img src={src} alt={entry.caption} loading="lazy" />
        <figcaption>{entry.caption}</figcaption>
      </figure>
    )
  }
  const head =
    entry.type === "link" ? (
      <p className="proof-text">
        <strong>{entry.title}</strong>
      </p>
    ) : null
  let meta = "author" in entry ? entry.author : ""
  const handle = entry.type === "x" ? entry.handle : undefined
  const community = entry.type === "reddit" ? entry.community : undefined
  const text = "text" in entry ? entry.text : undefined
  const label = PROOF_LINK_LABELS[entry.type]
  return (
    <blockquote className={`proof-card proof-${entry.type}`}>
      {head}
      {text ? <p className="proof-text">&ldquo;{text}&rdquo;</p> : null}
      <footer>
        {meta}
        {handle ? (
          <>
            {" "}
            <span className="proof-meta">{handle}</span>
          </>
        ) : null}
        {community ? (
          <>
            {" "}
            <span className="proof-meta">{community}</span>
          </>
        ) : null}{" "}
        <a href={entry.url} target="_blank" rel="noopener noreferrer">
          {label} <span aria-hidden="true">&#8599;</span>
        </a>
      </footer>
    </blockquote>
  )
}

/**
 * Social-proof cards (build.py `_proof_section` / `_proof_card`).
 * Required keys are enforced by `renderableProofs`; unknown or incomplete
 * entries are skipped so the surrounding layout cannot break.
 */
export function SocialProofList({
  proofs,
  relPrefix = "../",
}: {
  proofs?: unknown
  relPrefix?: string
}) {
  const entries = renderableProofs(proofs)
  if (entries.length === 0) return null
  return (
    <section className="od-proof">
      <h2>Social proof</h2>
      {entries.map((entry, i) => (
        <ProofCard key={i} entry={entry} relPrefix={relPrefix} />
      ))}
    </section>
  )
}
