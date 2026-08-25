import indexData from "./data/offers.json"
import type { OffersIndex } from "./lib/offers"
import { type Route, resolveRoute } from "./routes"
import HomePage from "./components/HomePage"
import ArchivePage from "./components/ArchivePage"
import PrivacyPage from "./components/PrivacyPage"
import OfferDetailPage from "./components/OfferDetailPage"
import { ConsentBanner } from "./components/ConsentBanner"

const index = indexData as OffersIndex

export default function App({ route }: { route?: Route }) {
  const r = route ?? resolveRoute()
  let page
  switch (r.page) {
    case "archive":
      page = <ArchivePage index={index} />
      break
    case "privacy":
      page = <PrivacyPage />
      break
    case "detail":
      page = <OfferDetailPage index={index} slug={r.slug} />
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
