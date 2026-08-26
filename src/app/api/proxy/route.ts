import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const targetUrl = searchParams.get('url');

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
    'upos-bstar1-mirrorakam.akamaized.net',
    'upos-bstar1-mirrorakam.akamaized.net', 
    'upos-hz-mirrorakam.akamaized.net',
    'upos-sz-mirrorakam.akamaized.net',
    'cn-east-17-cu-v2.bilivideo.com',
    'upos-bstar-mirrorakam.akamaized.net'
  ];
  const parsedUrl = new URL(targetUrl);
  if (!allowedHosts.some(h => parsedUrl.hostname.endsWith(h) || parsedUrl.hostname === h)) {
    return NextResponse.json({ error: 'Domain not allowed' }, { status: 403 });
  }

  try {
    const headers: Record<string, string> = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/113.0.5672.92 Safari/537.36',
      'Referer': 'https://www.bilibili.tv/',
      'Origin': 'https://www.bilibili.tv',
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