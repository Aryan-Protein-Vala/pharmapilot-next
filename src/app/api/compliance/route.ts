import { NextResponse } from 'next/server';
import { getComplianceRegister } from '@/lib/db-service';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const schedule = searchParams.get('schedule') || undefined;
    const startDate = searchParams.get('startDate') || undefined;
    const endDate = searchParams.get('endDate') || undefined;
    const doctorName = searchParams.get('doctorName') || undefined;

    const data = await getComplianceRegister({ schedule, startDate, endDate, doctorName });
    return NextResponse.json(data);
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Failed to fetch compliance register' }, { status: 500 });
  }
}
