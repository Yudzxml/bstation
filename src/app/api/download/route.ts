import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const targetUrl = searchParams.get('url');
  const filename = searchParams.get('filename') || 'video.m4s';
  const referer = searchParams.get('referer') || 'https://www.bilibili.tv/';

  if (!targetUrl) {
    return NextResponse.json({ error: 'Missing url parameter' }, { status: 400 });
  }

  try {
    new URL(targetUrl);
  } catch {
    return NextResponse.json({ error: 'Invalid URL' }, { status: 400 });
  }

  try {
    const response = await fetch(targetUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Linux; Android 13; SM-G998B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Mobile Safari/537.36',
        'Referer': referer,
        'Origin': 'https://www.bilibili.tv',
        'sec-ch-ua': '"Chromium";v="139", "Not;A=Brand";v="99"',
        'sec-ch-ua-mobile': '?1',
        'sec-ch-ua-platform': '"Android"',
        'Accept': '*/*',
      },
    });

    const responseHeaders = new Headers();
    responseHeaders.set('Content-Type', 'application/octet-stream');
    responseHeaders.set('Content-Disposition', `attachment; filename="${filename}"`);
    
    const cl = response.headers.get('content-length');
    if (cl) responseHeaders.set('Content-Length', cl);

    return new Response(response.body, {
      status: response.status,
      headers: responseHeaders,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Download error';
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
