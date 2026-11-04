/**
 * Dev Tools runs plans with hand-set solver constraints, so it saves plans
 * and spends ORS quota. It stays out of production and preview (T-104).
 * Unknown values are not rejected here: the server's own startup already
 * fails on an APP_ENV outside the five known ones (T-98).
 */
export function devToolsEnabled(appEnv: string | undefined): boolean {
  return appEnv !== "production" && appEnv !== "preview";
}
