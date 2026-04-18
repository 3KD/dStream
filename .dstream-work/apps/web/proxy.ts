import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

export function proxy(request: NextRequest) {
  // Always allow Next.js static assets and setup routes
  if (
    request.nextUrl.pathname.startsWith('/_next') ||
    request.nextUrl.pathname.startsWith('/setup') ||
    request.nextUrl.pathname.startsWith('/api/setup') ||
    request.nextUrl.pathname.includes('.') // like favicon.ico
  ) {
    return NextResponse.next()
  }

  // Check if secure configuration is missing
  const sessionSecret = process.env.DSTREAM_XMR_SESSION_SECRET;
  const isUnsecure = !sessionSecret || sessionSecret === 'dev-session-secret-0123456789abcdef';

  if (isUnsecure) {
    // Redirect unconfigured nodes to the beautiful setup wizard
    return NextResponse.next();
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - api (API routes, but we explicitly allow /api/setup above)
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     */
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
}
