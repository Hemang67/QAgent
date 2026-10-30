import { NextResponse } from 'next/server';
import { ITEMS } from '../route';

export async function GET(_req, { params }) {
  const { id } = await params;
  const item = ITEMS.find((i) => i.id === Number(id));
  return item ? NextResponse.json(item) : NextResponse.json({ error: 'not found' }, { status: 404 });
}
