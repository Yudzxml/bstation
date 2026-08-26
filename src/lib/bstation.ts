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
}

interface AudioStream {
  qualityId: number;
  bandwidth: number;
  mimeType: string;
  baseUrl: string;
  backupUrl: string | null;
  codec: string;
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
// Format bilibili.tv SEBENARNYA (minified IIFE):
//   window.__initialState=(function(a,b,c,...,t){return {global:{...},ugc:{...}}}(arg1,arg2,...,argN))
//
// Bug original: regex `return\s+(\{[\s\S]+?\})\s*}\(` gagal karena:
//   1. Non-greedy `+?` berhenti di `}` pertama (bukan closing brace yang benar)
//   2. Pola `}\(` tidak match format IIFE `(function(...){return {...}}(...))`
// Bug pertama fix: extract hanya object di dalam return → GAGAL karena
//   object menggunakan parameter minified (c, g, f) yang undefined di luar IIFE
//   → solusi: evaluasi SELURUH IIFE expression `(function(...){...}(...))`

function extractIifeObject(scriptContent: string, marker: string): object | null {
  const markerIdx = scriptContent.indexOf(marker);
  if (markerIdx === -1) return null;

  const eqIdx = scriptContent.indexOf('=', markerIdx);
  if (eqIdx === -1) return null;

  const afterEq = scriptContent.substring(eqIdx + 1).trimStart();

  if (afterEq[0] !== '(') {
    return extractBalancedParenExpr(afterEq);
  }

  const funcMatch = afterEq.match(/^\(function\s*\(/);
  if (!funcMatch) {
    return extractBalancedParenExpr(afterEq);
  }

  // Evaluasi seluruh IIFE
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
// Original: `BstationParser.getQualityLabel()` → class tidak ada!

function getQualityLabel(id: number): string {
  const map: Record<number, string> = {
    112: '1080P+ (HD)',
    80: '1080P (HD)',
    64: '720P (HD)',
    32: '480P',
    16: '360P',
    15: '240P'
  };
  return map[id] || `${id}P (Unknown)`;
}

// ==================== FIX #3: Stat path & type fix ====================
// Original: `ugc.stat` → sebenarnya data ada di `ugc.archive.stat`
// Original: values di-cast sebagai number → sebenarnya string ("4.3K Ditonton")

async function detail(url: string): Promise<BstationResult> {
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        accept:
          'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
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
        cookie:
          'buvid3=43732f08-47c0-4e94-a2aa-37b5e1fc888963545infoc; buvid4=A79D9F34-506A-A589-C757-8D192192F95C48261-126010922-x3kuoMrzvXMWbClRBF%2FDPg%3D%3D; bstar-web-lang=id; g_state={"i_l":0,"i_ll":1768135912002,"i_b":"Tv06Mk6YXj9siH2JdCMNeiDTZF3SRDPxa/VoX8k5JqI","i_e":{"enable_itp_optimization":0}}'
      }
    });
    if (!response.ok) throw new Error(`HTTP Error ${response.status}`);
    const html = await response.text();
    return parse(html);
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
      const player = (initialState.player || {}) as Record<string, unknown>;
      // FIX #3: playUrl bisa string kosong, bukan object
      const playUrl = typeof player.playUrl === 'object' && player.playUrl
        ? (player.playUrl as Record<string, unknown>)
        : null;
      const dash = playUrl ? (playUrl.dash || {}) as Record<string, unknown> : {};

      // FIX #3: Stats di archive.stat, bukan ugc.stat
      const archiveStat = (archive.stat || {}) as Record<string, unknown>;

      const videoStreams: VideoStream[] = ((dash.video as Array<Record<string, unknown>>) || []).map(v => ({
        qualityId: v.id as number,
        qualityLabel: getQualityLabel(v.id as number),
        codec: (v.codecs as string) || '',
        mimeType: (v.mime_type as string) || '',
        bandwidth: (v.bandwidth as number) || 0,
        baseUrl: (v.baseUrl as string) || '',
        backupUrl: v.backup_url
          ? ((v.backup_url as unknown[])[0] as string) || null
          : null,
        width: (v.width as number) || 0,
        height: (v.height as number) || 0,
        frameRate: (v.frame_rate as string) || ''
      }));

      const audioStreams: AudioStream[] = ((dash.audio as Array<Record<string, unknown>>) || []).map(a => ({
        qualityId: (a.id as number) || 0,
        bandwidth: (a.bandwidth as number) || 0,
        mimeType: (a.mime_type as string) || '',
        baseUrl: (a.baseUrl as string) || '',
        backupUrl: a.backup_url
          ? ((a.backup_url as unknown[])[0] as string) || null
          : null,
        codec: (a.codecs as string) || ''
      }));

      const uploader = archive.uploader as Record<string, unknown> | undefined;
      const playRecommend = (initialState.playRecommend || {}) as Record<string, unknown>;
      const recommends = (playRecommend.recommends || []) as Array<Record<string, unknown>>;
      const rights = archive.rights as Record<string, unknown> | undefined;

      // FIX #3: aid bisa string, konversi ke number
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
          // FIX #3: follower dari archive.stat, format string
          follower: (archiveStat.followers as string) || (archiveStat.fans as string) || '0'
        };
      }

      // FIX #3: Stats dari archive.stat dengan value asli (string)
      detailedData.stats = {
        views: (archiveStat.views as string) || '0',
        likes: (archiveStat.like_count as string) || '0',
        likeState: (archiveStat.like_state as number) || 0,
        arcs: (archiveStat.arcs as string) || ''
      };

      // Streaming URLs - hanya tersedia jika playUrl ada datanya
      if (playUrl && typeof playUrl === 'object' && Object.keys(playUrl).length > 0) {
        detailedData.streaming = {
          duration: (dash.duration as number) || 0,
          videos: videoStreams,
          audios: audioStreams
        };
      } else {
        detailedData.streaming = {
          duration: 0,
          videos: [],
          audios: [],
          note: 'Streaming URLs tidak tersedia via server-side scraping. Bilibili.tv hanya menyediakan playUrl melalui API client-side yang membutuhkan autentikasi.'
        };
      }

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
