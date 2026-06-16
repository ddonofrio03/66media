import { NextResponse, type NextRequest } from "next/server";

/**
 * Site-wide HTTP Basic Auth (shared login).
 *
 * Credentials come from BASIC_AUTH_USER / BASIC_AUTH_PASSWORD. If either is
 * unset the gate is disabled (fail open) so a missing env var can never lock
 * everyone out of the dashboard.
 *
 * The cron endpoint is excluded via the matcher below — Vercel's scheduler
 * authenticates with a Bearer token, not Basic auth, so gating it would break
 * the daily digest.
 */
export const config = {
  matcher: ["/((?!api/cron|_next/static|_next/image|favicon.ico).*)"],
};

export function middleware(request: NextRequest) {
  const expectedUser = process.env.BASIC_AUTH_USER;
  const expectedPassword = process.env.BASIC_AUTH_PASSWORD;

  // Not configured → don't gate anything.
  if (!expectedUser || !expectedPassword) {
    return NextResponse.next();
  }

  const header = request.headers.get("authorization");
  if (header?.startsWith("Basic ")) {
    const decoded = atob(header.slice("Basic ".length));
    const separator = decoded.indexOf(":");
    const user = decoded.slice(0, separator);
    const password = decoded.slice(separator + 1);

    if (user === expectedUser && password === expectedPassword) {
      return NextResponse.next();
    }
  }

  return new NextResponse("Authentication required.", {
    status: 401,
    headers: {
      "WWW-Authenticate": 'Basic realm="66 Media Monitor", charset="UTF-8"',
    },
  });
}
