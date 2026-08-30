import indexData from "./data/offers.json"
import type { OffersIndex } from "./lib/offers"
import { type Route, resolveRoute } from "./routes"
import HomePage from "./components/HomePage"
import ArchivePage from "./components/ArchivePage"
import PrivacyPage from "./components/PrivacyPage"
import OfferDetailPage from "./components/OfferDetailPage"
import { ConsentBanner } from "./components/ConsentBanner"

const index = indexData as OffersIndex

export default function App({
  route,
  baseUrl,
}: {
  route?: Route
  baseUrl?: string
}) {
  const r = route ?? resolveRoute()
  let page
  switch (r.page) {
    case "archive":
      page = <ArchivePage index={index} baseUrl={baseUrl} />
      break
    case "privacy":
      page = <PrivacyPage baseUrl={baseUrl} />
      break
    case "detail":
      page = <OfferDetailPage index={index} slug={r.slug} baseUrl={baseUrl} />
      break
    default:
      page = <HomePage index={index} />
  }
  return (
    <>
      {page}
      <ConsentBanner />
    </>
  )
}
