import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const targetUrl = searchParams.get('url');
  const referer = searchParams.get('referer') || 'https://www.bilibili.tv/';

  if (!targetUrl) {
    return NextResponse.json({ error: 'Missing url parameter' }, { status: 400 });
  }

  // Validate URL
  try {
    new URL(targetUrl);
  } catch {
    return NextResponse.json({ error: 'Invalid URL' }, { status: 400 });
  }

  // Only allow bilibili CDN domains
  const allowedHosts = [
    'akamaized.net',
    'bilivideo.com',
    'bstarstatic.com',
    'bilibili.tv',
  ];
  const parsedUrl = new URL(targetUrl);
  if (!allowedHosts.some(h => parsedUrl.hostname.endsWith(h))) {
    return NextResponse.json({ error: 'Domain not allowed' }, { status: 403 });
  }

  try {
    // Use mobile Android headers matching bilibili.tv's own dash player
    const headers: Record<string, string> = {
      'User-Agent': 'Mozilla/5.0 (Linux; Android 13; SM-G998B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Mobile Safari/537.36',
      'Referer': referer,
      'Origin': 'https://www.bilibili.tv',
      'sec-ch-ua': '"Chromium";v="139", "Not;A=Brand";v="99"',
      'sec-ch-ua-mobile': '?1',
      'sec-ch-ua-platform': '"Android"',
      'Accept': '*/*',
    };

    // Forward Range header for video seeking
    const range = request.headers.get('range');
    if (range) {
      headers['Range'] = range;
    }

    const response = await fetch(targetUrl, { headers });

    const responseHeaders = new Headers();
    
    // Forward essential headers
    const ct = response.headers.get('content-type');
    if (ct) responseHeaders.set('Content-Type', ct);
    else responseHeaders.set('Content-Type', 'video/mp4');

    const cr = response.headers.get('content-range');
    if (cr) responseHeaders.set('Content-Range', cr);

    const cl = response.headers.get('content-length');
    if (cl) responseHeaders.set('Content-Length', cl);

    responseHeaders.set('Accept-Ranges', 'bytes');
    responseHeaders.set('Access-Control-Allow-Origin', '*');
    responseHeaders.set('Cache-Control', 'public, max-age=3600');

    return new Response(response.body, {
      status: response.status,
      headers: responseHeaders,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Proxy error';
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}

// Handle OPTIONS for CORS preflight
export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Range',
      'Access-Control-Expose-Headers': 'Content-Range, Content-Length',
    },
  });
}