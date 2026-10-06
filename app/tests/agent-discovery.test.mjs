import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Agent-discovery manifests (issues #527–#532): static documents under
// app/public/.well-known/ must satisfy each spec's structural contract and —
// just as important for a static host — stay internally consistent: every
// absolute URL they publish must point at a resource this site really serves.

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PUBLIC = path.join(ROOT, "public");
const WELL_KNOWN = path.join(PUBLIC, ".well-known");
const SITE = "https://freetokens.custats.info";

function readJson(relPath) {
  return JSON.parse(readFileSync(path.join(PUBLIC, relPath), "utf8"));
}

// Routes rendered at build time (prerendered pages, Markdown twins, feed,
// sitemap) are absent from public/ but exist in dist/. A manifest URL is
// "real" when it maps to a committed file or one of these generated shapes.
const GENERATED_ROUTE = [
  /^\/$/, // prerendered home page
  /\.html$/, // prerendered page (/, /about.html, /offers/<slug>.html, …)
  /^\/offers\/[a-z0-9-]+\.md$/, // generated per-offer Markdown twin
  /^\/(index|about|archive|privacy)\.md$/, // generated page Markdown twins
  /^\/feed\.xml$/,
  /^\/sitemap\.xml$/,
];

function assertResolvableSiteUrl(url) {
  expect(url.startsWith(`${SITE}/`)).toBe(true);
  const rel = url.slice(SITE.length);
  if (rel.includes("{")) return; // URL template, not a concrete resource
  if (GENERATED_ROUTE.some((re) => re.test(rel))) return;
  expect(
    existsSync(path.join(PUBLIC, rel)),
    `${url} must resolve to a file under app/public/`,
  ).toBe(true);
}

function siteUrls(value, found = []) {
  if (typeof value === "string") {
    if (value.startsWith(`${SITE}/`)) found.push(value);
  } else if (Array.isArray(value)) {
    for (const item of value) siteUrls(item, found);
  } else if (value && typeof value === "object") {
    for (const item of Object.values(value)) siteUrls(item, found);
  }
  return found;
}

describe("A2A agent card (#527)", () => {
  const card = readJson(".well-known/agent-card.json");

  it("publishes name, version, description and a usable interface", () => {
    expect(card.name).toBe("Free AI Credits");
    expect(card.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(card.description.length).toBeGreaterThan(0);
    expect(card.supportedInterfaces.length).toBeGreaterThan(0);
    const [iface] = card.supportedInterfaces;
    expect(iface.url).toBe(`${SITE}/`);
    expect(iface.protocolBinding).toBeTruthy();
    expect(iface.protocolVersion).toBeTruthy();
  });

  it("declares honest capabilities and tagged skills", () => {
    // Static site: every interactive A2A capability must stay off.
    expect(card.capabilities.streaming).toBe(false);
    expect(card.capabilities.pushNotifications).toBe(false);
    expect(card.skills.length).toBeGreaterThan(0);
    for (const skill of card.skills) {
      expect(skill.id).toMatch(/^[a-z0-9-]+$/);
      expect(skill.name).toBeTruthy();
      expect(skill.description).toBeTruthy();
      expect(skill.examples.length).toBeGreaterThan(0);
    }
  });
});

describe("agent skills index (#528)", () => {
  const index = readJson(".well-known/agent-skills/index.json");

  it("follows the 0.2.0 discovery schema with name/type/description/url/digest", () => {
    expect(index.$schema).toBe(
      "https://schemas.agentskills.io/discovery/0.2.0/schema.json",
    );
    expect(index.skills.length).toBeGreaterThan(0);
    for (const skill of index.skills) {
      expect(skill.name).toMatch(/^[a-z0-9-]+$/);
      expect(["skill-md", "archive"]).toContain(skill.type);
      expect(skill.description).toBeTruthy();
      expect(skill.url).toMatch(/^https:\/\//);
      expect(skill.digest).toMatch(/^sha256:[0-9a-f]{64}$/);
    }
  });

  it("keeps digests equal to the sha256 of the referenced artifacts", () => {
    for (const skill of index.skills) {
      const rel = new URL(skill.url).pathname;
      const artifact = readFileSync(path.join(PUBLIC, rel));
      const actual = `sha256:${createHash("sha256").update(artifact).digest("hex")}`;
      expect(
        actual,
        `digest for ${rel} drifted — recompute after editing the skill`,
      ).toBe(skill.digest);
    }
  });
});

describe("API catalog — RFC 9727 linkset (#529)", () => {
  it("serves the same linkset at the well-known path and its .json twin", () => {
    const extensionless = readFileSync(
      path.join(WELL_KNOWN, "api-catalog"),
      "utf8",
    );
    const json = readFileSync(
      path.join(WELL_KNOWN, "api-catalog.json"),
      "utf8",
    );
    expect(json).toBe(extensionless);
    const catalog = JSON.parse(json);
    expect(Array.isArray(catalog.linkset)).toBe(true);
    for (const entry of catalog.linkset) {
      expect(entry.anchor).toMatch(/^https:\/\//);
      // Each cataloged API needs a machine-readable description and docs.
      expect(entry["service-desc"].length).toBeGreaterThan(0);
      expect(entry["service-doc"].length).toBeGreaterThan(0);
      for (const rel of ["service-desc", "service-doc", "status"]) {
        for (const link of entry[rel] ?? []) {
          expect(link.href).toMatch(/^https:\/\//);
        }
      }
    }
  });
});

describe("ARD ai-catalog manifest (#530)", () => {
  const catalog = readJson(".well-known/ai-catalog.json");

  it("carries specVersion, a stable host identity, and spec-shaped entries", () => {
    expect(catalog.specVersion).toBeTruthy();
    expect(catalog.host.displayName).toBe("Free AI Credits");
    expect(catalog.host.identifier).toBe("did:web:freetokens.custats.info");
    expect(catalog.entries.length).toBeGreaterThan(0);
    for (const entry of catalog.entries) {
      expect(entry.identifier).toMatch(
        /^urn:air:freetokens\.custats\.info:[a-z-]+:[a-z0-9-]+$/,
      );
      expect(entry.displayName).toBeTruthy();
      expect(entry.type).toMatch(/^[-\w.]+\/[-\w.+]+$/);
      // spec §3.4: exactly one of url / data
      expect([entry.url, entry.data].filter((v) => v !== undefined)).toHaveLength(1);
      expect(entry.representativeQueries.length).toBeGreaterThanOrEqual(2);
      expect(entry.representativeQueries.length).toBeLessThanOrEqual(5);
    }
  });
});

describe("OAuth authorization-server metadata — RFC 8414 (#533)", () => {
  const asMeta = readJson(".well-known/oauth-authorization-server.json");

  it("serves identical documents at the extensionless path and its .json twin", () => {
    const extensionless = readFileSync(
      path.join(WELL_KNOWN, "oauth-authorization-server"),
      "utf8",
    );
    const json = readFileSync(
      path.join(WELL_KNOWN, "oauth-authorization-server.json"),
      "utf8",
    );
    expect(json).toBe(extensionless);
    expect(asMeta.issuer).toBe(SITE);
  });

  it("declares no grant flows and fabricates no endpoints", () => {
    // The site runs no auth server: RFC 8414 endpoint fields must stay absent
    // rather than point at URLs that do not exist.
    expect(asMeta.grant_types_supported).toEqual([]);
    expect(asMeta.response_types_supported).toEqual([]);
    for (const field of [
      "authorization_endpoint",
      "token_endpoint",
      "jwks_uri",
      "registration_endpoint",
      "revocation_endpoint",
    ]) {
      expect(
        asMeta[field],
        `${field} must stay absent — no such endpoint exists on this static site`,
      ).toBeUndefined();
    }
  });

  it("advertises anonymous agent_auth pointing back at /auth.md (#531, #546)", () => {
    const agentAuth = asMeta.agent_auth;
    expect(agentAuth.skill).toBe(`${SITE}/auth.md`);
    expect(agentAuth.register_uri).toBe(`${SITE}/auth.md`);
    // auth-md: claim_uri belongs at the agent_auth level — the scanner does
    // not read a copy nested under `anonymous`.
    expect(agentAuth.claim_uri).toBe(`${SITE}/auth.md`);
    expect(agentAuth.identity_types_supported).toContain("anonymous");
    // Anonymous access carries no credential, so "none" is the honest
    // non-empty declaration; the scanner rejects an empty array.
    expect(agentAuth.anonymous.credential_types_supported).toEqual(["none"]);
    expect(agentAuth.anonymous.claim_uri).toBeUndefined();
  });
});

describe("OAuth protected-resource metadata — RFC 9728 (#534)", () => {
  const prm = readJson(".well-known/oauth-protected-resource.json");

  it("serves identical documents at the extensionless path and its .json twin", () => {
    const extensionless = readFileSync(
      path.join(WELL_KNOWN, "oauth-protected-resource"),
      "utf8",
    );
    const json = readFileSync(
      path.join(WELL_KNOWN, "oauth-protected-resource.json"),
      "utf8",
    );
    expect(json).toBe(extensionless);
  });

  it("names the site as the resource and lists its own issuer as the AS", () => {
    expect(prm.resource).toBe(`${SITE}/`);
    expect(prm.resource_name).toBe("Free AI Credits");
    expect(prm.authorization_servers).toEqual([SITE]);
    expect(prm.bearer_methods_supported).toContain("header");
    expect(prm.scopes_supported).toEqual(["read"]);
  });

  it("every advertised authorization server resolves to served AS metadata", () => {
    for (const issuer of prm.authorization_servers) {
      assertResolvableSiteUrl(
        `${issuer}/.well-known/oauth-authorization-server`,
      );
    }
  });
});

describe("auth.md — agent registration document (#531)", () => {
  const doc = readFileSync(path.join(PUBLIC, "auth.md"), "utf8");

  it("is a Markdown document whose H1 contains 'auth.md'", () => {
    expect(doc.split("\n")[0]).toMatch(/^#\s.*auth\.md/);
  });

  it("states honestly that no registration or credentials are needed", () => {
    expect(doc).toMatch(/no authentication/i);
    expect(doc).toMatch(/anonymous/i);
    expect(doc).toMatch(/no\s+registration\s+endpoint\s+exists/i);
  });
});

describe("MCP server card — SEP-1649 (#532)", () => {
  const card = readJson(".well-known/mcp/server-card.json");

  it("identifies the server, its transport endpoint, and capabilities", () => {
    expect(card.serverInfo.name).toBe("freetokens");
    expect(card.serverInfo.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(card.transport.endpoint).toBe(`${SITE}/`);
    for (const primitive of ["tools", "resources", "prompts"]) {
      expect(card.capabilities).toHaveProperty(primitive);
    }
    // The card must not pretend to a live MCP transport.
    expect(card.description).toMatch(/does not run an interactive MCP/i);
    expect(card.tools).toEqual([]);
    expect(card.prompts).toEqual([]);
    for (const resource of card.resources) {
      assertResolvableSiteUrl(resource.uri);
    }
  });
});

describe("manifest URL integrity", () => {
  it("every site URL a manifest publishes resolves to a served resource", () => {
    const manifests = [
      ".well-known/agent-card.json",
      ".well-known/agent-skills/index.json",
      ".well-known/api-catalog.json",
      ".well-known/ai-catalog.json",
      ".well-known/mcp/server-card.json",
      ".well-known/oauth-authorization-server.json",
      ".well-known/oauth-protected-resource.json",
      "openapi.json",
    ];
    const all = [];
    for (const rel of manifests) {
      const urls = siteUrls(readJson(rel));
      for (const url of urls) {
        try {
          assertResolvableSiteUrl(url);
        } catch (error) {
          throw new Error(`${rel}: ${error.message}`);
        }
      }
      all.push(...urls);
    }
    expect(all.length).toBeGreaterThan(0);
  });
});
