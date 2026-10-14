// src/app/api/cron/refills/route.ts — Free Background Refill Cron & WhatsApp Alert Generator
import { NextRequest, NextResponse } from 'next/server';
import { scanChronicRefills } from '@/lib/refills';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * Validates request authorization via Bearer token, x-cron-secret header, or query secret
 */
function verifyCronAuth(req: NextRequest): boolean {
  const authHeader = req.headers.get('authorization');
  const cronSecretHeader = req.headers.get('x-cron-secret');
  const querySecret = req.nextUrl.searchParams.get('secret');
  const expectedSecret = process.env.CRON_SECRET || 'dev_secret';

  // 1. Authorization: Bearer <secret>
  if (authHeader && authHeader.trim() === `Bearer ${expectedSecret}`) {
    return true;
  }

  // 2. Custom header: x-cron-secret: <secret>
  if (cronSecretHeader && cronSecretHeader.trim() === expectedSecret) {
    return true;
  }

  // 3. Query string: ?secret=<secret>
  if (querySecret && querySecret.trim() === expectedSecret) {
    return true;
  }

  // 4. In development mode with default secret fallback
  if (process.env.NODE_ENV !== 'production' && !process.env.CRON_SECRET) {
    return true;
  }

  return false;
}

export async function GET(req: NextRequest) {
  if (!verifyCronAuth(req)) {
    return NextResponse.json(
      {
        success: false,
        error: 'Unauthorized',
        message: 'Missing or invalid CRON_SECRET. Provide "Authorization: Bearer <secret>" or "x-cron-secret".',
      },
      { status: 401 }
    );
  }

  try {
    const daysParam = req.nextUrl.searchParams.get('days');
    const daysThreshold = daysParam ? parseInt(daysParam, 10) : 3;
    const asOfParam = req.nextUrl.searchParams.get('as_of');

    const result = await scanChronicRefills({
      daysThreshold: Number.isNaN(daysThreshold) ? 3 : daysThreshold,
      asOfDate: asOfParam || undefined,
    });

    return NextResponse.json(result, {
      status: 200,
      headers: {
        'Cache-Control': 'no-store, max-age=0',
      },
    });
  } catch (err: any) {
    return NextResponse.json(
      {
        success: false,
        error: 'CronExecutionFailed',
        message: err?.message || 'Failed to scan chronic refills',
      },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  return GET(req);
}
