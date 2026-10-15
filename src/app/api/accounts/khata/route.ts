import { NextResponse } from 'next/server';
import { getCustomerKhataLedger, recordCustomerPayment } from '@/lib/db-service';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const customerId = searchParams.get('customerId') || undefined;
    const data = await getCustomerKhataLedger(customerId);
    return NextResponse.json(data);
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || 'Failed to fetch khata ledger' },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    if (!body.customerId) {
      return NextResponse.json({ error: 'Customer ID is required' }, { status: 400 });
    }
    if (!body.amountPaise || body.amountPaise <= 0) {
      return NextResponse.json({ error: 'Valid payment amount in paise is required' }, { status: 400 });
    }
    if (!body.mode || !['cash', 'upi', 'bank'].includes(body.mode)) {
      return NextResponse.json({ error: 'Valid payment mode (cash, upi, bank) is required' }, { status: 400 });
    }

    const result = await recordCustomerPayment({
      customerId: body.customerId,
      amountPaise: body.amountPaise,
      mode: body.mode,
      reference: body.reference,
      notes: body.notes,
    });

    return NextResponse.json(result);
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || 'Failed to record customer payment' },
      { status: 400 }
    );
  }
}
