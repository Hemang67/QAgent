import { NextResponse } from 'next/server';

export const ITEMS = [
  { id: 1, name: 'Brush' },
  { id: 2, name: 'Roller' },
];

export async function GET() {
  return NextResponse.json(ITEMS);
}
