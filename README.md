# Bstation - Bilibili.tv Video Streamer

A web application to stream and watch bilibili.tv (Bstation) videos directly in your browser. Extracts video metadata, streaming URLs, and plays them using DASH adaptive streaming.

## Features

- **Video Streaming** - DASH-based adaptive streaming with multiple quality options
- **Quality Control** - Switch between available video qualities (240p to 1080p+)
- **Video Info** - Displays title, uploader, views, likes, and description
- **Recommendations** - Shows related video recommendations from bilibili.tv
- **Download Support** - Download video segments directly
- **Mobile Responsive** - Works on both desktop and mobile devices
- **Dark Theme** - Built-in dark mode

## Tech Stack

- **Framework**: Next.js 16 (App Router)
- **Language**: TypeScript
- **Styling**: Tailwind CSS 4 + shadcn/ui
- **Player**: dash.js (DASH streaming)
- **Parsing**: Cheerio (HTML scraping)
- **Animations**: Framer Motion

## How It Works

1. **Page Fetching** - Fetches the bilibili.tv video page with mobile Android headers to extract embedded streaming data
2. **Multi-Strategy Extraction** - Tries multiple methods to find streaming URLs:
   - `__playinfo__` base64-encoded JSON in script tags
   - `__NEXT_DATA__` SSG payload
   - `__initialState` IIFE-parsed object
   - PlayURL API as fallback
3. **DASH Manifest** - Generates a DASH MPD manifest with video and audio streams
4. **Proxy Streaming** - CDN segments are proxied through the server with the correct Referer and mobile headers that bilibili.tv's CDN requires
5. **Playback** - dash.js handles adaptive bitrate streaming in the browser

## Deployment

### Vercel (Recommended)

1. Fork this repository
2. Import to [Vercel](https://vercel.com)
3. Deploy — no environment variables needed

### Self-Hosted

```bash
# Install dependencies
bun install

# Run development server
bun run dev

# Build for production
bun run build
bun run start
```

## API Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /api/bstation?url=<video_url>` | Get video metadata + streaming info (JSON) |
| `GET /api/manifest?aid=<video_id>` | Get DASH manifest (XML) |
| `GET /api/proxy?url=<cdn_url>&referer=<video_url>` | Proxy CDN segments with correct headers |
| `GET /api/download?url=<cdn_url>&filename=<name>` | Download video segment |

## Usage

1. Paste a bilibili.tv video URL (e.g., `https://www.bilibili.tv/id/video/4791777468350976`)
2. Click search or press Enter
3. Video info and player will load automatically
4. Use the quality selector to change video quality

## Note

Some videos may be region-restricted or require login on bilibili.tv. This tool attempts to extract publicly available streaming data but cannot bypass all restrictions.

## License

MIT
