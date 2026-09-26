/**
 * Voice list with a 10-second preview for each voice.
 * One preview plays at a time. Starting a preview pauses the episode player.
 */
import { useEffect, useRef, useState } from "react";
import { VOICE_PREVIEW, VOICES } from "@briefcast/shared";
import { usePlayer } from "../player";

export function previewUrl(id: string): string {
  return import.meta.env.BASE_URL + VOICE_PREVIEW.path(id);
}

function usePreview() {
  const audio = useRef<HTMLAudioElement | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [failed, setFailed] = useState<Set<string>>(new Set());
  const player = usePlayer();

  const stop = () => {
    clearTimeout(timer.current);
    audio.current?.pause();
    setPlayingId(null);
  };

  const play = (id: string) => {
    stop();
    if (player.playing) player.toggle();
    const a = (audio.current ??= new Audio());
    a.src = previewUrl(id);
    a.onended = stop;
    setPlayingId(id);
    a.play().then(
      // Safety stop, with a little extra time so the last word is not cut.
      () => { timer.current = setTimeout(stop, (VOICE_PREVIEW.seconds + 1) * 1000); },
      () => { setPlayingId(null); setFailed((f) => new Set(f).add(id)); },
    );
  };

  useEffect(() => stop, []); // stop when the screen closes
  return { playingId, failed, play, stop };
}

export function VoicePicker({ label, value, onChange, exclude }: {
  label: string; value: string; onChange: (id: string) => void; exclude?: string;
}) {
  const { playingId, failed, play, stop } = usePreview();
  return (
    <div className="field" role="radiogroup" aria-label={label}>
      <span>{label}</span>
      {VOICES.filter((v) => v.id !== exclude).map((v) => {
        const on = v.id === value;
        const playing = playingId === v.id;
        return (
          <div key={v.id} className={`voice ${on ? "on" : ""}`}>
            <button className="voice-pick" role="radio" aria-checked={on} onClick={() => onChange(v.id)}>
              <b>{v.name}</b>
              <span className="muted small">{failed.has(v.id) ? "Preview not available yet" : v.description}</span>
            </button>
            <button
              className="icon-btn"
              aria-label={playing ? `Stop ${v.name} preview` : `Play ${v.name} preview`}
              onClick={() => (playing ? stop() : play(v.id))}
            >
              {playing ? "■" : "▶"}
            </button>
          </div>
        );
      })}
    </div>
  );
}
