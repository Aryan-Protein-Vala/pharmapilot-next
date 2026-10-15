import { NextResponse } from 'next/server';
import { createMedicineMaster, updateMedicineMaster } from '@/lib/db-service';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const payload = await request.json();
    const result = await createMedicineMaster(payload);
    return NextResponse.json(result, { status: 201 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Failed to create medicine master' }, { status: 400 });
  }
}

export async function PUT(request: Request) {
  try {
    const payload = await request.json();
    const id = payload.id || payload.itemId;
    if (!id) {
      return NextResponse.json({ error: 'Medicine ID is required' }, { status: 400 });
    }
    const result = await updateMedicineMaster(id, payload);
    return NextResponse.json(result, { status: 200 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Failed to update medicine master' }, { status: 400 });
  }
}
