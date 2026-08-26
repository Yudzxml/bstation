import * as cheerio from 'cheerio';

interface VideoStream {
  qualityId: number;
  qualityLabel: string;
  codec: string;
  mimeType: string;
  bandwidth: number;
  baseUrl: string;
  backupUrl: string | null;
  width: number;
  height: number;
  frameRate: string;
  size: number;
  isDash: boolean;
}

interface AudioStream {
  qualityId: number;
  bandwidth: number;
  mimeType: string;
  baseUrl: string;
  backupUrl: string | null;
  codec: string;
  size: number;
}

interface BstationResult {
  author: string;
  success: boolean;
  source: string;
  timestamp: string;
  meta: {
    title: string;
    description: string;
    keywords: string;
    ogImage: string;
    canonicalUrl: string;
    videoId: string | null;
  };
  data: {
    videoInfo?: {
      aid: number;
      title: string;
      cover: string;
      desc: string;
      duration: number;
      pubDate: string;
      formattedPubDate: string;
      rights?: Record<string, unknown>;
    };
    uploader?: {
      mid: number;
      name: string;
      avatar: string;
      follower: string;
    };
    stats?: {
      views: string;
      likes: string;
      likeState: number;
      arcs: string;
    };
    streaming?: {
      duration: number;
      videos: VideoStream[];
      audios: AudioStream[];
      note?: string;
    };
    recommendations?: Array<{
      aid: number;
      title: string;
      cover: string;
      author: string;
      view: string;
      duration: number;
    }>;
  };
  error?: string;
  message?: string;
}

// ====================================================================
// FIX #1: IIFE-aware full expression extraction
// ====================================================================

