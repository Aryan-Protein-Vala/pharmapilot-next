import { NextResponse } from 'next/server';
import { getDayClosingSummary, saveDayClosing } from '@/lib/db-service';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const date = searchParams.get('date') || undefined;
    const data = await getDayClosingSummary(date);
    return NextResponse.json(data);
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || 'Failed to fetch day closing summary' },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    if (!body.closingDate) {
      return NextResponse.json({ error: 'Closing date is required' }, { status: 400 });
    }
    if (typeof body.cashPhysicalPaise !== 'number' || body.cashPhysicalPaise < 0) {
      return NextResponse.json({ error: 'Valid physical cash amount in paise is required' }, { status: 400 });
    }

    const result = await saveDayClosing({
      closingDate: body.closingDate,
      cashPhysicalPaise: body.cashPhysicalPaise,
      notes: body.notes,
      closedBy: body.closedBy,
    });

    return NextResponse.json(result);
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || 'Failed to save day closing' },
      { status: 400 }
    );
  }
}
