import { NextResponse } from 'next/server';
import { getInventoryStock, createStockAdjustment } from '@/lib/db-service';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const data = await getInventoryStock();
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