function extractIifeObject(scriptContent: string, marker: string): object | null {
  const markerIdx = scriptContent.indexOf(marker);
  if (markerIdx === -1) return null;
  const eqIdx = scriptContent.indexOf('=', markerIdx);
  if (eqIdx === -1) return null;
  const afterEq = scriptContent.substring(eqIdx + 1).trimStart();
  if (afterEq[0] !== '(') return extractBalancedParenExpr(afterEq);
  const funcMatch = afterEq.match(/^\(function\s*\(/);
  if (!funcMatch) return extractBalancedParenExpr(afterEq);
  const endIdx = findBalancedParenEnd(afterEq, 0);
  if (endIdx === -1) return null;
  const iifeExpr = afterEq.substring(0, endIdx);
  try {
    return new Function(`return (${iifeExpr})`)();
  } catch {
    return extractAndResolveIife(afterEq);
  }
}

function findBalancedParenEnd(content: string, start: number): number {
  let depth = 0;
  let inString: string | null = null;
  let escape = false;
  for (let i = start; i < content.length; i++) {
    const ch = content[i];
    if (escape) { escape = false; continue; }
    if (ch === '\\' && inString) { escape = true; continue; }
    if (inString) { if (ch === inString) inString = null; continue; }
    if (ch === '"' || ch === "'" || ch === '`') { inString = ch; continue; }
    if (ch === '(') depth++;
    else if (ch === ')') { depth--; if (depth === 0) return i + 1; }
  }
  return -1;
}

function extractAndResolveIife(afterEq: string): object | null {
  const funcStart = afterEq.indexOf('function(');
  if (funcStart === -1) return null;
  const paramsOpen = afterEq.indexOf('(', funcStart);
  const paramsClose = afterEq.indexOf(')', paramsOpen);
  const paramNames = afterEq.substring(paramsOpen + 1, paramsClose).split(',').map(p => p.trim());
  const bodyOpen = afterEq.indexOf('{', paramsClose);
  if (bodyOpen === -1) return null;
  const bodyClose = findBalancedBraceEnd(afterEq, bodyOpen);
  if (bodyClose === -1) return null;
  const bodyContent = afterEq.substring(bodyOpen, bodyClose);
  const argsOpen = afterEq.indexOf('(', bodyClose);
  if (argsOpen === -1) return null;
  const argsClose = findBalancedParenEnd(afterEq, argsOpen);
  if (argsClose === -1) return null;
  const argsContent = afterEq.substring(argsOpen + 1, argsClose - 1);
  const argValues = splitIifeArgs(argsContent);
  const returnIdx = bodyContent.search(/return\s*\{/);
  if (returnIdx === -1) return null;
  const objStart = bodyContent.indexOf('{', returnIdx);
  const objEnd = findBalancedBraceEnd(bodyContent, objStart);
  if (objEnd === -1) return null;
  let objStr = bodyContent.substring(objStart, objEnd);
  for (let i = 0; i < paramNames.length && i < argValues.length; i++) {
    const regex = new RegExp(`\\b${paramNames[i]}\\b`, 'g');
    objStr = objStr.replace(regex, argValues[i]);
  }
  try { return new Function(`return (${objStr})`)(); } catch { return null; }
}

function splitIifeArgs(argsStr: string): string[] {
  const args: string[] = [];
  let current = '';
  let depth = 0;
  let inString: string | null = null;
  let escape = false;
  for (const ch of argsStr) {
    if (escape) { current += ch; escape = false; continue; }
    if (ch === '\\' && inString) { current += ch; escape = true; continue; }
    if (inString) { current += ch; if (ch === inString) inString = null; continue; }
    if (ch === '"' || ch === "'" || ch === '`') { inString = ch; current += ch; continue; }
    if (ch === '(' || ch === '[' || ch === '{') { depth++; current += ch; continue; }
    if (ch === ')' || ch === ']' || ch === '}') { depth--; current += ch; continue; }
    if (ch === ',' && depth === 0) { args.push(current.trim()); current = ''; continue; }
    current += ch;
  }
  if (current.trim()) args.push(current.trim());
  return args;
}

function findBalancedBraceEnd(content: string, braceStart: number): number {
  let depth = 0;
  let inString: string | null = null;
  let escape = false;
  for (let i = braceStart; i < content.length; i++) {
    const ch = content[i];
    if (escape) { escape = false; continue; }
    if (ch === '\\' && inString) { escape = true; continue; }
    if (inString) { if (ch === inString) inString = null; continue; }
    if (ch === '"' || ch === "'" || ch === '`') { inString = ch; continue; }
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) return i + 1; }
  }
  return -1;
}

function extractBalancedParenExpr(content: string): object | null {
  const braceStart = content.indexOf('{');
  if (braceStart === -1) return null;
  const braceEnd = findBalancedBraceEnd(content, braceStart);
  if (braceEnd === -1) return null;
  try { return new Function(`return (${content.substring(braceStart, braceEnd)})`)(); } catch { return null; }
}

// ==================== FIX #2: Class name fix ====================

function getQualityLabel(id: number): string {
  const map: Record<number, string> = {
    112: '1080P+ (HD)',
    80: '1080P (HD)',
    64: '720P (HD)',
    32: '480P',
    16: '360P',
    15: '240P',
    6: '240P'
  };
  return map[id] || `${id}P (Unknown)`;
}

// ====================================================================
// FIX #4: Fetch streaming URLs via bilibili.tv PlayURL API
// ====================================================================
// Endpoint: GET https://api.bilibili.tv/intl/gateway/web/playurl
// Params: s_locale, platform, aid
// Response: data.playurl.video[].video_resource & data.playurl.audio_resource[]
// Thanks to PHP reference code from user

async function fetchPlayUrl(aid: string, locale: string = 'id'): Promise<{
  duration: number;
  videos: VideoStream[];
  audios: AudioStream[];
} | null> {
  try {
    const api = new URL('https://api.bilibili.tv/intl/gateway/web/playurl');
    api.searchParams.set('s_locale', locale);
    api.searchParams.set('platform', 'web');
    api.searchParams.set('aid', aid);

    const resp = await fetch(api.toString(), {
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/113.0.5672.92 Safari/537.36',
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': `${locale},en-US;q=0.9,en;q=0.8`,
        'Referer': 'https://www.bilibili.tv/',
        'Origin': 'https://www.bilibili.tv',
        'Sec-Fetch-Dest': 'empty',
        'Sec-Fetch-Mode': 'cors',
        'Sec-Fetch-Site': 'same-site'
      }
    });

    if (!resp.ok) return null;

    const json = (await resp.json()) as Record<string, unknown>;
    if (!json.data || typeof json.data !== 'object') return null;

    const data = json.data as Record<string, unknown>;
    const playurl = (data.playurl || {}) as Record<string, unknown>;

    const videoList = (playurl.video || []) as Array<Record<string, unknown>>;
    const audioList = (playurl.audio_resource || []) as Array<Record<string, unknown>>;

    const videos: VideoStream[] = videoList.map(v => {
      const vr = (v.video_resource || {}) as Record<string, unknown>;
      const si = (v.stream_info || {}) as Record<string, unknown>;
      const url = (vr.url as string) || '';
      return {
        qualityId: (vr.quality as number) || 0,
        qualityLabel: (si.desc_words as string) || getQualityLabel(vr.quality as number),
        codec: (vr.codecs as string) || '',
        mimeType: (vr.mime_type as string) || '',
        bandwidth: (vr.bandwidth as number) || 0,
        baseUrl: url,
        backupUrl: (vr.backup_url as string) || null,
        width: (vr.width as number) || 0,
        height: (vr.height as number) || 0,
        frameRate: (vr.frame_rate as string) || '',
        size: (vr.size as number) || 0,
        isDash: !url && !!(vr.segment_base)
      };
    });

    const audios: AudioStream[] = audioList.map(a => ({
      qualityId: (a.quality as number) || 0,
      bandwidth: (a.bandwidth as number) || 0,
      mimeType: (a.mime_type as string) || '',
      baseUrl: (a.url as string) || '',
      backupUrl: (a.backup_url as string) || null,
      codec: (a.codecs as string) || '',
      size: (a.size as number) || 0
    }));

    return {
      duration: (playurl.duration as number) || 0,
      videos,
      audios
    };
  } catch {
    return null;
  }
}

