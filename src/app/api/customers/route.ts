import { NextResponse } from 'next/server';
import { ensureDbReady, createCustomer } from '@/lib/db-service';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const db = await ensureDbReady();
    const { searchParams } = new URL(request.url);
    const q = (searchParams.get('q') || '').trim().toLowerCase();

    let sql = `SELECT id, name, phone, email, address, state_code, gstin, credit_limit_paise, opening_balance_paise, opening_balance_type, is_active FROM parties WHERE type IN ('customer', 'both') AND is_active = 1`;
    const args: any[] = [];

    if (q) {
      sql += ` AND (LOWER(name) LIKE ? OR phone LIKE ?)`;
      args.push(`%${q}%`, `%${q}%`);
    }

    sql += ` ORDER BY name ASC LIMIT 100`;

    const res = await db.execute({ sql, args });
    return NextResponse.json({ customers: res.rows });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || 'Failed to fetch customers' },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    if (!body.name || !body.name.trim()) {
      return NextResponse.json({ error: 'Customer name is required' }, { status: 400 });
    }

    const phone = body.phone ? body.phone.trim() : '';
    const creditLimitPaise = body.creditLimitPaise !== undefined
      ? Number(body.creditLimitPaise)
      : (body.creditLimitRupees ? Math.round(Number(body.creditLimitRupees) * 100) : 0);

    const result = await createCustomer({
      name: body.name.trim(),
      phone,
      address: body.address,
      stateCode: body.stateCode,
      gstin: body.gstin,
      creditLimitPaise,
      openingBalancePaise: body.openingBalancePaise,
      openingBalanceType: body.openingBalanceType,
      notes: body.notes,
    });

    const customer = {
      id: result.id,
      name: result.name,
      phone: result.phone,
      address: result.address,
      credit_limit_paise: result.creditLimitPaise,
      creditLimitPaise: result.creditLimitPaise,
    };

    return NextResponse.json({ success: true, customer, ...customer }, { status: 201 });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || 'Failed to create customer' },
      { status: 400 }
    );
  }
}
