import { NextResponse } from 'next/server';

// Cookie session: everything but the login page, About and the APIs needs it
const PUBLIC = [/^\/login$/, /^\/about$/, /^\/api\//, /^\/_next\//, /^\/favicon/];

export function middleware(req) {
  const { pathname } = req.nextUrl;
  if (PUBLIC.some((re) => re.test(pathname))) return NextResponse.next();
  if (req.cookies.get('session')?.value !== 'ok') return NextResponse.redirect(new URL('/login', req.url));
  // No permission: back to the dashboard
  if (pathname === '/admin') return NextResponse.redirect(new URL('/dashboard', req.url));
  return NextResponse.next();
}
