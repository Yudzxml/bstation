import { NextRequest, NextResponse } from 'next/server';
import { detail } from '@/lib/bstation';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const url = searchParams.get('url');

  if (!url) {
    return NextResponse.json(
      {
        success: false,
        error: 'Parameter "url" wajib diisi. Contoh: /api/bstation?url=https://www.bilibili.tv/id/video/2002158664'
      },
      { status: 400 }
    );
  }

  // Validasi URL
  try {
    new URL(url);
  } catch {
    return NextResponse.json(
      { success: false, error: 'URL tidak valid.' },
      { status: 400 }
    );
  }

  const result = await detail(url);

  if (!result.success) {
    return NextResponse.json(result, { status: 422 });
  }

  return NextResponse.json(result);
}