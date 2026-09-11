import type { OffersIndex } from "./lib/offers";
import type { DetailsMap } from "./lib/offerDetails";
import { type Route, resolveRoute } from "./routes";
import HomePage from "./components/HomePage";
import ArchivePage from "./components/ArchivePage";
import PrivacyPage from "./components/PrivacyPage";
import AboutPage from "./components/AboutPage";
import OfferDetailPage from "./components/OfferDetailPage";
import { ConsentBanner } from "./components/ConsentBanner";
import { CustatsBanner } from "./components/CustatsBanner";

export default function App({
  index,
  details,
  route,
  baseUrl,
}: {
  index: OffersIndex;
  /** Aggregate details map; undefined when the client never loaded it. */
  details?: DetailsMap;
  route?: Route;
  baseUrl?: string;
}) {
  const r = route ?? resolveRoute();
  let page;
  switch (r.page) {
    case "archive":
      page = <ArchivePage index={index} baseUrl={baseUrl} />;
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
      {page}
      <CustatsBanner />
      <ConsentBanner />
    </>
  );
}
