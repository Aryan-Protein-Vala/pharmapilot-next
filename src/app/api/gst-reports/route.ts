import { NextResponse } from 'next/server';
import { getGstReports } from '@/lib/db-service';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const data = await getGstReports();
    return NextResponse.json(data);
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Failed to fetch GST reports' }, { status: 500 });
  }
}
