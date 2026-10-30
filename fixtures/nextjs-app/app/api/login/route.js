import { NextResponse } from 'next/server';

// Login: demo@example.com / demo
export async function POST(req) {
  const { email, password } = await req.json();
  if (email !== 'demo@example.com' || password !== 'demo') return NextResponse.json({ error: 'bad login' }, { status: 401 });
  const res = NextResponse.json({ ok: true });
  res.cookies.set('session', 'ok', { httpOnly: true, sameSite: 'lax', path: '/' });
  return res;
}
