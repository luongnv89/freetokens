import type { OffersIndex } from "./lib/offers";
import type { DetailsMap } from "./lib/offerDetails";
import { type Route, resolveRoute } from "./routes";
import HomePage from "./components/HomePage";
import ArchivePage from "./components/ArchivePage";
import UnverifiedPage from "./components/UnverifiedPage";
import { EMPTY_LEADS, type LeadsIndex } from "./lib/leads";
import PrivacyPage from "./components/PrivacyPage";
import AboutPage from "./components/AboutPage";
import OfferDetailPage from "./components/OfferDetailPage";
import { ConsentBanner } from "./components/ConsentBanner";
import { CustatsBanner } from "./components/CustatsBanner";

export default function App({
  index,
  details,
  leads,
  route,
  baseUrl,
}: {
  index: OffersIndex;
  /** Aggregate details map; undefined when the client never loaded it. */
  details?: DetailsMap;
  /** Unverified leads (#660); loaded only on the unverified route. */
  leads?: LeadsIndex;
  route?: Route;
  baseUrl?: string;
}) {
  const r = route ?? resolveRoute();
  let page;
  switch (r.page) {
    case "archive":
      page = <ArchivePage index={index} baseUrl={baseUrl} />;
      break;
    case "unverified":
      page = <UnverifiedPage leads={leads ?? EMPTY_LEADS} baseUrl={baseUrl} />;
      break;
    case "privacy":
      page = <PrivacyPage baseUrl={baseUrl} />;
      break;
    case "about":
      page = <AboutPage index={index} baseUrl={baseUrl} />;
      break;
    case "detail":
      page = <OfferDetailPage
        index={index}
        slug={r.slug}
        details={details}
        baseUrl={baseUrl}
      />;
      break;
    default:
      page = <HomePage index={index} baseUrl={baseUrl} />;
  }
  return (
    <>
      <CustatsBanner />
      {page}
      <ConsentBanner />
    </>
  );
}
