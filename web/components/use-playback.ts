"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const SPEEDS = [1, 1.25, 1.5, 1.75, 2, 0.75];

/** Single owner of the hidden <audio> element (blueprint): all UI state is a
 * projection of element events; one seek path serves every control. */
export function usePlayback() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const seekingRef = useRef(false);
  const srcRef = useRef<string | null>(null);
  const [currentMs, setCurrentMs] = useState(0);
  const [durationMs, setDurationMs] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speedIdx, setSpeedIdx] = useState(0);

  useEffect(() => {
    const audio = new Audio();
    audio.preload = "metadata";
    audioRef.current = audio;

    const onTime = () => {
      if (!seekingRef.current) setCurrentMs(audio.currentTime * 1000);
    };
    const onMeta = () => setDurationMs((audio.duration || 0) * 1000);
    const onEnded = () => setPlaying(false);
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onSeeked = () => {
      seekingRef.current = false;
      setCurrentMs(audio.currentTime * 1000);
    };

    audio.addEventListener("timeupdate", onTime);
    audio.addEventListener("loadedmetadata", onMeta);
    audio.addEventListener("durationchange", onMeta);
    audio.addEventListener("ended", onEnded);
    audio.addEventListener("play", onPlay);
    audio.addEventListener("pause", onPause);
    audio.addEventListener("seeked", onSeeked);
    return () => {
      audio.pause();
      audio.removeEventListener("timeupdate", onTime);
      audio.removeEventListener("loadedmetadata", onMeta);
      audio.removeEventListener("durationchange", onMeta);
      audio.removeEventListener("ended", onEnded);
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("pause", onPause);
      audio.removeEventListener("seeked", onSeeked);
      audioRef.current = null;
    };
  }, []);

  const load = useCallback((url: string | null, title?: string, bucket?: string) => {
    const audio = audioRef.current;
    if (!audio) return;
    // compare tracked src, never audio.src (browser absolutizes it) — blueprint gotcha
    if (srcRef.current === url) return;
    srcRef.current = url;
    audio.pause();
    setPlaying(false);
    setCurrentMs(0);
    setDurationMs(0);
    if (url) {
      audio.src = url;
      audio.load();
      if ("mediaSession" in navigator && title) {
        navigator.mediaSession.metadata = new MediaMetadata({
          title,
          artist: bucket ? `Threads · ${bucket}` : "Threads",
        });
      }
    } else {
      audio.removeAttribute("src");
    }
  }, []);

  const toggle = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || !srcRef.current) return;
    if (audio.paused) void audio.play();
    else audio.pause();
  }, []);

  const seekToMs = useCallback((ms: number) => {
    const audio = audioRef.current;
    if (!audio || !srcRef.current) return;
    seekingRef.current = true;
    const target = Math.max(0, ms / 1000);
    audio.currentTime = target;
    setCurrentMs(ms); // optimistic; stale timeupdates gated by seekingRef
    if (audio.paused) void audio.play();
  }, []);

  const seekToRatio = useCallback(
    (ratio: number) => {
      if (durationMs > 0) seekToMs(Math.min(1, Math.max(0, ratio)) * durationMs);
    },
    [durationMs, seekToMs],
  );

  const skip = useCallback((deltaS: number) => {
    const audio = audioRef.current;
    if (!audio || !srcRef.current) return;
    audio.currentTime = Math.max(0, audio.currentTime + deltaS);
  }, []);

  const cycleSpeed = useCallback(() => {
    const next = (speedIdx + 1) % SPEEDS.length;
    setSpeedIdx(next);
    if (audioRef.current) audioRef.current.playbackRate = SPEEDS[next];
  }, [speedIdx]);

  return {
    load, toggle, seekToMs, seekToRatio, skip, cycleSpeed,
    currentMs, durationMs, playing, speed: SPEEDS[speedIdx],
  };
}

export type Playback = ReturnType<typeof usePlayback>;

export function fmtMs(ms: number, likeMs?: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const refH = likeMs !== undefined ? Math.floor(likeMs / 3_600_000) : h;
  if (h > 0 || refH > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}
