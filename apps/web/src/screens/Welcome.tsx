import { useState } from "react";
import { APP } from "@briefcast/shared";
import { api } from "../api";

export function Welcome({ onJoined }: { onJoined: () => void }) {
  const [code, setCode] = useState(() => new URLSearchParams(location.search).get("invite") ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <div className="stack" style={{ paddingTop: "12vh" }}>
      <img src="./icon.svg" alt="" width={72} height={72} style={{ borderRadius: 18 }} />
      <h1>{APP.name}</h1>
      <p style={{ fontSize: 21 }}>{APP.tagline}</p>
      <p className="muted">
        A short personal episode every morning. It finds the one idea worth thinking about, connects it to your work,
        and ends with a question for your walk.
      </p>
      <form className="stack" onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true); setError(null);
        const err = await api.joinWithInvite(code);
        setBusy(false);
        if (err) setError(err); else onJoined();
      }}>
        <label className="field"><span>Invite code</span>
          <input className="input" autoCapitalize="characters" autoComplete="off" placeholder="e.g. K7M2QX"
            value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} />
        </label>
        {error && <p className="error">{error}</p>}
        <button className="btn" disabled={busy || !code.trim()}>{busy ? "One moment…" : "Start"}</button>
      </form>
      <p className="muted small">{APP.aiDisclosure}</p>
      <p className="muted small">
        This is an early test version. Your account lives in this browser, so please use the same phone and browser.
        Tip: tap Share → "Add to Home Screen".
      </p>
    </div>
  );
}
