import { useEffect, useState } from "react";
import { APP } from "@briefcast/shared";
import { api, type Interest, type Settings } from "../api";
import { AboutYouEditor, InterestsEditor, SettingsEditor, SourcesEditor } from "../components/editors";
import type { Go } from "../App";

export type EditWhat = "about" | "interests" | "sources" | "settings" | "privacy";

export function Me({ go }: { go: Go }) {
  const [name, setName] = useState("");
  const [context, setContext] = useState<string | null>(null);
  useEffect(() => {
    api.getProfile().then((p) => setName(p.displayName));
    api.getContext().then(setContext).catch(() => setContext(""));
  }, []);

  const item = (what: EditWhat, title: string, sub: string) => (
    <button className="list-item" style={{ width: "100%", background: "none", border: "none", borderBottom: "1px solid var(--line)", textAlign: "left", cursor: "pointer" }}
      onClick={() => go({ name: "edit", what })}>
      <div className="space"><div style={{ fontWeight: 600 }}>{title}</div><div className="muted small">{sub}</div></div>
      <span>›</span>
    </button>
  );

  return (
    <div>
      <h1>You{name ? `, ${name}` : ""}</h1>
      <div className="card">
        <h3 style={{ marginTop: 0 }}>This is what the app knows about you</h3>
        <p className="small" style={{ whiteSpace: "pre-wrap" }}>{context === null ? "…" : context || "Nothing yet. Add a few lines to make episodes more personal."}</p>
        <button className="btn secondary small" onClick={() => go({ name: "edit", what: "about" })}>Edit</button>
      </div>
      <div style={{ marginTop: 12 }}>
        {item("interests", "Interests", "What you hear about, and how much")}
        {item("sources", "Sources", "Podcasts, websites and books you trust")}
        {item("settings", "Podcast settings", "When, how long, format, voice, tone, language")}
        {item("privacy", "Privacy and your data", "AI disclosure, delete your data")}
      </div>
      <p className="muted small" style={{ marginTop: 20 }}>{APP.aiDisclosure}</p>
      {api.mode === "preview" && <p className="muted small">Preview mode: sample data, nothing is saved.</p>}
    </div>
  );
}

export function Edit({ what, back }: { what: EditWhat; back: () => void }) {
  const [interests, setInterests] = useState<Interest[] | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    if (what === "interests") api.getInterests().then(setInterests);
    if (what === "settings") api.getSettings().then(setSettings);
  }, [what]);

  const save = async () => {
    if (interests) await api.saveInterests(interests);
    if (settings) await api.saveSettings(settings);
    setSaved(true);
    setTimeout(back, 600);
  };

  return (
    <div>
      <button className="back" onClick={back}>‹ Back</button>
      <h1>{{ about: "About you", interests: "Interests", sources: "Sources", settings: "Podcast settings", privacy: "Privacy and your data" }[what]}</h1>
      {what === "about" && <><AboutYouEditor /><DeleteContext /></>}
      {what === "interests" && interests && (
        <>
          <InterestsEditor value={interests} onChange={(v) => { setInterests(v); setSaved(false); }} />
          <Learned interests={interests} />
        </>
      )}
      {what === "sources" && <SourcesEditor />}
      {what === "settings" && settings && <SettingsEditor value={settings} onChange={(v) => { setSettings(v); setSaved(false); }} />}
      {what === "privacy" && <Privacy />}
      {(what === "interests" || what === "settings") && (
        <button className="btn" style={{ marginTop: 20 }} onClick={save}>{saved ? "Saved ✓" : "Save"}</button>
      )}
    </div>
  );
}

/** Shows what the learning loop changed, in plain words. */
function Learned({ interests }: { interests: Interest[] }) {
  const moved = interests.filter((i) => i.learnedWeight !== undefined && Math.abs(i.learnedWeight - 1) >= 0.1);
  if (!moved.length) return null;
  return (
    <div className="card" style={{ marginTop: 16 }}>
      <h3 style={{ marginTop: 0 }}>Learned from your feedback</h3>
      {moved.map((i) => <p key={i.label} className="small">{i.learnedWeight! > 1 ? "↑ More" : "↓ Less"} about {i.label}</p>)}
    </div>
  );
}

function DeleteContext() {
  const [done, setDone] = useState(false);
  return (
    <button className="btn danger" style={{ marginTop: 16 }} disabled={done} onClick={async () => {
      if (!confirm("Delete what the app knows about you?")) return;
      await api.deleteContext(); setDone(true);
    }}>{done ? "Deleted" : "Delete my profile text"}</button>
  );
}

function Privacy() {
  const [busy, setBusy] = useState(false);
  return (
    <div className="stack">
      <p><b>AI-made content.</b> {APP.aiDisclosure}</p>
      <p><b>Your profile</b> is stored encrypted. We use it only to make your episodes. We never use it to train AI models.</p>
      <p><b>Sources.</b> Episodes summarise and discuss sources in their own words, with short quotes at most, and link to the originals.</p>
      <p><b>What we send to AI providers.</b> To make an episode, we send your profile, interests and the source texts to Anthropic (Claude) and the script to OpenAI (voice). They do not use API data to train their models.</p>
      <p className="muted small">This is a test version. The full privacy policy comes with the public app.</p>
      <button className="btn danger" disabled={busy} onClick={async () => {
        if (!confirm("Delete your account and all your data? This cannot be undone.")) return;
        setBusy(true);
        await api.deleteAccount();
        location.reload();
      }}>Delete my account and all data</button>
    </div>
  );
}
