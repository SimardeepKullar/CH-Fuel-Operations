import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // `@ch/core/api/app` eagerly imports every route module, including
  // invoices.ts -> backend/src/invoice/parseInvoicePdf.ts -> pdf-parse ->
  // pdfjs-dist — a Node-targeted, non-RSC-safe legacy CJS/ESM interop shim.
  // Bundled by webpack for the catch-all API route, its module-scope code
  // throws ("Object.defineProperty called on non-object") the instant any
  // /api/v1/* route handler is actually invoked. Excluding it from bundling
  // lets Node `require` it natively at runtime instead, exactly as the
  // backend's own tests and `npm run serve` already do successfully.
  serverExternalPackages: ["pdf-parse", "pdfjs-dist", "pdfkit"],
  // Vercel ships each function with only the files Next's tracer finds, and
  // it cannot see what pdfjs-dist loads at runtime: `./pdf.worker.mjs` (its
  // Node "fake worker", imported by a computed path; without it every invoice
  // import fails) and `@napi-rs/canvas` (its DOMMatrix/ImageData polyfill,
  // loaded through createRequire). Paths are from frontend/; the workspace's
  // node_modules is one level up.
  outputFileTracingIncludes: {
    // A glob: the brackets in the real route name, [[...path]], would read as a
    // character class and match nothing.
    "/api/v1/**": [
      "../node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs",
      "../node_modules/@napi-rs/canvas*/**",
    ],
  },
};

export default nextConfig;