// ==================== FIX #3: Stat path & type fix ====================

async function detail(url: string): Promise<BstationResult> {
  try {
    // Step 1: Fetch HTML and parse __initialState
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'accept-language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
        'cache-control': 'no-cache',
        pragma: 'no-cache',
        'sec-ch-ua': '"Chromium";v="139", "Not;A=Brand";v="99"',
        'sec-ch-ua-mobile': '?1',
        'sec-ch-ua-platform': '"Android"',
        'sec-fetch-dest': 'document',
        'sec-fetch-mode': 'navigate',
        'sec-fetch-site': 'same-origin',
        'sec-fetch-user': '?1',
        'upgrade-insecure-requests': '1',
        cookie: 'buvid3=43732f08-47c0-4e94-a2aa-37b5e1fc888963545infoc; buvid4=A79D9F34-506A-A589-C757-8D192192F95C48261-126010922-x3kuoMrzvXMWbClRBF%2FDPg%3D%3D; bstar-web-lang=id'
      }
    });
    if (!response.ok) throw new Error(`HTTP Error ${response.status}`);
    const html = await response.text();
    const parsed = parse(html);

    // Step 2: Fetch streaming URLs via PlayURL API
    if (parsed.success && parsed.data.videoInfo?.aid) {
      const playurlData = await fetchPlayUrl(String(parsed.data.videoInfo.aid));
      if (playurlData) {
        parsed.data.streaming = {
          duration: playurlData.duration,
          videos: playurlData.videos,
          audios: playurlData.audios
        };
      }
    }

    return parsed;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return {
      author: 'Yudzxml (Fixed)',
      success: false,
      source: 'Bstation/Bilibili Web Parser',
      timestamp: new Date().toISOString(),
      meta: { title: '', description: '', keywords: '', ogImage: '', canonicalUrl: '', videoId: null },
      data: {},
      error: msg,
      message: 'Terjadi kesalahan saat fetching URL.'
    };
  }
}

