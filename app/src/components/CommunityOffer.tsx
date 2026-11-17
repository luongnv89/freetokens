import { useState } from "react";
import { copyText } from "../lib/clipboard";
import {
  COMMUNITY_BADGE_LABEL,
  COMMUNITY_BADGE_TITLE,
  atHandle,
  giveawayLine,
  humanDate,
  isXPost,
  type Community,
} from "../lib/offers";

// Community listings (#748): promo codes and giveaways a person shared on a
// public post. freetokens does not verify them, so the badge says so in words
// on every surface, and everything else shown here is quoted from the post.

export function CommunityBadge() {
  return (
    <span className="badge badge-community" title={COMMUNITY_BADGE_TITLE}>
      <svg
        className="tag-i"
        width="12"
        height="12"
        aria-hidden="true"
        focusable="false"
      >
        <use href="#ti-unverified" />
      </svg>
      <span>{COMMUNITY_BADGE_LABEL}</span>
    </span>
  );
}

/** The promo code, plus a button that copies it (no analytics, ever). */
export function PromoCode({ code, label }: { code: string; label: string }) {
  const [status, setStatus] = useState("");
  function onCopy() {
    void copyText(code).then((ok) =>
      setStatus(ok ? "Code copied" : "Copy failed — select the code instead"),
    );
  }
  return (
    <span className="c-code">
      <code className="c-code-value">{code}</code>
      <button
        type="button"
        className="chip c-copy"
        aria-label={`Copy code ${code} for ${label}`}
        onClick={onCopy}
      >
        Copy code
      </button>
      <span className="c-copy-status" role="status" aria-live="polite">
        {status}
      </span>
    </span>
  );
}

function SharedBy({ community }: { community: Community }) {
  const { shared_by: by } = community;
  return (
    <span className="c-by">
      Shared by{" "}
      <a href={by.post_url} target="_blank" rel="noopener noreferrer">
        {atHandle(by.handle)}
      </a>
      {by.name ? <> ({by.name})</> : null}
    </span>
  );
}

/** "Reply on X" for a post on X, otherwise a plain link to the post. */
export function ReplyLink({ community }: { community: Community }) {
  const url = community.shared_by.post_url;
  return (
    <a
      className="c-reply"
      href={url}
      target="_blank"
      rel="noopener noreferrer"
    >
      {isXPost(url) ? "Reply on X" : "Open the post"}{" "}
      <span aria-hidden="true">&#8599;</span>
    </a>
  );
}

function Sep() {
  return (
    <span className="sep" aria-hidden="true">
      &middot;
    </span>
  );
}

/**
 * The community line on a listing row: who shared it, then the code with its
 * copy button (promo_code) or the "N codes · entries close <date>" line and
 * the reply link (giveaway).
 */
export function CommunityRowLine({
  community,
  title,
}: {
  community: Community;
  title: string;
}) {
  const giveaway = community.subtype === "giveaway" ? giveawayLine(community) : "";
  return (
    <p className="r-community">
      <SharedBy community={community} />
      {community.subtype === "promo_code" && community.promo_code ? (
        <>
          <Sep />
          <PromoCode code={community.promo_code} label={title} />
        </>
      ) : null}
      {giveaway ? (
        <>
          <Sep />
          <span className="c-giveaway">
            {giveaway}
            {community.entries_close && community.timezone_note ? (
              <span className="c-tz"> ({community.timezone_note})</span>
            ) : null}
          </span>
        </>
      ) : null}
      {community.subtype === "giveaway" ? (
        <>
          <Sep />
          <ReplyLink community={community} />
        </>
      ) : null}
    </p>
  );
}

/** Detail-page panel: the same facts, spelled out, above the claim steps. */
export function CommunityPanel({
  community,
  title,
}: {
  community: Community;
  title: string;
}) {
  const by = community.shared_by;
  const giveaway = community.subtype === "giveaway" ? giveawayLine(community) : "";
  return (
    <section className="od-community" aria-labelledby="od-community-head">
      <h2 id="od-community-head">
        {community.subtype === "giveaway"
          ? "Community giveaway"
          : "Community promo code"}
      </h2>
      <p>
        <CommunityBadge />
      </p>
      <p>
        Shared by{" "}
        <a href={by.post_url} target="_blank" rel="noopener noreferrer">
          {atHandle(by.handle)}
        </a>
        {by.name ? <> ({by.name})</> : null} on{" "}
        <time dateTime={by.post_date}>{humanDate(by.post_date)}</time>. Every
        detail here is quoted from that post; freetokens has not checked it.
      </p>
      {community.subtype === "promo_code" && community.promo_code ? (
        <p>
          Code: <PromoCode code={community.promo_code} label={title} />
        </p>
      ) : null}
      {giveaway ? (
        <p className="c-giveaway">
          {giveaway}
          {community.timezone_note ? ` (${community.timezone_note})` : ""}
        </p>
      ) : null}
      {community.subtype === "giveaway" ? (
        <p>
          <ReplyLink community={community} />
        </p>
      ) : null}
    </section>
  );
}
