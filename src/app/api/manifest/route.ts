import { NextRequest, NextResponse } from 'next/server';
import { fetchPlayInfo } from '@/lib/bstation';

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const aid = searchParams.get('aid');

  if (!aid) {
    return NextResponse.json({ error: 'Missing aid parameter' }, { status: 400 });
  }

  const playinfo = await fetchPlayInfo(aid);
  if (!playinfo || (playinfo.videos.length === 0 && playinfo.audios.length === 0)) {
    return NextResponse.json({ error: 'Failed to fetch playurl', status: 'no_streams' }, { status: 502 });
  }

  const videos = playinfo.videos;
  const audios = playinfo.audios;
  const durationSec = playinfo.duration.toFixed(3);

  // Build proxy base URL
  const host = request.headers.get('host') 
    ? `http://${request.headers.get('host')}` 
    : 'http://localhost:3000';
  const videoPageUrl = `https://www.bilibili.tv/video/${aid}`;

  // Group videos by codec family (AVC vs HEVC)
  const avcVideos = videos.filter(v => v.codec.startsWith('avc'));
  const hevcVideos = videos.filter(v => v.codec.startsWith('hev'));

  // Use AVC as primary, fall back to HEVC if no AVC
  const primaryVideos = avcVideos.length > 0 ? avcVideos : hevcVideos;

  // Build video representations using PROXY URLs
  // Proxy adds correct Referer + mobile headers that CDN requires
  let videoReps = '';
  for (const v of primaryVideos) {
    if (!v.baseUrl) continue;

    const proxyUrl = `${host}/api/proxy?url=${encodeURIComponent(v.baseUrl)}&referer=${encodeURIComponent(videoPageUrl)}`;
    const frameRate = v.frameRate || '30';

    if (v.isDash && v.segmentBase) {
      videoReps += `
        <Representation id="v${v.qualityId}" bandwidth="${v.bandwidth}" width="${v.width}" height="${v.height}" codecs="${escapeXml(v.codec)}" frameRate="${frameRate}">
          <SegmentBase indexRange="${escapeXml(v.segmentBase.indexRange)}">
            <Initialization range="${escapeXml(v.segmentBase.range)}"/>
          </SegmentBase>
          <BaseURL>${escapeXml(proxyUrl)}</BaseURL>
        </Representation>`;
    } else {
      videoReps += `
        <Representation id="v${v.qualityId}" bandwidth="${v.bandwidth}" width="${v.width}" height="${v.height}" codecs="${escapeXml(v.codec)}">
          <BaseURL>${escapeXml(proxyUrl)}</BaseURL>
        </Representation>`;
    }
  }

  // Build audio representations
  let audioReps = '';
  const seenAudio = new Set<number>();
  for (const a of audios) {
    if (!a.baseUrl || seenAudio.has(a.qualityId)) continue;
    seenAudio.add(a.qualityId);

    const proxyUrl = `${host}/api/proxy?url=${encodeURIComponent(a.baseUrl)}&referer=${encodeURIComponent(videoPageUrl)}`;
    if (a.isDash && a.segmentBase) {
      audioReps += `
        <Representation id="a${a.qualityId}" bandwidth="${a.bandwidth}" codecs="${escapeXml(a.codec)}">
          <SegmentBase indexRange="${escapeXml(a.segmentBase.indexRange)}">
            <Initialization range="${escapeXml(a.segmentBase.range)}"/>
          </SegmentBase>
          <BaseURL>${escapeXml(proxyUrl)}</BaseURL>
        </Representation>`;
    } else {
      audioReps += `
        <Representation id="a${a.qualityId}" bandwidth="${a.bandwidth}" codecs="${escapeXml(a.codec)}">
          <BaseURL>${escapeXml(proxyUrl)}</BaseURL>
        </Representation>`;
    }
  }

  const mpd = `<?xml version="1.0" encoding="utf-8"?>
<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" minBufferTime="PT2S" profiles="urn:mpeg:dash:profile:isoff-on-demand:2011" type="static" mediaPresentationDuration="PT${durationSec}S">
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
      'Access-Control-Allow-Headers': 'Range',
      'Access-Control-Expose-Headers': 'Content-Range, Content-Length',
    },
  });
}