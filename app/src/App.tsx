import indexData from "./data/offers.json"
import type { OffersIndex } from "./lib/offers"
import { type Route, resolveRoute } from "./routes"
import HomePage from "./components/HomePage"
import ArchivePage from "./components/ArchivePage"
import PrivacyPage from "./components/PrivacyPage"
import OfferDetailPage from "./components/OfferDetailPage"

const index = indexData as OffersIndex

export default function App({ route }: { route?: Route }) {
  const r = route ?? resolveRoute()
  switch (r.page) {
    case "archive":
      return <ArchivePage index={index} />
    case "privacy":
      return <PrivacyPage />
    case "detail":
      return <OfferDetailPage index={index} slug={r.slug} />
    default:
      return <HomePage index={index} />
  }
}
