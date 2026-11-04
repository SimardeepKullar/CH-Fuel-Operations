import NewPlanView from "../../components/NewPlanView";
import { devToolsEnabled } from "../../lib/devTools";

// APP_ENV is read per request, never baked in at build time: Vercel can
// promote a preview build to production without rebuilding it (T-104).
export const dynamic = "force-dynamic";

export default function NewPlanPage() {
  return <NewPlanView showDevTools={devToolsEnabled(process.env.APP_ENV)} />;
}
