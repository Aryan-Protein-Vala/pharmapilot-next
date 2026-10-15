import { NextResponse } from 'next/server';
import { getShortbookItems, addToShortbook, updateShortbookStatus } from '@/lib/db-service';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const data = await getShortbookItems();
    return NextResponse.json(data);
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Failed to fetch shortbook' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const payload = await request.json();
    const result = await addToShortbook(payload);
    return NextResponse.json(result, { status: 201 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Failed to add shortbook item' }, { status: 400 });
  }
}

export async function PATCH(request: Request) {
  try {
    const payload = await request.json();
    if (!payload.id || !payload.status) {
      return NextResponse.json({ error: 'Shortbook entry ID and status are required' }, { status: 400 });
    }
    const result = await updateShortbookStatus(payload.id, payload.status, payload.notes);
    return NextResponse.json(result, { status: 200 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Failed to update shortbook entry' }, { status: 400 });
  }
}
