import { NextResponse } from 'next/server';
import { getAccountsData, createExpense } from '@/lib/db-service';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const partyId = searchParams.get('partyId') || undefined;
    const data = await getAccountsData(partyId);
    return NextResponse.json(data);
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Failed to fetch accounts data' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    if (body.type === 'expense') {
      const result = await createExpense(body);
      return NextResponse.json(result);
    }
    return NextResponse.json({ error: 'Unsupported action' }, { status: 400 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Failed to process account transaction' }, { status: 400 });
  }
}
