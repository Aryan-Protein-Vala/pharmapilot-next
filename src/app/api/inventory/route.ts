import { NextResponse } from 'next/server';
import { getInventoryStock, createStockAdjustment } from '@/lib/db-service';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const query = searchParams.get('q') || '';
    const filter = searchParams.get('filter') || 'all';
    const limit = Math.min(250, Math.max(1, parseInt(searchParams.get('limit') || '100', 10)));
    const offset = Math.max(0, parseInt(searchParams.get('offset') || '0', 10));

    const data = await getInventoryStock({ query, filter, limit, offset });
    return NextResponse.json(data);
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Failed to fetch inventory stock' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const payload = await request.json();
    const result = await createStockAdjustment(payload);
    return NextResponse.json(result);
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Failed to adjust stock' }, { status: 400 });
  }
}
