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
  segmentBase?: {
    range: string;
    indexRange: string;
  };
}

interface AudioStream {
  qualityId: number;
  bandwidth: number;
  mimeType: string;
  baseUrl: string;
  backupUrl: string | null;
  codec: string;
  size: number;
  isDash: boolean;
  segmentBase?: {
    range: string;
    indexRange: string;
  };
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
      duration: number | string;
    }>;
  };
  error?: string;
  message?: string;
}

// ====================================================================
// Mobile Android headers (matches bilibili.tv's own dash player)
// ====================================================================

const MOBILE_HEADERS: Record<string, string> = {
  'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
  'accept-language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
  'cache-control': 'no-cache',
  'pragma': 'no-cache',
  'sec-ch-ua': '"Chromium";v="139", "Not;A=Brand";v="99"',
  'sec-ch-ua-mobile': '?1',
  'sec-ch-ua-platform': '"Android"',
  'sec-fetch-dest': 'document',
  'sec-fetch-mode': 'navigate',
  'sec-fetch-site': 'none',
  'sec-fetch-user': '?1',
  'upgrade-insecure-requests': '1',
  'User-Agent': 'Mozilla/5.0 (Linux; Android 13; SM-G998B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Mobile Safari/537.36',
};

const MOBILE_API_HEADERS: Record<string, string> = {
  'accept': 'application/json, text/plain, */*',
  'accept-language': 'id-ID,id;q=0.9,en-US;q=0.8',
  'sec-ch-ua': '"Chromium";v="139", "Not;A=Brand";v="99"',
  'sec-ch-ua-mobile': '?1',
  'sec-ch-ua-platform': '"Android"',
  'sec-fetch-dest': 'empty',
  'sec-fetch-mode': 'cors',
  'sec-fetch-site': 'same-site',
  'User-Agent': 'Mozilla/5.0 (Linux; Android 13; SM-G998B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Mobile Safari/537.36',
};

// ====================================================================
// IIFE-aware full expression extraction
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
// Playinfo extraction from embedded page data
// ====================================================================

interface PlayinfoData {
  duration: number;
  videos: VideoStream[];
  audios: AudioStream[];
}

/**
 * Extract __playinfo__ from the HTML page.
 * bilibili.tv embeds playinfo as base64-encoded JSON in a <script> tag.
 * Supports both standard base64 and URL-safe base64.
 */