function parse(htmlContent: string): BstationResult {
  try {
    const $ = cheerio.load(htmlContent);

    const basicMeta = {
      title: $('title').text().trim(),
      description: $('meta[name="description"]').attr('content') || '',
      keywords: $('meta[name="keywords"]').attr('content') || '',
      ogImage: $('meta[property="og:image"]').attr('content') || '',
      canonicalUrl: $('link[rel="canonical"]').attr('href') || '',
      videoId: null as string | null
    };
    const idMatch = basicMeta.canonicalUrl.match(/\/video\/(\d+)/);
    if (idMatch) basicMeta.videoId = idMatch[1];

    let initialState: Record<string, unknown> | null = null;
    $('script').each((_i, el) => {
      const content = $(el).html() || '';
      if (content.includes('__initialState')) {
        const patterns = ['window.__initialState', '__initialState', 'self.__INITIAL_STATE__'];
        for (const pattern of patterns) {
          const extracted = extractIifeObject(content, pattern);
          if (extracted) {
            initialState = extracted as Record<string, unknown>;
            return false;
          }
        }
      }
    });

    const detailedData: BstationResult['data'] = {};

    if (initialState) {
      const ugc = (initialState.ugc || {}) as Record<string, unknown>;
      const archive = (ugc.archive || {}) as Record<string, unknown>;
      const archiveStat = (archive.stat || {}) as Record<string, unknown>;
      const uploader = archive.uploader as Record<string, unknown> | undefined;
      const playRecommend = (initialState.playRecommend || {}) as Record<string, unknown>;
      const recommends = (playRecommend.recommends || []) as Array<Record<string, unknown>>;
      const rights = archive.rights as Record<string, unknown> | undefined;

      const rawAid = (ugc.aid as string) || (archive.aid as string) || '0';

      detailedData.videoInfo = {
        aid: parseInt(rawAid, 10) || 0,
        title: ((archive.title as string) || basicMeta.title) || '',
        cover: ((archive.cover as string) || basicMeta.ogImage) || '',
        desc: ((archive.desc as string) || basicMeta.description) || '',
        duration: (archive.duration as number) || 0,
        pubDate: (archive.pub_date as string) || '',
        formattedPubDate: (archive.formatted_pub_date as string) || '',
        ...(rights ? { rights } : {})
      };

      if (uploader) {
        detailedData.uploader = {
          mid: parseInt(String(uploader.mid), 10) || 0,
          name: (uploader.name as string) || '',
          avatar: (uploader.avatar as string) || '',
          follower: (archiveStat.followers as string) || (archiveStat.fans as string) || '0'
        };
      }

      detailedData.stats = {
        views: (archiveStat.views as string) || '0',
        likes: (archiveStat.like_count as string) || '0',
        likeState: (archiveStat.like_state as number) || 0,
        arcs: (archiveStat.arcs as string) || ''
      };

      // Streaming akan di-fill oleh fetchPlayUrl() di detail()
      detailedData.streaming = {
        duration: 0,
        videos: [],
        audios: [],
        note: 'Memuat streaming URLs...'
      };

      detailedData.recommendations = recommends.map(item => ({
        aid: parseInt(String(item.aid), 10) || 0,
        title: (item.title as string) || '',
        cover: (item.cover as string) || '',
        author: ((item.author as Record<string, unknown>)?.name as string) || '',
        view: String(item.view || '0'),
        duration: (item.duration as number) || 0
      }));
    }

    return {
      author: 'Yudzxml (Fixed)',
      success: !!initialState,
      source: 'Bstation/Bilibili Web Parser',
      timestamp: new Date().toISOString(),
      meta: basicMeta,
      data: detailedData
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return {
      author: 'Yudzxml (Fixed)',
      success: false,
      source: 'Bstation/Bilibili Web Parser',
      timestamp: new Date().toISOString(),
      meta: { title: '', description: '', keywords: '', ogImage: '', canonicalUrl: '', videoId: null },
      data: {},
      error: msg,
      message: 'Terjadi kesalahan saat memparsing HTML.'
    };
  }
}

export { detail, parse, getQualityLabel };
export type { BstationResult, VideoStream, AudioStream };