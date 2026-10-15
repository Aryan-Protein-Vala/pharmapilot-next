import { NextResponse } from 'next/server';
import { ensureDbReady, createDoctor } from '@/lib/db-service';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const db = await ensureDbReady();
    const res = await db.execute(`SELECT id, name, reg_no, phone, clinic FROM doctors WHERE is_active = 1 ORDER BY name ASC`);
    return NextResponse.json({ doctors: res.rows });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || 'Failed to fetch doctors' },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    if (!body.name || !body.name.trim()) {
      return NextResponse.json({ error: 'Doctor name is required' }, { status: 400 });
    }
    if (!body.regNo || !body.regNo.trim()) {
      return NextResponse.json({ error: 'Doctor Medical Council registration number is required' }, { status: 400 });
    }

    const result = await createDoctor({
      name: body.name,
      regNo: body.regNo,
      phone: body.phone,
      clinic: body.clinic,
    });

    return NextResponse.json(result, { status: 201 });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || 'Failed to register doctor' },
      { status: 400 }
    );
  }
}
