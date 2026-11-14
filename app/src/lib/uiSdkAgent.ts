// ui-sdk trial (#726): publishes ui-sdk's snapshot/query/act WebMCP tools.
// main.tsx imports this lazily, only when the browser exposes document.modelContext,
// so visitors without WebMCP never download the bridge.
import { createAgent, registerTools } from "@ui-sdk/react/agent";

export function registerUiSdkAgent(): () => void {
  const agent = createAgent();
  // `search` only filters the public listing; refuse anything else so a
  // ui-sdk control added later is not driveable by a page agent by default.
  return registerTools(agent, { allow: (step) => step.action === "search" });
}
