import { useEffect, useState } from "react";
import { APP } from "@briefcast/shared";
import { api, type EpisodeDetail } from "../api";
import { formatTime, friendlyDate } from "../copy";
import { RATES, usePlayer } from "../player";
import type { Go } from "../App";

export function EpisodeScreen({ id, autoplay, go, back }: { id: string; autoplay?: boolean; go: Go; back: () => void }) {
  const [ep, setEp] = useState<EpisodeDetail | null>(null);
  const [tab, setTab] = useState<"chapters" | "transcript" | "sources">("chapters");
  const [reporting, setReporting] = useState(false);
  const p = usePlayer();

  useEffect(() => {
    api.getEpisode(id).then((e) => {
      setEp(e);
      if (autoplay) p.load(e, true);
    });
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!ep) return <div style={{ paddingTop: 40 }} className="center"><div className="spinner" style={{ margin: "0 auto" }} /></div>;

  const isCurrent = p.episode?.id === ep.id;
  const position = isCurrent ? p.position : 0;
  const duration = (isCurrent && p.duration) || ep.durationSec || 0;
  const current = ep.segments.filter((s) => (s.startSec ?? 0) <= position + 0.5).pop();
  const play = () => (isCurrent ? p.toggle() : p.load(ep, true));
  const jump = (sec: number) => {
    if (!isCurrent) p.load(ep, true);
    setTimeout(() => p.seek(sec, "chapter_jump"), isCurrent ? 0 : 300);
  };

  return (
    <div>
      <button className="back" onClick={back}>‹ Back</button>
      <span className="pill">{friendlyDate(ep.scheduledFor)} · {ep.episodeType === "deep_dive" ? "Deep dive" : "Mix"}</span>
      <h1>{ep.title}</h1>
      {ep.changeNote && <p className="note">✦ {ep.changeNote}</p>}

      {!ep.audioUrl ? (
        <p className="note">The audio for this episode is not ready. You can read the transcript below.</p>
      ) : (
        <>
          <p className="center" style={{ fontWeight: 600, marginTop: 20, minHeight: 27 }}>{isCurrent && current ? current.title : ""}</p>
          <input className="seek" type="range" min={0} max={duration || 1} step={1} value={position}
            aria-label="Position" onChange={(e) => (isCurrent ? p.seek(Number(e.target.value)) : jump(Number(e.target.value)))} />
          <div className="times"><span>{formatTime(position)}</span><span>-{formatTime(Math.max(0, duration - position))}</span></div>
          <div className="player-controls">
            <button className="icon-btn" onClick={() => p.skip(-15)} disabled={!isCurrent} aria-label="Back 15 seconds">-15</button>
            <button className="play-big" onClick={play} aria-label={isCurrent && p.playing ? "Pause" : "Play"}>{isCurrent && p.playing ? "❚❚" : "▶"}</button>
            <button className="icon-btn" onClick={() => p.skip(30)} disabled={!isCurrent} aria-label="Forward 30 seconds">+30</button>
          </div>
          <div className="row" style={{ justifyContent: "center" }}>
            <span className="muted small">Speed</span>
            <select className="input" style={{ width: 110, minHeight: 44 }} value={p.rate} onChange={(e) => p.setRate(Number(e.target.value))} aria-label="Playback speed">
              {RATES.map((r) => <option key={r} value={r}>{r}×</option>)}
            </select>
          </div>
        </>
      )}

      <div className="tabbar">
        {(["chapters", "transcript", "sources"] as const).map((t) => (
          <button key={t} className={tab === t ? "on" : ""} onClick={() => setTab(t)}>{{ chapters: "Chapters", transcript: "Transcript", sources: "Sources" }[t]}</button>
        ))}
      </div>

      {tab === "chapters" && ep.segments.map((s) => (
        <div key={s.id}>
          <button className={`chapter ${isCurrent && current?.id === s.id ? "now" : ""}`} onClick={() => s.startSec != null && jump(s.startSec)}>
            <span className="t">{formatTime(s.startSec ?? 0)}</span>
            <span className="space">{s.title}</span>
          </button>
          {s.kind === "idea" && isCurrent && current?.id === s.id && s.question && <p className="muted small" style={{ margin: "8px 4px" }}>Question: {s.question}</p>}
        </div>
      ))}

      {tab === "transcript" && (
        <div>
          {ep.transcript.map((l, n) => {
            const on = isCurrent && position >= l.startSec && position < l.endSec;
            return (
              <div key={n} className={`tline ${on ? "now" : ""}`} onClick={() => jump(l.startSec)}>
                {ep.transcript.some((x) => x.speaker === "HOST_B") && <b>{l.speaker === "HOST_A" ? "Host 1" : "Host 2"}</b>}
                {l.text}
              </div>
            );
          })}
          <p className="muted small">{APP.aiDisclosure}</p>
        </div>
      )}

      {tab === "sources" && (
        <div>
          <p className="muted small">The episode summarises these in its own words. Read the originals here.</p>
          {ep.sources.length === 0 && <p className="muted">No sources listed.</p>}
          {ep.sources.map((s, n) => (
            <div className="list-item" key={n}>
              <div className="space">
                <div>{s.url ? <a href={s.url} target="_blank" rel="noreferrer">{s.title}</a> : s.title}</div>
                <div className="muted small">{s.source}{s.segmentId ? ` · ${ep.segments.find((x) => x.id === s.segmentId)?.title ?? ""}` : ""}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="stack" style={{ marginTop: 24 }}>
        <button className="btn" onClick={() => go({ name: "feedback", id: ep.id })}>Give feedback</button>
        {!reporting ? (
          <button className="btn ghost small" style={{ width: "100%" }} onClick={() => setReporting(true)}>Report a wrong or harmful episode</button>
        ) : (
          <Report episodeId={ep.id} onDone={() => setReporting(false)} />
        )}
      </div>
    </div>
  );
}

function Report({ episodeId, onDone }: { episodeId: string; onDone: () => void }) {
  const [reason, setReason] = useState<"wrong_fact" | "harmful" | "other">("wrong_fact");
  const [note, setNote] = useState("");
  const [sent, setSent] = useState(false);
  if (sent) return <p className="ok">Thank you. We will look at it.</p>;
  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>What is wrong?</h3>
      <div className="segmented">
        {([["wrong_fact", "Wrong fact"], ["harmful", "Harmful"], ["other", "Other"]] as const).map(([v, l]) => (
          <button key={v} className={reason === v ? "on" : ""} onClick={() => setReason(v)}>{l}</button>
        ))}
      </div>
      <textarea className="input" style={{ minHeight: 100, marginTop: 12 }} placeholder="Tell us more (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
      <div className="row" style={{ marginTop: 12 }}>
        <button className="btn secondary" onClick={onDone}>Cancel</button>
        <button className="btn" onClick={async () => { await api.report(episodeId, reason, note); setSent(true); }}>Send</button>
      </div>
    </div>
  );
}
