import { NextResponse } from 'next/server';
import {
  processSalesReturn,
  getRecentSalesReturns,
  getSaleInvoiceForReturn,
} from '@/lib/db-service';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const invoiceNo = searchParams.get('invoiceNo');

    if (invoiceNo) {
      const invoiceData = await getSaleInvoiceForReturn(invoiceNo);
      if (!invoiceData) {
        return NextResponse.json(
          { error: `Invoice "${invoiceNo}" not found` },
          { status: 404 }
        );
      }
      return NextResponse.json(invoiceData);
    }

    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '20', 10)));
    const returns = await getRecentSalesReturns(limit);

    return NextResponse.json({ returns, count: returns.length });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || 'Failed to fetch sales returns' },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const payload = await request.json();
    const result = await processSalesReturn(payload);
    return NextResponse.json(result);
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || 'Failed to process sales return' },
      { status: 400 }
    );
  }
}
