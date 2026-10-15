import { NextResponse } from 'next/server';
import { getPurchaseReturnsList, processPurchaseReturn } from '@/lib/db-service';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const supplierId = searchParams.get('supplierId') || undefined;
    const data = await getPurchaseReturnsList(supplierId);
    return NextResponse.json(data);
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || 'Failed to fetch purchase returns' },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    if (!body.supplierId) {
      return NextResponse.json({ error: 'Supplier ID is required' }, { status: 400 });
    }
    if (!body.items || !Array.isArray(body.items) || body.items.length === 0) {
      return NextResponse.json({ error: 'At least one return item line is required' }, { status: 400 });
    }

    const result = await processPurchaseReturn({
      supplierId: body.supplierId,
      originalInvoiceNo: body.originalInvoiceNo,
      reason: body.reason || 'Distributor Expiry Return',
      items: body.items,
    });

    return NextResponse.json(result);
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || 'Failed to process purchase return' },
      { status: 400 }
    );
  }
}
