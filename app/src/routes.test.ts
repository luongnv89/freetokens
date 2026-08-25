import { afterEach, describe, expect, it } from "vitest"
import { resolveRoute } from "./routes"

describe("resolveRoute", () => {
  afterEach(() => {
    document.body.innerHTML = ""
  })

  it("defaults to home when #root has no data-page", () => {
    document.body.innerHTML = `<div id="root"></div>`
    expect(resolveRoute()).toEqual({ page: "home" })
  })

  it("reads data-page from the default document so hydrate matches prerender", () => {
    document.body.innerHTML = `<div id="root" data-page="archive"></div>`
    expect(resolveRoute()).toEqual({ page: "archive" })
    document.body.innerHTML = `<div id="root" data-page="privacy"></div>`
    expect(resolveRoute()).toEqual({ page: "privacy" })
    document.body.innerHTML = `<div id="root" data-page="detail" data-slug="github-copilot-free"></div>`
    expect(resolveRoute()).toEqual({
      page: "detail",
      slug: "github-copilot-free",
    })
  })
})
