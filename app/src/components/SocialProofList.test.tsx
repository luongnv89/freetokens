import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { SocialProofList } from "./SocialProofList";

const FOUR_PROOFS = [
  {
    type: "x",
    url: "https://x.com/ada/status/1",
    author: "Ada",
    handle: "@ada",
    text: "This offer is live.",
  },
  {
    type: "reddit",
    url: "https://www.reddit.com/r/LocalLLaMA/comments/abc/offer/",
    author: "u/ada",
    community: "r/LocalLLaMA",
    text: "Confirmed on the official page.",
  },
  {
    type: "screenshot",
    image: "assets/gmi-minimax-m3-curator-run.jpg",
    caption: "Curator run of the free model.",
  },
  {
    type: "link",
    url: "https://example.com/pricing",
    title: "Official pricing",
    text: "The free tier is listed here.",
  },
];

describe("SocialProofList (#128)", () => {
  it("renders all four proof types with required keys and the committed screenshot", () => {
    const markup = renderToStaticMarkup(
      <SocialProofList proofs={FOUR_PROOFS} />,
    );
    expect(markup).toContain('class="proof-card proof-x"');
    expect(markup).toContain("View post on X");
    expect(markup).toContain("@ada");
    expect(markup).toContain('class="proof-card proof-reddit"');
    expect(markup).toContain("View on Reddit");
    expect(markup).toContain("r/LocalLLaMA");
    expect(markup).toContain('class="proof-card proof-screenshot"');
    expect(markup).toContain('src="../assets/gmi-minimax-m3-curator-run.jpg"');
    expect(markup).toContain("Curator run of the free model.");
    expect(markup).toContain('class="proof-card proof-link"');
    expect(markup).toContain("Open source");
    expect(markup).toContain("Official pricing");
  });

  it("skips incomplete proofs so required keys stay enforced", () => {
    const markup = renderToStaticMarkup(
      <SocialProofList
        proofs={[
          { type: "x", url: "https://x.com/a", author: "Ada" },
          { type: "link", url: "https://example.com", title: "Kept" },
        ]}
      />,
    );
    expect(markup).not.toContain("proof-x");
    expect(markup).toContain("Kept");
  });

  it("renders nothing when there are no proofs, so the layout does not break", () => {
    expect(renderToStaticMarkup(<SocialProofList />)).toBe("");
    expect(renderToStaticMarkup(<SocialProofList proofs={[]} />)).toBe("");
  });
});
