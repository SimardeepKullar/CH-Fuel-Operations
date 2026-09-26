/**
 * RFC 9457 "Problem Details for HTTP APIs" — every API error is this shape,
 * served as `application/problem+json` so a client (or a browser hitting an
 * API path by mistake) never mistakes an error for a redirect or an HTML page.
 */
export interface ProblemDetails {
  type?: string;
  title: string;
  status: number;
  detail?: string;
  instance?: string;
}

export function problemResponse(problem: ProblemDetails): Response {
  const body: ProblemDetails = { type: "about:blank", ...problem };
  return new Response(JSON.stringify(body), {
    status: problem.status,
    headers: { "content-type": "application/problem+json" },
  });
}
