import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { CopyLinkButton } from "./CopyLinkButton"
import { offerAbsoluteUrl } from "../lib/site"

const URL = offerAbsoluteUrl("example-offer")

beforeEach(() => {
  vi.restoreAllMocks()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe("CopyLinkButton (#128)", () => {
  it("copies via the modern clipboard API and confirms visibly", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    })
    render(<CopyLinkButton url={URL} />)
    fireEvent.click(screen.getByRole("button", { name: "Copy link" }))
    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith(URL)
      expect(screen.getByRole("status")).toHaveTextContent("Link copied!")
    })
    expect(screen.getByRole("status")).not.toHaveAttribute("hidden")
  })

  it("falls back to textarea + execCommand when clipboard is missing", async () => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: undefined,
    })
    const exec = vi.fn().mockReturnValue(true)
    document.execCommand = exec
    render(<CopyLinkButton url={URL} />)
    fireEvent.click(screen.getByRole("button", { name: "Copy link" }))
    await waitFor(() => {
      expect(exec).toHaveBeenCalledWith("copy")
      expect(screen.getByRole("status")).toHaveTextContent("Link copied!")
    })
  })

  it("falls back to execCommand when writeText rejects", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("denied"))
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    })
    document.execCommand = vi.fn().mockReturnValue(true)
    render(<CopyLinkButton url={URL} />)
    fireEvent.click(screen.getByRole("button", { name: "Copy link" }))
    await waitFor(() => {
      expect(document.execCommand).toHaveBeenCalledWith("copy")
      expect(screen.getByRole("status")).toHaveTextContent("Link copied!")
    })
  })

  it("announces failure when both clipboard paths fail", async () => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: undefined,
    })
    document.execCommand = vi.fn().mockReturnValue(false)
    render(<CopyLinkButton url={URL} />)
    fireEvent.click(screen.getByRole("button", { name: "Copy link" }))
    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent(
        "Copy failed — long-press the address bar instead.",
      )
    })
  })
})
