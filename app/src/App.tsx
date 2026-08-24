import indexData from "./data/offers.json"
import type { OffersIndex } from "./lib/offers"
import HomePage from "./components/HomePage"

const index = indexData as OffersIndex

export default function App() {
  return <HomePage index={index} />
}
