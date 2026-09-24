import { useEffect, useState } from "react";
import { api, type Interest, type Settings } from "../api";
import { AboutYouEditor, InterestsEditor, SettingsEditor, SourcesEditor } from "../components/editors";

const STEPS = ["name", "interests", "sources", "about", "settings"] as const;
type StepName = (typeof STEPS)[number];

const TITLES: Record<StepName, [string, string]> = {
  name: ["Welcome", "What should the host call you?"],
  interests: ["Your interests", "Choose what you want to hear about, and how much."],
  sources: ["Sources you trust", "Add podcasts, websites and books you like. Your sources come first."],
  about: ["About you", "This makes every episode about your real situation."],
  settings: ["Your podcast", "How often, how long, and how it sounds. You can change this any time."],
};

export function Onboarding({ onDone }: { onDone: (episodeId: string) => void }) {
  const [i, setI] = useState(0);
  const [name, setName] = useState("");
  const [interests, setInterests] = useState<Interest[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const step = STEPS[i]!;

  useEffect(() => {
    api.getProfile().then((p) => setName(p.displayName));
    api.getInterests().then(setInterests);
    api.getSettings().then(setSettings);
  }, []);

  const next = async () => {
    setBusy(true); setError(null);
    try {
      if (step === "name") await api.saveProfile({ displayName: name.trim(), timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone });
      if (step === "interests") await api.saveInterests(interests);
      if (step === "settings" && settings) {
        await api.saveSettings(settings);
        await api.saveProfile({ onboardingDone: true });
        onDone(await api.requestEpisodeNow());
        return;
      }
      setI(i + 1);
      window.scrollTo(0, 0);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    }
    setBusy(false);
  };

  const [title, sub] = TITLES[step];
  return (
    <div>
      <div className="progress-dots">{STEPS.map((s, n) => <i key={s} className={n <= i ? "on" : ""} />)}</div>
      {i > 0 && <button className="back" onClick={() => setI(i - 1)}>‹ Back</button>}
      <h1>{title}</h1>
      <p className="muted">{sub}</p>

      {step === "name" && (
        <label className="field"><span>First name</span>
          <input className="input" autoComplete="given-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Dana" />
        </label>
      )}
      {step === "interests" && <InterestsEditor value={interests} onChange={setInterests} />}
      {step === "sources" && <SourcesEditor />}
      {step === "about" && <AboutYouEditor />}
      {step === "settings" && settings && <SettingsEditor value={settings} onChange={setSettings} />}

      {error && <p className="error">{error}</p>}
      <div className="stack" style={{ marginTop: 24 }}>
        <button className="btn" disabled={busy || (step === "name" && !name.trim())} onClick={next}>
          {step === "settings" ? (busy ? "Starting…" : "Make my first episode") : "Next"}
        </button>
        {step !== "name" && step !== "settings" && (
          <button className="btn ghost" onClick={() => { setI(i + 1); window.scrollTo(0, 0); }}>Skip for now</button>
        )}
      </div>
    </div>
  );
}
