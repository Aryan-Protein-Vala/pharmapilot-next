import { NextResponse } from 'next/server';
import { getPurchasesCatalog, commitPurchaseInvoice } from '@/lib/db-service';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const data = await getPurchasesCatalog();
    return NextResponse.json(data);
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Failed to fetch purchases data' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const payload = await request.json();
    const result = await commitPurchaseInvoice(payload);
    return NextResponse.json(result);
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Failed to commit purchase invoice' }, { status: 400 });
  }
}
