import { NextResponse } from 'next/server';
import { getImportJobs, commitImportJob, undoImportJob } from '@/lib/db-service';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const data = await getImportJobs();
    return NextResponse.json(data);
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Failed to fetch import jobs' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    if (body.action === 'undo') {
      const result = await undoImportJob(body.jobId);
      return NextResponse.json(result);
    } else {
      const result = await commitImportJob({
        filename: body.filename,
        type: body.type || 'Opening Stock',
        rows: body.rows || [],
      });
      return NextResponse.json(result);
    }
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Failed to process import job' }, { status: 400 });
  }
}