function extractPlayinfoFromHtml(html: string): PlayinfoData | null {
  try {
    const $ = cheerio.load(html);
    let playinfoBase64: string = '';

    $('script').each((_i, el) => {
      const content = $(el).html() || '';
      
      // Pattern 1: window.__playinfo__="base64string" (quoted)
      const match1 = content.match(/window\.__playinfo__\s*=\s*['"]([A-Za-z0-9+\-_/=]+)['"]/);
      if (match1) { playinfoBase64 = match1[1]; return false; }
      
      // Pattern 2: window.__playinfo__=base64string (unquoted, standard + URL-safe)
      const match2 = content.match(/window\.__playinfo__\s*=\s*([A-Za-z0-9+\-_/=]{20,})/);
      if (match2) { playinfoBase64 = match2[1]; return false; }
      
      // Pattern 3: __playinfo__="base64string" (no window prefix)
      const match3 = content.match(/__playinfo__\s*=\s*['"]([A-Za-z0-9+\-_/=]+)['"]/);
      if (match3) { playinfoBase64 = match3[1]; return false; }
    });

    if (!playinfoBase64) return null;

    // Decode base64 - handle both standard and URL-safe
    let decoded: string;
    try {
      // Normalize URL-safe base64 to standard
      const normalized = (playinfoBase64 as string).replace(/-/g, '+').replace(/_/g, '/');
      // Add padding if needed
      const padded = normalized.padEnd(normalized.length + (4 - normalized.length % 4) % 4, '=');
      decoded = Buffer.from(padded, 'base64').toString('utf-8');
    } catch {
      return null;
    }

    const json = JSON.parse(decoded) as Record<string, unknown>;
    const data = (json.data || json) as Record<string, unknown>;
    return parsePlayinfoResponse(data);
  } catch {
    return null;
  }
}

/**
 * Extract playinfo from __NEXT_DATA__ (Next.js SSG data)
 */
function extractPlayinfoFromNextData(html: string): PlayinfoData | null {
  try {
    const $ = cheerio.load(html);
    let nextData: Record<string, unknown> | null = null;

    $('script#__NEXT_DATA__').each((_i, el) => {
      const content = $(el).html() || '';
      try {
        const parsed = JSON.parse(content);
        if (parsed && typeof parsed === 'object') {
          nextData = parsed as Record<string, unknown>;
        }
      } catch { /* ignore */ }
      return false;
    });

    const pageProps = nextData
      ? (((nextData as Record<string, unknown>)['props'] as Record<string, unknown> | null)?.['pageProps'] as Record<string, unknown> | null)
      : null;
    if (!pageProps) return null;
    
    // Try multiple possible paths for playInfo in __NEXT_DATA__
    const paths = [
      'playInfo', 'playinfo', 'play_info', 'playUrl', 'playurl',
      'videoData.playInfo', 'videoData.playinfo', 'videoData.playUrl',
    ];
    
    for (const path of paths) {
      const keys = path.split('.');
      let current: unknown = pageProps;
      for (const key of keys) {
        if (current && typeof current === 'object') {
          current = (current as Record<string, unknown>)[key];
        } else {
          current = undefined;
          break;
        }
      }
      if (current && typeof current === 'object') {
        const result = parsePlayinfoResponse(current as Record<string, unknown>);
        if (result && (result.videos.length > 0 || result.audios.length > 0)) return result;
      }
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Extract playinfo from __initialState (already parsed)
 * Tries many possible nested paths where playurl might be stored.
 */
function extractPlayinfoFromInitialState(initialState: Record<string, unknown>): PlayinfoData | null {
  try {
    // Try various nested paths in __initialState
    const paths = [
      'playerData.playUrl',
      'player.playUrl',
      'playInfo',
      'playUrl',
      'ugc.playUrl',
      'ugc.playerData.playUrl',
      'videoDetail.playUrl',
      'videoDetail.playInfo',
      'videoInfo.playUrl',
    ];

    for (const path of paths) {
      const keys = path.split('.');
      let current: unknown = initialState;
      for (const key of keys) {
        if (current && typeof current === 'object') {
          current = (current as Record<string, unknown>)[key];
        } else {
          current = undefined;
          break;
        }
      }
      if (current && typeof current === 'object') {
        const result = parsePlayinfoResponse(current as Record<string, unknown>);
        if (result && (result.videos.length > 0 || result.audios.length > 0)) return result;
      }
    }

    // Deep search: look for any object that has 'video' array with 'video_resource'
    function deepSearch(obj: unknown, depth = 0): PlayinfoData | null {
      if (depth > 5 || !obj || typeof obj !== 'object') return null;
      const record = obj as Record<string, unknown>;
      
      if (record.video && Array.isArray(record.video)) {
        const firstVideo = record.video[0] as Record<string, unknown> | undefined;
        if (firstVideo?.video_resource || firstVideo?.url) {
          const result = parsePlayinfoResponse(record);
          if (result && (result.videos.length > 0 || result.audios.length > 0)) return result;
        }
      }
      
      for (const value of Object.values(record)) {
        const found = deepSearch(value, depth + 1);
        if (found) return found;
      }
      return null;
    }

    return deepSearch(initialState);
  } catch {
    return null;
  }
}

/**
 * Resolve a URL from baseUrl or backupUrl (which can be string or string[])
 */
function resolveStreamUrl(vr: Record<string, unknown>): string {
  const url = (vr.url as string) || '';
  if (url) return url;
  
  const backup = vr.backup_url;
  if (!backup) return '';
  
  // backup_url can be a string or an array of strings
  if (typeof backup === 'string' && backup) return backup;
  if (Array.isArray(backup) && backup.length > 0) return backup[0] as string;
  
  return '';
}

/**
 * Parse playinfo response data into our standard format.
 * Filters out streams with no valid URL.
 */
function parsePlayinfoResponse(data: Record<string, unknown>): PlayinfoData | null {
  try {
    const playurl = (data.playurl || data) as Record<string, unknown>;
    const videoList = (playurl.video || []) as Array<Record<string, unknown>>;
    const audioList = (playurl.audio_resource || playurl.audio || []) as Array<Record<string, unknown>>;
    const durationMs = (playurl.duration as number) || 0;

    const videos: VideoStream[] = [];
    for (const v of videoList) {
      const vr = (v.video_resource || v) as Record<string, unknown>;
      const si = (v.stream_info || {}) as Record<string, unknown>;
      const url = resolveStreamUrl(vr);
      if (!url) continue; // Skip streams with no URL at all
      
      const segBase = vr.segment_base as Record<string, unknown> | undefined;
      videos.push({
        qualityId: (vr.quality as number) || 0,
        qualityLabel: (si.desc_words as string) || getQualityLabel(vr.quality as number),
        codec: (vr.codecs as string) || '',
        mimeType: (vr.mime_type as string) || '',
        bandwidth: (vr.bandwidth as number) || 0,
        baseUrl: url,
        backupUrl: null,
        width: (vr.width as number) || 0,
        height: (vr.height as number) || 0,
        frameRate: (vr.frame_rate as string) || '',
        size: (vr.size as number) || 0,
        isDash: !!segBase,
        segmentBase: segBase ? {
          range: (segBase.range as string) || '0-991',
          indexRange: (segBase.index_range as string) || '992-1239',
        } : undefined,
      });
    }

    const audios: AudioStream[] = [];
    for (const a of audioList) {
      const url = resolveStreamUrl(a);
      if (!url) continue; // Skip audios with no URL
      
      const segBase = a.segment_base as Record<string, unknown> | undefined;
      audios.push({
        qualityId: (a.quality as number) || 0,
        bandwidth: (a.bandwidth as number) || 0,
        mimeType: (a.mime_type as string) || '',
        baseUrl: url,
        backupUrl: null,
        codec: (a.codecs as string) || '',
        size: (a.size as number) || 0,
        isDash: !!segBase,
        segmentBase: segBase ? {
          range: (segBase.range as string) || '0-991',
          indexRange: (segBase.index_range as string) || '992-1239',
        } : undefined,
      });
    }

    return {
      duration: Math.round(durationMs / 1000),
      videos,
      audios
    };
  } catch {
    return null;
  }
}

// ====================================================================
// Generate buvid3/buvid4 device fingerprint cookies
// ====================================================================

function generateBuvid3(): string {
  const hex = '0123456789abcdef';
  const parts: string[] = [];
  for (let i = 0; i < 32; i++) {
    parts.push(hex[Math.floor(Math.random() * 16)]);
  }
  const uuid = [
    parts.slice(0, 8).join(''),
    parts.slice(8, 12).join(''),
    parts.slice(12, 16).join(''),
    parts.slice(16, 20).join(''),
    parts.slice(20, 32).join('')
  ].join('-');
  return `${uuid}infoc`;
}

function generateBuvid4(): string {
  const hex = '0123456789ABCDEF';
  const parts: string[] = [];
  for (let i = 0; i < 32; i++) {
    parts.push(hex[Math.floor(Math.random() * 16)]);
  }
  const uuid = [
    parts.slice(0, 8).join(''),
    parts.slice(8, 12).join(''),
    parts.slice(12, 16).join(''),
    parts.slice(16, 20).join(''),
    parts.slice(20, 32).join('')
  ].join('-');
  const randomPad = Math.floor(Math.random() * 100000) + 100000;
  const randomHex = Array.from({ length: 8 }, () => hex[Math.floor(Math.random() * 16)]).join('');
  return `${uuid}48261-${randomPad}-x${randomHex}`;
}

// ====================================================================
// Fetch streaming URLs via bilibili.tv PlayURL API (with cookies)
// ====================================================================

async function fetchPlayUrlApi(aid: string, pageCookies: string, videoPageUrl: string, locale: string = 'id'): Promise<PlayinfoData | null> {
  try {
    const buvid3 = generateBuvid3();
    const buvid4 = generateBuvid4();

    const api = new URL('https://api.bilibili.tv/intl/gateway/web/playurl');
    api.searchParams.set('s_locale', locale);
    api.searchParams.set('platform', 'web');
    api.searchParams.set('aid', aid);

    // Build cookie string: page cookies + generated buvid
    const cookieParts = pageCookies.split(';').map(c => c.trim()).filter(Boolean);
    cookieParts.push(`buvid3=${buvid3}`);
    cookieParts.push(`buvid4=${buvid4}`);
    cookieParts.push('bstar-web-lang=id');
    const cookieStr = cookieParts.join('; ');

    const resp = await fetch(api.toString(), {
      method: 'GET',
      headers: {
        ...MOBILE_API_HEADERS,
        'Referer': videoPageUrl,
        'Origin': 'https://www.bilibili.tv',
        'Cookie': cookieStr,
      }
    });

    if (!resp.ok) return null;

    const json = (await resp.json()) as Record<string, unknown>;
    if (!json.data || typeof json.data !== 'object') return null;

    const data = json.data as Record<string, unknown>;
    return parsePlayinfoResponse(data);
  } catch {
    return null;
  }
}

// ====================================================================
// Main detail function - multi-strategy streaming extraction
// ====================================================================

async function detail(url: string): Promise<BstationResult> {
  try {
    // Step 1: Fetch HTML page with mobile Android headers
    const buvid3 = generateBuvid3();
    const buvid4 = generateBuvid4();

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        ...MOBILE_HEADERS,
        'cookie': `buvid3=${buvid3}; buvid4=${buvid4}; bstar-web-lang=id`,
      }
    });
    if (!response.ok) throw new Error(`HTTP Error ${response.status}`);

    const html = await response.text();
    const parsed = parse(html);

    // Step 2: Extract streaming data using multi-strategy
    if (parsed.success && parsed.data.videoInfo?.aid) {
      const aid = String(parsed.data.videoInfo.aid);
      let playinfoData: PlayinfoData | null = null;

      // Collect cookies from page response for API fallback
      const setCookies = response.headers.getSetCookie ? response.headers.getSetCookie() : [];
      const pageCookieStr = setCookies
        .map(c => c.split(';')[0])
        .concat([`buvid3=${buvid3}`, `buvid4=${buvid4}`, 'bstar-web-lang=id'])
        .join('; ');

      // Strategy 1: Extract __playinfo__ from HTML (most reliable)
      playinfoData = extractPlayinfoFromHtml(html);

      // Strategy 2: Extract from __NEXT_DATA__
      if (!playinfoData || (playinfoData.videos.length === 0 && playinfoData.audios.length === 0)) {
        playinfoData = extractPlayinfoFromNextData(html);
      }

      // Strategy 3: Extract from __initialState (already parsed)
      if (!playinfoData || (playinfoData.videos.length === 0 && playinfoData.audios.length === 0)) {
        const $ = cheerio.load(html);
        $('script').each((_i, el) => {
          const content = $(el).html() || '';
          if (content.includes('__initialState')) {
            const patterns = ['window.__initialState', '__initialState', 'self.__INITIAL_STATE__'];
            for (const pattern of patterns) {
              const extracted = extractIifeObject(content, pattern);
              if (extracted) {
                playinfoData = extractPlayinfoFromInitialState(extracted as Record<string, unknown>);
                if (playinfoData && (playinfoData.videos.length > 0 || playinfoData.audios.length > 0)) {
                  return false;
                }
              }
            }
          }
        });
      }

      // Strategy 4: PlayURL API with page cookies (last resort)
      if (!playinfoData || (playinfoData.videos.length === 0 && playinfoData.audios.length === 0)) {
        playinfoData = await fetchPlayUrlApi(aid, pageCookieStr, url);
      }

      if (playinfoData && (playinfoData.videos.length > 0 || playinfoData.audios.length > 0)) {
        parsed.data.streaming = {
          duration: playinfoData.duration,
          videos: playinfoData.videos,
          audios: playinfoData.audios
        };
      } else {
        parsed.data.streaming = {
          duration: 0,
          videos: [],
          audios: [],
          note: 'Tidak ada streaming URL yang tersedia. Video mungkin dibatasi wilayah atau memerlukan login.'
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

// ====================================================================
// Parse HTML for video metadata
// ====================================================================

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

    // Extract __initialState from script tags
    const initialState = (() => {
      let result: Record<string, unknown> | null = null;
      $('script').each((_i, el) => {
        const content = $(el).html() || '';
        if (content.includes('__initialState')) {
          const patterns = ['window.__initialState', '__initialState', 'self.__INITIAL_STATE__'];
          for (const pattern of patterns) {
            const extracted = extractIifeObject(content, pattern);
            if (extracted) {
              result = extracted as Record<string, unknown>;
              return false;
            }
          }
        }
      });
      return result;
    })();

    const detailedData: BstationResult['data'] = {};

    if (initialState) {
      const state = initialState as Record<string, unknown>;
      const ugc = (state['ugc'] || {}) as Record<string, unknown>;
      const archive = (ugc['archive'] || {}) as Record<string, unknown>;
      const archiveStat = (archive['stat'] || {}) as Record<string, unknown>;
      const uploader = archive['uploader'] as Record<string, unknown> | undefined;
      const playRecommend = (state['playRecommend'] || {}) as Record<string, unknown>;
      const recommends = (playRecommend['recommends'] || []) as Array<Record<string, unknown>>;
      const rights = archive['rights'] as Record<string, unknown> | undefined;

      const rawAid = (ugc['aid'] as string) || (archive['aid'] as string) || '0';

      detailedData.videoInfo = {
        aid: parseInt(rawAid, 10) || 0,
        title: ((archive['title'] as string) || basicMeta.title) || '',
        cover: ((archive['cover'] as string) || basicMeta.ogImage) || '',
        desc: ((archive['desc'] as string) || basicMeta.description) || '',
        duration: (archive['duration'] as number) || 0,
        pubDate: (archive['pub_date'] as string) || '',
        formattedPubDate: (archive['formatted_pub_date'] as string) || '',
        ...(rights ? { rights } : {})
      };

      if (uploader) {
        detailedData.uploader = {
          mid: parseInt(String(uploader['mid']), 10) || 0,
          name: (uploader['name'] as string) || '',
          avatar: (uploader['avatar'] as string) || '',
          follower: (archiveStat['followers'] as string) || (archiveStat['fans'] as string) || '0'
        };
      }

      detailedData.stats = {
        views: (archiveStat['views'] as string) || '0',
        likes: (archiveStat['like_count'] as string) || '0',
        likeState: (archiveStat['like_state'] as number) || 0,
        arcs: (archiveStat['arcs'] as string) || ''
      };

      // Streaming will be filled by multi-strategy in detail()
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

// ====================================================================
// Shared playinfo fetcher for manifest route (multi-strategy)
// ====================================================================

export async function fetchPlayInfo(aid: string): Promise<PlayinfoData | null> {
  // First try to fetch the page and extract playinfo from HTML
  try {
    const pageUrl = `https://www.bilibili.tv/video/${aid}`;
    const buvid3 = generateBuvid3();
    const buvid4 = generateBuvid4();

    const resp = await fetch(pageUrl, {
      method: 'GET',
      headers: {
        ...MOBILE_HEADERS,
        'cookie': `buvid3=${buvid3}; buvid4=${buvid4}; bstar-web-lang=id`,
      }
    });

    if (resp.ok) {
      const html = await resp.text();
      const setCookies = resp.headers.getSetCookie ? resp.headers.getSetCookie() : [];
      const pageCookieStr = setCookies
        .map(c => c.split(';')[0])
        .concat([`buvid3=${buvid3}`, `buvid4=${buvid4}`, 'bstar-web-lang=id'])
        .join('; ');

      // Strategy 1: __playinfo__
      let data = extractPlayinfoFromHtml(html);
      if (data && (data.videos.length > 0 || data.audios.length > 0)) return data;

      // Strategy 2: __NEXT_DATA__
      data = extractPlayinfoFromNextData(html);
      if (data && (data.videos.length > 0 || data.audios.length > 0)) return data;

      // Strategy 3: __initialState
      const $ = cheerio.load(html);
      $('script').each((_i, el) => {
        const content = $(el).html() || '';
        if (content.includes('__initialState')) {
          const patterns = ['window.__initialState', '__initialState', 'self.__INITIAL_STATE__'];
          for (const pattern of patterns) {
            const extracted = extractIifeObject(content, pattern);
            if (extracted) {
              data = extractPlayinfoFromInitialState(extracted as Record<string, unknown>);
              if (data && (data.videos.length > 0 || data.audios.length > 0)) return false;
            }
          }
        }
      });
      if (data && (data.videos.length > 0 || data.audios.length > 0)) return data;

      // Strategy 4: API with cookies
      data = await fetchPlayUrlApi(aid, pageCookieStr, pageUrl);
      if (data && (data.videos.length > 0 || data.audios.length > 0)) return data;
    }
  } catch {
    // Fall through to direct API
  }

  // Last resort: direct API call with mobile headers
  return fetchPlayUrlApi(aid, '', `https://www.bilibili.tv/video/${aid}`);
}

export { detail, parse, getQualityLabel, MOBILE_HEADERS, MOBILE_API_HEADERS };
export type { BstationResult, VideoStream, AudioStream, PlayinfoData };
