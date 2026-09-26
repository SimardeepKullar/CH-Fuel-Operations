import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createApp } from "../api/app.js";

const DEFAULT_PORT = 3001;

/**
 * §13: a local mount, no session check, binding `127.0.0.1` only — for
 * curl/dev testing of `backend/src/api/` outside the Next dev server. The
 * real, authenticated mount is `frontend/src/app/api/v1/[[...path]]/
 * route.ts`, which calls `auth()` and passes `context.userId` through; this
 * exists purely so `createApp({ authRequired: false })` has somewhere to
 * run standalone. Not a production entry point.
 *
 * The only translation here is Node's `http` callback shape to the
 * `Request`/`Response` pair `createApp().handle()` already speaks — no
 * business logic, per §13's CLI rule ("argv and stdout, nothing else").
 */
export function startServeCli(port: number): ReturnType<typeof createServer> {
  const app = createApp({ authRequired: false });

  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      void handleRequest(app, req, res, chunks, port);
    });
  });

  server.listen(port, "127.0.0.1", () => {
    console.log(`serving backend/src/api on http://127.0.0.1:${port}/api/v1 — no auth, local only`);
  });

  return server;
}

async function handleRequest(
  app: ReturnType<typeof createApp>,
  req: import("node:http").IncomingMessage,
  res: import("node:http").ServerResponse,
  chunks: Buffer[],
  port: number,
): Promise<void> {
  const method = req.method ?? "GET";
  const url = `http://127.0.0.1:${port}${req.url ?? "/"}`;
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    headers.set(key, Array.isArray(value) ? value.join(", ") : value);
  }
  const hasBody = method !== "GET" && method !== "HEAD" && chunks.length > 0;

  try {
    const request = new Request(url, { method, headers, body: hasBody ? Buffer.concat(chunks) : undefined });
    const response = await app.handle(request);
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(response.body ? Buffer.from(await response.arrayBuffer()) : undefined);
  } catch (err) {
    res.writeHead(500, { "content-type": "application/problem+json" });
    res.end(
      JSON.stringify({
        type: "about:blank",
        title: "Internal Server Error",
        status: 500,
        detail: err instanceof Error ? err.message : String(err),
      }),
    );
  }
}

const isMainModule = process.argv[1] !== undefined && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (isMainModule) {
  const port = Number(process.env.PORT ?? DEFAULT_PORT);
  startServeCli(port);
}
