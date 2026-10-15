import { NextResponse } from 'next/server';
import { searchPosItemsFTS } from '@/lib/db-service';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const query = searchParams.get('q') || '';
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '25', 10)));

    const results = await searchPosItemsFTS(query, limit);

    return NextResponse.json({
      results,
      count: results.length,
      query,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || 'Failed to search POS items' },
      { status: 500 }
    );
  }
}
