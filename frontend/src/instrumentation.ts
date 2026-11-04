// Next calls register() once when a server instance boots. Importing the pool
// module loads the APP_ENV-selected .env files (T-98); the one line it prints
// names the environment and database, never the credentials, so a server
// pointed at the wrong database says so before it serves a request.
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") {
    return;
  }
  const { currentTarget } = await import("@ch/core/db/pool");
  console.error(currentTarget());
}
