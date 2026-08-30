import { currentBaseUrl } from "../lib/site"

type BreadcrumbItem = {
  name: string
  item: string
  href?: string
}

type BreadcrumbsProps =
  | {
      page: "archive"
      baseUrl?: string
    }
  | {
      page: "privacy"
      baseUrl?: string
    }
  | {
      page: "about"
      baseUrl?: string
    }
  | {
      page: "detail"
      slug: string
      title: string
      baseUrl?: string
    }

function normalizeBaseUrl(baseUrl?: string): string {
  return (baseUrl?.trim() || currentBaseUrl()).replace(/\/+$/, "")
}

/** Build the one breadcrumb model shared by the visible trail and JSON-LD. */
function buildBreadcrumbItems(props: BreadcrumbsProps): BreadcrumbItem[] {
  const baseUrl = normalizeBaseUrl(props.baseUrl)

  if (props.page === "archive") {
    return [
      { name: "Offers", href: "./index.html", item: `${baseUrl}/` },
      { name: "Archive", item: `${baseUrl}/archive.html` },
    ]
  }

  if (props.page === "privacy") {
    return [
      { name: "Offers", href: "./index.html", item: `${baseUrl}/` },
      { name: "Privacy", item: `${baseUrl}/privacy.html` },
    ]
  }

  if (props.page === "about") {
    return [
      { name: "Offers", href: "./index.html", item: `${baseUrl}/` },
      { name: "About", item: `${baseUrl}/about.html` },
    ]
  }

  const slug = props.slug || "not-found"
  return [
    { name: "Offers", href: "../index.html", item: `${baseUrl}/` },
    {
      name: props.title || "Offer not found",
      item: `${baseUrl}/offers/${slug}.html`,
    },
  ]
}

function safeJsonLd(value: unknown): string {
  return (JSON.stringify(value) ?? "").replace(/[&<>\u2028\u2029]/g, (character) => {
    const escapes: Record<string, string> = {
      "&": "\\u0026",
      "<": "\\u003C",
      ">": "\\u003E",
      "\u2028": "\\u2028",
      "\u2029": "\\u2029",
    }
    return escapes[character] ?? character
  })
}

export function Breadcrumbs(props: BreadcrumbsProps) {
  const items = buildBreadcrumbItems(props)
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      item: item.item,
    })),
  }

  return (
    <>
      <nav className="breadcrumbs" aria-label="Breadcrumb">
        <ol className="breadcrumbs-list">
          {items.map((item, index) => (
            <li key={item.item}>
              {index > 0 ? (
                <span className="breadcrumbs-separator" aria-hidden="true">
                  &rsaquo;
                </span>
              ) : null}
              {item.href ? (
                <a href={item.href}>{item.name}</a>
              ) : (
                <span aria-current="page">{item.name}</span>
              )}
            </li>
          ))}
        </ol>
      </nav>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: safeJsonLd(jsonLd) }}
      />
    </>
  )
}
