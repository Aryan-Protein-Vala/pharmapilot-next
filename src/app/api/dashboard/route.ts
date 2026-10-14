import { NextResponse } from 'next/server';
import { getDashboardMetrics } from '@/lib/db-service';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const data = await getDashboardMetrics();
    return NextResponse.json(data);
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Failed to fetch dashboard metrics' }, { status: 500 });
  }
}
