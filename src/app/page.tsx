'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Search, Play, User, Eye, Download,
  ThumbsUp, Clock, Film, ChevronDown, Loader2,
  Tv, ArrowLeft, Share2, ListVideo, Volume2,
  Zap, Settings
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Tooltip, TooltipTrigger, TooltipContent,
} from '@/components/ui/tooltip';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
import { Separator } from '@/components/ui/separator';
import { useToast } from '@/hooks/use-toast';

type BstationResult = import('@/lib/bstation').BstationResult;

// ==================== Helpers ====================

function formatDuration(seconds: number): string {
  if (!seconds || seconds <= 0) return '0:00';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function formatViews(views: string): string {
  const num = parseInt(views.replace(/[^\d]/g, ''), 10);
  if (isNaN(num)) return views;
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M`;
  if (num >= 1_000) return `${(num / 1_000).toFixed(1)}K`;
  return String(num);
}

function formatDate(dateStr: string): string {
  if (!dateStr) return '';
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr.split('T')[0] || dateStr;
    return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  } catch {
    return dateStr.split('T')[0] || dateStr;
  }
}

// ==================== Page Component ====================

export default function Home() {
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [playerLoading, setPlayerLoading] = useState(false);
  const [result, setResult] = useState<BstationResult | null>(null);
  const [pageState, setPageState] = useState<'landing' | 'loading' | 'player'>('landing');
  const [qualityList, setQualityList] = useState<Array<{ index: number; label: string; bitrate: number; width: number; height: number }>>([]);
  const [selectedQuality, setSelectedQuality] = useState<string>('auto');
  const [descExpanded, setDescExpanded] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const playerRef = useRef<dashjs.MediaPlayerClass | null>(null);
  const { toast } = useToast();

  // ==================== Fetch Video ====================

  const loadVideo = useCallback(async (videoUrl: string) => {
    if (!videoUrl.trim()) return;
    setLoading(true);
    setPageState('loading');
    setResult(null);
    setQualityList([]);
    setSelectedQuality('auto');
    setDescExpanded(false);

    try {
      const res = await fetch(`/api/bstation?url=${encodeURIComponent(videoUrl.trim())}`);
      const data: BstationResult = await res.json();
      if (!data.success || !data.data?.videoInfo) {
        toast({
          title: 'Failed to load video',
          description: data.error || data.message || 'Could not parse the video. Please check the URL and try again.',
          variant: 'destructive',
        });
        setPageState('landing');
      } else {
        setResult(data);
        setPageState('player');
      }
    } catch (err) {
      toast({
        title: 'Network error',
        description: err instanceof Error ? err.message : 'An unexpected error occurred. Please try again.',
        variant: 'destructive',
      });
      setPageState('landing');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  const handleSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    loadVideo(url);
  }, [url, loadVideo]);

  const handleBack = useCallback(() => {
    // Destroy player
    if (playerRef.current) {
      playerRef.current.reset();
      playerRef.current = null;
    }
    setResult(null);
    setPageState('landing');
    setQualityList([]);
    setSelectedQuality('auto');
  }, []);

  const handleRecommendationClick = useCallback((aid: number) => {
    const newUrl = `https://www.bilibili.tv/video/${aid}`;
    setUrl(newUrl);
    loadVideo(newUrl);
  }, [loadVideo]);

  // ==================== DASH Player ====================
  // Use ref for toast to avoid re-triggering the player effect
  const toastRef = useRef(toast);
  toastRef.current = toast;

  useEffect(() => {
    if (pageState !== 'player' || !result?.data?.videoInfo?.aid || !videoRef.current) {
      return;
    }

    const aid = result.data.videoInfo.aid;
    const manifestUrl = `/api/manifest?aid=${aid}`;

    setPlayerLoading(true);
    let destroyed = false;
    let fallbackTimer: ReturnType<typeof setTimeout> | null = null;

    const timer = setTimeout(async () => {
      if (!videoRef.current || destroyed) return;
      if (playerRef.current) playerRef.current.reset();

      const dashjsModule = await import('dashjs');
      const dashjsLib = dashjsModule.default || dashjsModule;
      if (destroyed) return;

      const player = dashjsLib.MediaPlayer().create();
      player.initialize(videoRef.current!, manifestUrl, true);

      player.on(dashjsLib.MediaPlayer.events.STREAM_INITIALIZED, () => {
        if (destroyed) return;
        const bitrates = player.getBitrateInfoListFor('video');
        if (bitrates && bitrates.length > 0) {
          setQualityList(bitrates.map((b, idx) => ({
            index: idx,
            label: `${b.height}P`,
            bitrate: b.bitrate,
            width: b.width,
            height: b.height,
          })));
        }
        setPlayerLoading(false);
      });

      player.on(dashjsLib.MediaPlayer.events.ERROR, (e: unknown) => {
        if (destroyed) return;
        const err = e as { error?: { message?: string } };
        setPlayerLoading(false);
        toastRef.current({
          title: 'Stream gagal diputar',
          description: err?.error?.message || 'Gagal memuat stream. Coba video lain atau coba lagi nanti.',
          variant: 'destructive',
        });
      });

      fallbackTimer = setTimeout(() => {
        if (destroyed) return;
        setPlayerLoading(false);
      }, 12000);

      playerRef.current = player;
    }, 100);

    return () => {
      destroyed = true;
      clearTimeout(timer);
      if (fallbackTimer) clearTimeout(fallbackTimer);
    };
  }, [pageState, result]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (playerRef.current) {
        playerRef.current.reset();
        playerRef.current = null;
      }
    };
  }, []);

  // ==================== Quality Switch ====================

  const handleQualityChange = useCallback((value: string) => {
    setSelectedQuality(value);
    if (!playerRef.current) return;
    if (value === 'auto') {
      playerRef.current.updateSettings({
        streaming: { abr: { autoSwitchQuality: true } },
      });
    } else {
      playerRef.current.updateSettings({
        streaming: { abr: { autoSwitchQuality: false } },
      });
      playerRef.current.setQualityFor('video', parseInt(value, 10));
    }
  }, []);

  // ==================== Download ====================

  const handleDownload = useCallback(() => {
    if (!result?.data) return;
    const videos = result.data.streaming?.videos || [];
    // Find highest quality with a baseUrl
    const downloadable = videos.filter(v => v.baseUrl);
    const target = downloadable.length > 0
      ? downloadable.reduce((best, v) => (v.bandwidth > best.bandwidth ? v : best), downloadable[0])
      : null;

    if (!target) {
      toast({
        title: 'Download not available',
        description: 'No direct download URL found for this video. DASH segment-based videos cannot be downloaded directly.',
        variant: 'destructive',
      });
      return;
    }

    const filename = `${result.data.videoInfo?.title || 'video'}.m4s`;
    const downloadUrl = `/api/download?url=${encodeURIComponent(target.baseUrl)}&filename=${encodeURIComponent(filename)}`;
    window.open(downloadUrl, '_blank');
  }, [result, toast]);

  // ==================== Derived Data ====================

  const videoInfo = result?.data?.videoInfo;
  const uploader = result?.data?.uploader;
  const stats = result?.data?.stats;
  const recommendations = result?.data?.recommendations || [];
  const streaming = result?.data?.streaming;

  // ==================== Render ====================

  return (
    <div className="dark min-h-screen flex flex-col bg-[#0f0f0f] text-white">
      {/* ==================== HEADER ==================== */}
      <header className="sticky top-0 z-50 border-b border-white/[0.08] bg-[#0f0f0f]/95 backdrop-blur-md">
        <div className="mx-auto max-w-7xl px-4 h-14 flex items-center gap-4">
          {/* Logo */}
          <button
            onClick={handleBack}
            className="flex items-center gap-2.5 shrink-0 group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pink-500 rounded-lg p-1 -ml-1"
            aria-label={pageState === 'player' ? 'Back to home' : 'Bstation home'}
          >
            <AnimatePresence mode="wait">
              {pageState === 'player' ? (
                <motion.div
                  key="back"
                  initial={{ rotate: -90, opacity: 0 }}
                  animate={{ rotate: 0, opacity: 1 }}
                  exit={{ rotate: 90, opacity: 0 }}
                  transition={{ duration: 0.2 }}
                >
                  <ArrowLeft className="h-5 w-5 text-white/90 group-hover:text-pink-400 transition-colors" />
                </motion.div>
              ) : (
                <motion.div
                  key="logo"
                  initial={{ scale: 0.8, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  exit={{ scale: 0.8, opacity: 0 }}
                  transition={{ duration: 0.2 }}
                >
                  <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-pink-500 to-pink-600 flex items-center justify-center shadow-lg shadow-pink-500/20">
                    <Tv className="h-4 w-4 text-white" />
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </button>

          <div className="flex-1 min-w-0">
            <h1 className="text-base font-bold tracking-tight truncate">
              <span className="text-pink-400">B</span>station
            </h1>
          </div>

          {/* Compact search in player mode */}
          {pageState === 'player' && (
            <motion.form
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: 'auto', opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              transition={{ duration: 0.3 }}
              onSubmit={(e) => {
                e.preventDefault();
                if (url.trim()) loadVideo(url);
              }}
              className="hidden sm:flex items-center max-w-xs"
            >
              <div className="relative flex-1">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-white/40" />
                <Input
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="Paste bilibili.tv link..."
                  className="h-8 pl-8 pr-3 text-xs bg-white/[0.06] border-white/10 rounded-full focus-visible:border-pink-500/50 focus-visible:ring-pink-500/20"
                />
              </div>
            </motion.form>
          )}
        </div>
      </header>

      {/* ==================== MAIN ==================== */}
      <main className="flex-1">
        <AnimatePresence mode="wait">

          {/* ========== LANDING STATE ========== */}
          {pageState === 'landing' && (
            <motion.section
              key="landing"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0, y: -20 }}
              transition={{ duration: 0.3 }}
              className="relative flex flex-col items-center justify-center min-h-[calc(100vh-8rem)] px-4"
              aria-label="Landing page with search"
            >
              {/* Background glow effects */}
              <div className="absolute inset-0 overflow-hidden pointer-events-none">
                <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-[600px] h-[400px] bg-pink-500/[0.07] rounded-full blur-[120px]" />
                <div className="absolute bottom-1/4 left-1/3 w-[300px] h-[300px] bg-pink-600/[0.04] rounded-full blur-[100px]" />
              </div>

              <div className="relative z-10 flex flex-col items-center text-center max-w-2xl w-full">
                {/* Logo icon */}
                <motion.div
                  initial={{ scale: 0, rotate: -180 }}
                  animate={{ scale: 1, rotate: 0 }}
                  transition={{ type: 'spring', stiffness: 200, damping: 20, delay: 0.1 }}
                  className="mb-6"
                >
                  <div className="h-20 w-20 sm:h-24 sm:w-24 rounded-2xl bg-gradient-to-br from-pink-500 via-pink-600 to-rose-600 flex items-center justify-center shadow-2xl shadow-pink-500/30">
                    <Play className="h-10 w-10 sm:h-12 sm:w-12 text-white ml-1" fill="white" />
                  </div>
                </motion.div>

                {/* Brand name */}
                <motion.h1
                  initial={{ y: 20, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  transition={{ delay: 0.2, duration: 0.5 }}
                  className="text-4xl sm:text-5xl font-extrabold tracking-tight mb-3"
                >
                  <span className="bg-gradient-to-r from-pink-400 via-pink-500 to-rose-500 bg-clip-text text-transparent">
                    Bstation
                  </span>
                </motion.h1>

                <motion.p
                  initial={{ y: 20, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  transition={{ delay: 0.3, duration: 0.5 }}
                  className="text-white/50 text-sm sm:text-base mb-10"
                >
                  Paste a bilibili.tv video link to start watching
                </motion.p>

                {/* Search bar */}
                <motion.form
                  initial={{ y: 20, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  transition={{ delay: 0.4, duration: 0.5 }}
                  onSubmit={handleSubmit}
                  className="w-full max-w-xl"
                >
                  <div className="relative group">
                    <div className="absolute -inset-0.5 bg-gradient-to-r from-pink-500/20 via-pink-500/10 to-rose-500/20 rounded-2xl blur-sm opacity-0 group-focus-within:opacity-100 transition-opacity duration-300" />
                    <div className="relative flex items-center">
                      <Search className="absolute left-4 h-5 w-5 text-white/30 pointer-events-none" />
                      <Input
                        value={url}
                        onChange={(e) => setUrl(e.target.value)}
                        placeholder="https://www.bilibili.tv/video/..."
                        className="h-14 sm:h-16 pl-12 pr-32 text-base sm:text-lg bg-white/[0.06] border-white/[0.08] rounded-xl focus-visible:border-pink-500/50 focus-visible:ring-pink-500/20 placeholder:text-white/25"
                        aria-label="Bilibili.tv video URL"
                      />
                      <Button
                        type="submit"
                        disabled={loading || !url.trim()}
                        className="absolute right-2 h-10 sm:h-12 px-5 sm:px-7 bg-pink-500 hover:bg-pink-600 text-white font-semibold rounded-lg shadow-lg shadow-pink-500/25 transition-all hover:shadow-pink-500/40 disabled:opacity-50 min-w-[100px] sm:min-w-[120px]"
                      >
                        {loading ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <>
                            <Play className="h-4 w-4 mr-1.5" fill="white" />
                            <span className="hidden sm:inline">Watch</span>
                          </>
                        )}
                      </Button>
                    </div>
                  </div>
                </motion.form>

                {/* Feature hints */}
                <motion.div
                  initial={{ y: 20, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  transition={{ delay: 0.6, duration: 0.5 }}
                  className="mt-10 flex flex-wrap items-center justify-center gap-3 sm:gap-4"
                >
                  {[
                    { icon: Zap, label: 'DASH Streaming' },
                    { icon: Settings, label: 'Quality Control' },
                    { icon: Download, label: 'Download Video' },
                  ].map((item) => (
                    <div
                      key={item.label}
                      className="flex items-center gap-1.5 text-white/30 text-xs sm:text-sm"
                    >
                      <item.icon className="h-3.5 w-3.5" />
                      <span>{item.label}</span>
                    </div>
                  ))}
                </motion.div>
              </div>
            </motion.section>
          )}

          {/* ========== LOADING STATE ========== */}
          {pageState === 'loading' && (
            <motion.section
              key="loading"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.3 }}
              className="mx-auto max-w-5xl w-full px-4 py-8 space-y-6"
              aria-label="Loading video"
            >
              {/* Player skeleton */}
              <Skeleton className="w-full aspect-video rounded-2xl bg-white/[0.06]" />
              {/* Title skeleton */}
              <div className="space-y-3">
                <Skeleton className="h-7 w-3/4 bg-white/[0.06]" />
                <Skeleton className="h-5 w-1/3 bg-white/[0.06]" />
              </div>
              {/* Info bar skeleton */}
              <div className="flex items-center gap-4">
                <Skeleton className="h-10 w-10 rounded-full bg-white/[0.06]" />
                <div className="space-y-2">
                  <Skeleton className="h-4 w-32 bg-white/[0.06]" />
                  <Skeleton className="h-3 w-24 bg-white/[0.06]" />
                </div>
              </div>
              {/* Recommendations skeleton */}
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
                {Array.from({ length: 8 }).map((_, i) => (
                  <div key={i} className="space-y-2">
                    <Skeleton className="aspect-video rounded-xl bg-white/[0.06]" />
                    <Skeleton className="h-4 w-full bg-white/[0.06]" />
                    <Skeleton className="h-3 w-2/3 bg-white/[0.06]" />
                  </div>
                ))}
              </div>
            </motion.section>
          )}

          {/* ========== PLAYER STATE ========== */}
          {pageState === 'player' && result && videoInfo && (
            <motion.section
              key="player"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              transition={{ duration: 0.4 }}
              className="mx-auto max-w-5xl w-full px-4 py-4 sm:py-6 space-y-4 sm:space-y-6"
              aria-label="Video player and details"
            >
              {/* ---- VIDEO PLAYER ---- */}
              <div className="relative w-full aspect-video rounded-2xl overflow-hidden bg-black shadow-2xl shadow-black/50">
                <video
                  ref={videoRef}
                  className="w-full h-full"
                  controls
                  playsInline
                  aria-label={`Playing: ${videoInfo.title}`}
                />
                {/* Player loading overlay */}
                <AnimatePresence>
                  {playerLoading && (
                    <motion.div
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      className="absolute inset-0 bg-black/60 flex flex-col items-center justify-center gap-3"
                    >
                      <Loader2 className="h-10 w-10 text-pink-500 animate-spin" />
                      <span className="text-white/70 text-sm">Loading stream...</span>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              {/* ---- TITLE ---- */}
              <div>
                <h2 className="text-lg sm:text-2xl font-bold leading-tight text-white/95 pr-12">
                  {videoInfo.title}
                </h2>
              </div>

              {/* ---- UPLOADER + STATS ---- */}
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                {/* Uploader */}
                <div className="flex items-center gap-3">
                  {uploader && (
                    <>
                      <Avatar className="h-10 w-10">
                        {uploader.avatar ? (
                          <AvatarImage src={uploader.avatar} alt={`${uploader.name}'s avatar`} />
                        ) : null}
                        <AvatarFallback className="bg-pink-500/20 text-pink-400">
                          <User className="h-4 w-4" />
                        </AvatarFallback>
                      </Avatar>
                      <div>
                        <p className="font-semibold text-sm text-white/90">{uploader.name}</p>
                        <p className="text-xs text-white/40">{uploader.follower} followers</p>
                      </div>
                    </>
                  )}
                </div>

                {/* Stats */}
                {stats && (
                  <div className="flex items-center gap-4 text-sm">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="flex items-center gap-1.5 text-white/50 hover:text-white/70 transition-colors cursor-default">
                          <Eye className="h-4 w-4" />
                          <span>{formatViews(stats.views)}</span>
                        </span>
                      </TooltipTrigger>
                      <TooltipContent side="bottom" className="bg-zinc-800 border-zinc-700 text-zinc-200">
                        {stats.views} views
                      </TooltipContent>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="flex items-center gap-1.5 text-white/50 hover:text-pink-400 transition-colors cursor-default">
                          <ThumbsUp className="h-4 w-4" />
                          <span>{formatViews(stats.likes)}</span>
                        </span>
                      </TooltipTrigger>
                      <TooltipContent side="bottom" className="bg-zinc-800 border-zinc-700 text-zinc-200">
                        {stats.likes} likes
                      </TooltipContent>
                    </Tooltip>
                  </div>
                )}
              </div>

              <Separator className="bg-white/[0.06]" />

              {/* ---- QUALITY + DOWNLOAD BAR ---- */}
              <div className="flex flex-wrap items-center gap-3">
                {/* Quality Selector */}
                <Select value={selectedQuality} onValueChange={handleQualityChange}>
                  <SelectTrigger
                    className="w-[160px] bg-white/[0.06] border-white/10 text-white/90 rounded-lg h-10 focus:ring-pink-500/20"
                    aria-label="Video quality"
                  >
                    <Film className="h-4 w-4 mr-1.5 text-white/40" />
                    <SelectValue placeholder="Auto" />
                  </SelectTrigger>
                  <SelectContent className="bg-zinc-900 border-zinc-800 text-white">
                    <SelectItem value="auto" className="focus:bg-pink-500/10 focus:text-pink-400">
                      Auto
                    </SelectItem>
                    {qualityList.map((q) => (
                      <SelectItem
                        key={q.index}
                        value={String(q.index)}
                        className="focus:bg-pink-500/10 focus:text-pink-400"
                      >
                        <span className="flex items-center gap-2">
                          <span>{q.label}</span>
                          <span className="text-xs text-white/30">{q.width}x{q.height}</span>
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                {/* Duration badge */}
                {videoInfo.duration > 0 && (
                  <Badge
                    variant="secondary"
                    className="bg-white/[0.06] text-white/60 border-white/10 h-10 px-3 gap-1.5 rounded-lg"
                  >
                    <Clock className="h-3.5 w-3.5" />
                    {formatDuration(videoInfo.duration)}
                  </Badge>
                )}

                {/* Date */}
                {videoInfo.formattedPubDate && (
                  <Badge
                    variant="secondary"
                    className="bg-white/[0.06] text-white/60 border-white/10 h-10 px-3 gap-1.5 rounded-lg"
                  >
                    {formatDate(videoInfo.formattedPubDate)}
                  </Badge>
                )}

                {/* Spacer */}
                <div className="flex-1" />

                {/* Share */}
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-10 w-10 text-white/50 hover:text-white/90 hover:bg-white/[0.06] rounded-lg"
                      onClick={() => {
                        if (navigator.clipboard) {
                          navigator.clipboard.writeText(url);
                          toast({ title: 'Link copied!', description: 'Video URL copied to clipboard.' });
                        }
                      }}
                      aria-label="Copy video link"
                    >
                      <Share2 className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="bg-zinc-800 border-zinc-700 text-zinc-200">
                    Copy link
                  </TooltipContent>
                </Tooltip>

                {/* Download */}
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-10 px-4 text-white/50 hover:text-pink-400 hover:bg-pink-500/10 border border-white/10 hover:border-pink-500/30 rounded-lg gap-2 transition-all"
                      onClick={handleDownload}
                      aria-label="Download video"
                    >
                      <Download className="h-4 w-4" />
                      <span className="hidden sm:inline">Download</span>
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="bg-zinc-800 border-zinc-700 text-zinc-200">
                    Download highest quality
                  </TooltipContent>
                </Tooltip>

                {/* Open on bilibili.tv (fallback) */}
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-10 px-4 text-white/50 hover:text-emerald-400 hover:bg-emerald-500/10 border border-white/10 hover:border-emerald-500/30 rounded-lg gap-2 transition-all"
                      onClick={() => window.open(url, '_blank')}
                      aria-label="Watch on bilibili.tv"
                    >
                      <Tv className="h-4 w-4" />
                      <span className="hidden sm:inline">bilibili.tv</span>
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="bg-zinc-800 border-zinc-700 text-zinc-200">
                    Watch on bilibili.tv
                  </TooltipContent>
                </Tooltip>
              </div>

              {/* ---- DESCRIPTION ---- */}
              {videoInfo.desc && (
                <Card className="bg-white/[0.03] border-white/[0.06] rounded-xl overflow-hidden py-0 gap-0">
                  <CardContent className="p-4">
                    <button
                      onClick={() => setDescExpanded(!descExpanded)}
                      className="w-full text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pink-500 rounded-lg p-1 -m-1"
                      aria-expanded={descExpanded}
                      aria-label={descExpanded ? 'Collapse description' : 'Expand description'}
                    >
                      <p className={`text-sm text-white/60 leading-relaxed whitespace-pre-wrap ${!descExpanded ? 'line-clamp-2' : ''}`}>
                        {videoInfo.desc}
                      </p>
                      <span className="inline-flex items-center gap-1 text-xs text-pink-400 mt-2 hover:text-pink-300 transition-colors">
                        {descExpanded ? 'Show less' : 'Show more'}
                        <ChevronDown className={`h-3.5 w-3.5 transition-transform ${descExpanded ? 'rotate-180' : ''}`} />
                      </span>
                    </button>
                  </CardContent>
                </Card>
              )}

              {/* ---- STREAMING INFO (collapsible) ---- */}
              {streaming && (streaming.videos.length > 0 || streaming.audios.length > 0) && (
                <Card className="bg-white/[0.03] border-white/[0.06] rounded-xl overflow-hidden py-0 gap-0">
                  <button
                    onClick={() => setDescExpanded(!descExpanded)}
                    className="w-full p-4 flex items-center justify-between focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pink-500 rounded-t-xl"
                    aria-expanded={descExpanded}
                  >
                    <div className="flex items-center gap-2">
                      <Volume2 className="h-4 w-4 text-pink-400" />
                      <span className="text-sm font-medium text-white/80">
                        Stream Info
                      </span>
                      <Badge variant="secondary" className="bg-white/[0.06] text-white/40 border-white/10 text-[10px] h-5 px-1.5">
                        {streaming.videos.length}V + {streaming.audios.length}A
                      </Badge>
                    </div>
                    <ChevronDown className={`h-4 w-4 text-white/30 transition-transform ${descExpanded ? 'rotate-180' : ''}`} />
                  </button>
                  <AnimatePresence>
                    {descExpanded && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.3 }}
                        className="overflow-hidden"
                      >
                        <div className="px-4 pb-4 space-y-2 max-h-64 overflow-y-auto custom-scrollbar">
                          {streaming.videos.map((v, i) => (
                            <div
                              key={`v-${i}`}
                              className="flex items-center justify-between p-2.5 rounded-lg bg-white/[0.03] hover:bg-white/[0.06] transition-colors"
                            >
                              <div className="flex items-center gap-2 min-w-0 flex-1">
                                <Badge
                                  className={v.isDash ? 'bg-white/10 text-white/60 text-[10px] h-5' : 'bg-pink-500/20 text-pink-400 text-[10px] h-5 border-pink-500/20'}
                                  variant={v.isDash ? 'outline' : 'secondary'}
                                >
                                  {v.qualityLabel}
                                </Badge>
                                <span className="text-[11px] text-white/30 font-mono">{v.codec}</span>
                                <span className="text-[11px] text-white/30">{v.width}x{v.height}</span>
                              </div>
                              {v.isDash && (
                                <Badge variant="outline" className="text-[9px] h-4 px-1 border-amber-500/30 text-amber-400/60">DASH</Badge>
                              )}
                            </div>
                          ))}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </Card>
              )}

              {/* ---- RECOMMENDATIONS ---- */}
              {recommendations.length > 0 && (
                <section aria-label="Recommended videos">
                  <div className="flex items-center gap-2 mb-4">
                    <ListVideo className="h-5 w-5 text-pink-400" />
                    <h3 className="text-base sm:text-lg font-semibold text-white/90">Recommended</h3>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4 max-h-[500px] overflow-y-auto pr-1 custom-scrollbar">
                    {recommendations.map((rec, i) => (
                      <motion.button
                        key={rec.aid}
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: i * 0.05, duration: 0.3 }}
                        onClick={() => handleRecommendationClick(rec.aid)}
                        className="group text-left rounded-xl overflow-hidden border border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.06] hover:border-white/[0.12] transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pink-500"
                        aria-label={`Watch: ${rec.title}`}
                      >
                        <div className="relative aspect-video overflow-hidden">
                          <img
                            src={rec.cover}
                            alt={`Thumbnail for ${rec.title}`}
                            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                            loading="lazy"
                          />
                          <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />
                          {rec.duration > 0 && (
                            <span className="absolute bottom-1.5 right-1.5 bg-black/80 text-white text-[10px] font-medium px-1.5 py-0.5 rounded">
                              {formatDuration(rec.duration)}
                            </span>
                          )}
                          <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-200">
                            <div className="h-10 w-10 rounded-full bg-pink-500/90 flex items-center justify-center backdrop-blur-sm">
                              <Play className="h-4 w-4 text-white ml-0.5" fill="white" />
                            </div>
                          </div>
                        </div>
                        <div className="p-2.5 sm:p-3">
                          <p className="text-xs sm:text-sm font-medium text-white/80 line-clamp-2 leading-snug group-hover:text-white transition-colors">
                            {rec.title}
                          </p>
                          <p className="text-[10px] sm:text-xs text-white/35 mt-1.5 truncate">
                            {rec.author}
                          </p>
                          <p className="text-[10px] sm:text-xs text-white/25 mt-0.5">
                            {formatViews(rec.view)} views
                          </p>
                        </div>
                      </motion.button>
                    ))}
                  </div>
                </section>
              )}
            </motion.section>
          )}

        </AnimatePresence>
      </main>

      {/* ==================== FOOTER ==================== */}
      <footer className="mt-auto border-t border-white/[0.06] bg-[#0a0a0a] pb-[env(safe-area-inset-bottom)]">
        <div className="mx-auto max-w-7xl px-4 h-12 flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs text-white/25">
            <div className="h-5 w-5 rounded bg-gradient-to-br from-pink-500 to-pink-600 flex items-center justify-center">
              <Tv className="h-3 w-3 text-white" />
            </div>
            <span>Bstation Stream</span>
          </div>
          <span className="text-xs text-white/20">
            Powered by dash.js
          </span>
        </div>
      </footer>

      {/* ==================== CUSTOM SCROLLBAR STYLES ==================== */}
      <style jsx global>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 6px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: rgba(255, 255, 255, 0.1);
          border-radius: 3px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: rgba(255, 255, 255, 0.2);
        }
      `}</style>
    </div>
  );
}
