/**
 * One audio player for the whole app, so playback continues while the user moves between screens.
 * Uses the Media Session API for lock-screen controls (iOS Safari 15+, Android Chrome).
 * Sends listening events (start, progress every 30 s, complete) for the demo numbers.
 */
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { APP } from "@briefcast/shared";
import { api, type EpisodeDetail } from "./api";

interface PlayerState {
  episode: EpisodeDetail | null;
  playing: boolean;
  position: number;
  duration: number;
  rate: number;
  load(ep: EpisodeDetail, autoplay?: boolean): void;
  toggle(): void;
  seek(sec: number, reason?: "chapter_jump"): void;
  skip(delta: number): void;
  setRate(r: number): void;
  /** Called when an episode ends (the app opens the feedback screen). */
  onEnded: React.MutableRefObject<((ep: EpisodeDetail) => void) | null>;
}

const Ctx = createContext<PlayerState | null>(null);
export const usePlayer = () => useContext(Ctx)!;

export const RATES = [0.8, 1, 1.2, 1.5, 1.75, 2];

export function PlayerProvider({ children }: { children: ReactNode }) {
  const audio = useRef<HTMLAudioElement>(new Audio());
  const [episode, setEpisode] = useState<EpisodeDetail | null>(null);
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [rate, setRateState] = useState(() => Number(safeGet("rate")) || 1);
  const onEnded = useRef<((ep: EpisodeDetail) => void) | null>(null);
  const started = useRef<Set<string>>(new Set());
  const lastProgress = useRef(0);
  const epRef = useRef<EpisodeDetail | null>(null);
  epRef.current = episode;

  useEffect(() => {
    const a = audio.current;
    a.preload = "metadata";
    const onTime = () => {
      setPosition(a.currentTime);
      const ep = epRef.current;
      if (ep && a.currentTime - lastProgress.current >= 30) {
        lastProgress.current = a.currentTime;
        api.logListen(ep.id, "progress", a.currentTime).catch(() => undefined);
        safeSet(`pos:${ep.id}`, String(Math.floor(a.currentTime)));
      }
      updatePositionState(a);
    };
    const onPlay = () => {
      setPlaying(true);
      const ep = epRef.current;
      if (ep && !started.current.has(ep.id)) {
        started.current.add(ep.id);
        api.logListen(ep.id, "start", a.currentTime).catch(() => undefined);
      }
    };
    const onPause = () => setPlaying(false);
    const onMeta = () => setDuration(a.duration || epRef.current?.durationSec || 0);
    const onEnd = () => {
      setPlaying(false);
      const ep = epRef.current;
      if (ep) {
        api.logListen(ep.id, "complete", a.currentTime).catch(() => undefined);
        safeSet(`pos:${ep.id}`, "0");
        onEnded.current?.(ep);
      }
    };
    a.addEventListener("timeupdate", onTime);
    a.addEventListener("play", onPlay);
    a.addEventListener("pause", onPause);
    a.addEventListener("loadedmetadata", onMeta);
    a.addEventListener("ended", onEnd);
    return () => {
      a.removeEventListener("timeupdate", onTime);
      a.removeEventListener("play", onPlay);
      a.removeEventListener("pause", onPause);
      a.removeEventListener("loadedmetadata", onMeta);
      a.removeEventListener("ended", onEnd);
    };
  }, []);

  const load = useCallback((ep: EpisodeDetail, autoplay = true) => {
    const a = audio.current;
    if (!ep.audioUrl) return;
    if (epRef.current?.id !== ep.id) {
      a.src = ep.audioUrl;
      a.playbackRate = rate;
      lastProgress.current = 0;
      // continue where the user stopped last time
      const saved = Number(safeGet(`pos:${ep.id}`)) || 0;
      if (saved > 5) a.currentTime = saved;
      setEpisode(ep);
      setDuration(ep.durationSec ?? 0);
      setupMediaSession(ep, a);
    }
    if (autoplay) a.play().catch(() => undefined);
  }, [rate]);

  const toggle = useCallback(() => {
    const a = audio.current;
    if (a.paused) a.play().catch(() => undefined);
    else a.pause();
  }, []);

  const seek = useCallback((sec: number, reason?: "chapter_jump") => {
    const a = audio.current;
    a.currentTime = Math.max(0, Math.min(sec, (a.duration || Infinity) - 0.5));
    setPosition(a.currentTime);
    if (reason && epRef.current) api.logListen(epRef.current.id, reason, sec).catch(() => undefined);
  }, []);

  const skip = useCallback((d: number) => seek(audio.current.currentTime + d), [seek]);

  const setRate = useCallback((r: number) => {
    audio.current.playbackRate = r;
    setRateState(r);
    safeSet("rate", String(r));
    if (epRef.current) api.logListen(epRef.current.id, "speed_change", audio.current.currentTime).catch(() => undefined);
  }, []);

  return (
    <Ctx.Provider value={{ episode, playing, position, duration, rate, load, toggle, seek, skip, setRate, onEnded }}>
      {children}
    </Ctx.Provider>
  );
}

function setupMediaSession(ep: EpisodeDetail, a: HTMLAudioElement) {
  if (!("mediaSession" in navigator)) return;
  navigator.mediaSession.metadata = new MediaMetadata({
    title: ep.title ?? "Your episode",
    artist: APP.name,
    album: "Your daily episode",
    artwork: [{ src: new URL("./icon.svg", location.href).href, sizes: "512x512", type: "image/svg+xml" }],
  });
  const set = (action: MediaSessionAction, fn: MediaSessionActionHandler) => {
    try { navigator.mediaSession.setActionHandler(action, fn); } catch { /* not supported */ }
  };
  set("play", () => a.play());
  set("pause", () => a.pause());
  set("seekbackward", () => { a.currentTime = Math.max(0, a.currentTime - 15); });
  set("seekforward", () => { a.currentTime = a.currentTime + 30; });
  set("seekto", (d) => { if (d.seekTime != null) a.currentTime = d.seekTime; });
  // Previous / next track buttons jump between chapters.
  set("previoustrack", () => {
    const starts = ep.segments.map((s) => s.startSec ?? 0).filter((t) => t < a.currentTime - 3);
    a.currentTime = starts.length ? starts[starts.length - 1]! : 0;
  });
  set("nexttrack", () => {
    const next = ep.segments.map((s) => s.startSec ?? 0).find((t) => t > a.currentTime + 1);
    if (next != null) a.currentTime = next;
  });
}

function updatePositionState(a: HTMLAudioElement) {
  if (!("mediaSession" in navigator) || !a.duration || !isFinite(a.duration)) return;
  try {
    navigator.mediaSession.setPositionState({ duration: a.duration, position: Math.min(a.currentTime, a.duration), playbackRate: a.playbackRate });
  } catch { /* ignore */ }
}

/** localStorage can throw in private mode. These are only conveniences (speed, resume point). */
function safeGet(k: string): string | null {
  try { return localStorage.getItem(k); } catch { return null; }
}
function safeSet(k: string, v: string) {
  try { localStorage.setItem(k, v); } catch { /* ignore */ }
}
