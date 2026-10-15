import { NextResponse } from 'next/server';
import { createOrRestockBatch, updateBatchDetails } from '@/lib/db-service';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const payload = await request.json();
    const result = await createOrRestockBatch(payload);
    return NextResponse.json(result, { status: 201 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Failed to create or restock batch' }, { status: 400 });
  }
}

export async function PUT(request: Request) {
  try {
    const payload = await request.json();
    const batchId = payload.batchId || payload.id;
    if (!batchId) {
      return NextResponse.json({ error: 'Batch ID is required' }, { status: 400 });
    }
    const result = await updateBatchDetails(batchId, payload);
    return NextResponse.json(result, { status: 200 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Failed to update batch' }, { status: 400 });
  }
}
