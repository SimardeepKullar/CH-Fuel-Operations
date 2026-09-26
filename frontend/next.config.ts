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
};

export default nextConfig;
