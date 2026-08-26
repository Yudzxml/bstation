import { NextRequest, NextResponse } from 'next/server';

interface PlayUrlVideoResource {
  id: string;
  quality: number;
  bandwidth: number;
  codecs: string;
  width: number;
  height: number;
  url: string;
  mime_type: string;
  frame_rate: string;
  duration: number;
  segment_base?: {
    range: string;
    index_range: string;
  };
}

interface PlayUrlAudioResource {
  id: string;
  quality: number;
  bandwidth: number;
  codecs: string;
  url: string;
  mime_type: string;
  duration: number;
}

interface StreamInfo {
  quality: number;
  desc_words: string;
}

async function fetchPlayUrl(aid: string) {
  const api = new URL('https://api.bilibili.tv/intl/gateway/web/playurl');
  api.searchParams.set('s_locale', 'id');
  api.searchParams.set('platform', 'web');
  api.searchParams.set('aid', aid);

  const resp = await fetch(api.toString(), {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Accept': 'application/json, text/plain, */*',
      'Referer': 'https://www.bilibili.tv/',
      'Origin': 'https://www.bilibili.tv',
      'Sec-Fetch-Dest': 'empty',
      'Sec-Fetch-Mode': 'cors',
      'Sec-Fetch-Site': 'same-site'
    }
  });

  if (!resp.ok) return null;
  const json = await resp.json();
  return json?.data?.playurl || null;
}

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const aid = searchParams.get('aid');

  if (!aid) {
    return NextResponse.json({ error: 'Missing aid parameter' }, { status: 400 });
  }

  const playurl = await fetchPlayUrl(aid);
  if (!playurl) {
    return NextResponse.json({ error: 'Failed to fetch playurl' }, { status: 502 });
  }

  const videoList: Array<{ video_resource: PlayUrlVideoResource; stream_info: StreamInfo }> = playurl.video || [];
  const audioList: PlayUrlAudioResource[] = playurl.audio_resource || [];
  const durationMs = playurl.duration || 0;
  const durationSec = (durationMs / 1000).toFixed(3);

  // Build proxy base URL
  const baseUrl = request.headers.get('host') 
    ? `http://${request.headers.get('host')}` 
    : 'http://localhost:3000';

  // Group videos by codec family (AVC vs HEVC)
  const avcVideos = videoList.filter(v => v.video_resource.codecs.startsWith('avc'));
  const hevcVideos = videoList.filter(v => v.video_resource.codecs.startsWith('hev'));

  // Use AVC as primary, fall back to HEVC if no AVC
  const primaryVideos = avcVideos.length > 0 ? avcVideos : hevcVideos;

  // Build video representations (only streams with direct URLs)
  let videoReps = '';
  for (const v of primaryVideos) {
    const vr = v.video_resource;
    if (!vr.url) continue; // Skip DASH-only (no auth URL)

    const proxyUrl = `${baseUrl}/api/proxy?url=${encodeURIComponent(vr.url)}`;
    const initRange = vr.segment_base?.range || '0-991';
    const idxRange = vr.segment_base?.index_range || '992-1239';
    const frameRate = vr.frame_rate ? vr.frame_rate.split('/')[0] : '30';

    videoReps += `
      <Representation id="v${vr.quality}" bandwidth="${vr.bandwidth}" width="${vr.width}" height="${vr.height}" codecs="${escapeXml(vr.codecs)}" frameRate="${frameRate}">
        <SegmentBase indexRange="${idxRange}">
          <Initialization range="${initRange}"/>
        </SegmentBase>
        <BaseURL>${escapeXml(proxyUrl)}</BaseURL>
      </Representation>`;
  }

  // Build audio representations
  let audioReps = '';
  // Deduplicate audio by quality
  const seenAudio = new Set<number>();
  for (const a of audioList) {
    if (!a.url || seenAudio.has(a.quality)) continue;
    seenAudio.add(a.quality);

    const proxyUrl = `${baseUrl}/api/proxy?url=${encodeURIComponent(a.url)}`;

    audioReps += `
      <Representation id="a${a.quality}" bandwidth="${a.bandwidth}" codecs="${escapeXml(a.codecs)}">
        <BaseURL>${escapeXml(proxyUrl)}</BaseURL>
      </Representation>`;
  }

  const mpd = `<?xml version="1.0" encoding="utf-8"?>
<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" minBufferTime="PT2S" profiles="urn:mpeg:dash:profile:isoff-main:2011,urn:mpeg:dash:profile:isoff-live:2011" type="static" mediaPresentationDuration="PT${durationSec}S">
  <Period>
    <AdaptationSet mimeType="video/mp4" contentType="video" startWithSAP="1">${videoReps}
    </AdaptationSet>
    <AdaptationSet mimeType="audio/mp4" contentType="audio" startWithSAP="1">${audioReps}
    </AdaptationSet>
  </Period>
</MPD>`;

  return new NextResponse(mpd, {
    status: 200,
    headers: {
      'Content-Type': 'application/dash+xml',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'public, max-age=300',
    },
  });
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
    },
  });
}