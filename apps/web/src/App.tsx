import { useCallback, useEffect, useState } from "react";
import { api } from "./api";
import { PlayerProvider, usePlayer } from "./player";
import { Welcome } from "./screens/Welcome";
import { Onboarding } from "./screens/Onboarding";
import { Making } from "./screens/Making";
import { Today } from "./screens/Today";
import { EpisodeScreen } from "./screens/Episode";
import { Feedback } from "./screens/Feedback";
import { Library } from "./screens/Library";
import { Edit, Me, type EditWhat } from "./screens/Me";

export type Tab = "today" | "library" | "me";
export type Route =
  | { name: "loading" }
  | { name: "welcome" }
  | { name: "onboarding" }
  | { name: "making"; id: string }
  | { name: "tab"; tab: Tab }
  | { name: "episode"; id: string; autoplay?: boolean }
  | { name: "feedback"; id: string }
  | { name: "edit"; what: EditWhat };
export type Go = (r: Route) => void;

export function App() {
  return (
    <PlayerProvider>
      <Shell />
    </PlayerProvider>
  );
}

function Shell() {
  const [stack, setStack] = useState<Route[]>([{ name: "loading" }]);
  const route = stack[stack.length - 1]!;
  const go: Go = useCallback((r) => { setStack((s) => [...s, r]); window.scrollTo(0, 0); }, []);
  const reset = useCallback((r: Route) => { setStack([r]); window.scrollTo(0, 0); }, []);
  const back = useCallback(() => setStack((s) => (s.length > 1 ? s.slice(0, -1) : [{ name: "tab", tab: "today" }])), []);
  const player = usePlayer();

  // When an episode ends, open the feedback screen.
  useEffect(() => {
    player.onEnded.current = (ep) => go({ name: "feedback", id: ep.id });
  }, [go, player.onEnded]);

  useEffect(() => {
    (async () => {
      if (!(await api.isSignedIn())) return reset({ name: "welcome" });
      const p = await api.getProfile().catch(() => null);
      if (!p) return reset({ name: "welcome" });
      reset(p.onboardingDone ? { name: "tab", tab: "today" } : { name: "onboarding" });
    })();
  }, [reset]);

  const tab = route.name === "tab" ? route.tab : null;
  const showTabs = route.name === "tab";
  const showMini = player.episode && route.name !== "episode" && route.name !== "welcome" && route.name !== "onboarding";

  return (
    <>
      {api.mode === "preview" && <div className="banner">Preview mode — sample data, no real episodes</div>}
      <main className="app">
        {route.name === "loading" && <div style={{ paddingTop: "30vh" }}><div className="spinner" style={{ margin: "0 auto" }} /></div>}
        {route.name === "welcome" && <Welcome onJoined={() => reset({ name: "onboarding" })} />}
        {route.name === "onboarding" && <Onboarding onDone={(id) => reset({ name: "making", id })} />}
        {route.name === "making" && (
          <Making episodeId={route.id}
            onReady={() => reset({ name: "episode", id: route.id })}
            onLeave={() => reset({ name: "tab", tab: "today" })} />
        )}
        {tab === "today" && <Today go={go} />}
        {tab === "library" && <Library go={go} />}
        {tab === "me" && <Me go={go} />}
        {route.name === "episode" && <EpisodeScreen key={route.id} id={route.id} autoplay={route.autoplay} go={go} back={back} />}
        {route.name === "feedback" && <Feedback id={route.id} onDone={back} />}
        {route.name === "edit" && <Edit what={route.what} back={back} />}
      </main>

      {(showTabs || showMini) && (
        <nav className="bottom">
          <div className="bottom-inner">
            {showMini && player.episode && (
              <>
                <div className="mini-bar"><div style={{ width: `${(player.position / (player.duration || 1)) * 100}%` }} /></div>
                <div className="mini" onClick={() => go({ name: "episode", id: player.episode!.id })}>
                  <span className="title">{player.episode.title}</span>
                  <button className="icon-btn" onClick={(e) => { e.stopPropagation(); player.toggle(); }} aria-label={player.playing ? "Pause" : "Play"}>
                    {player.playing ? "❚❚" : "▶"}
                  </button>
                </div>
              </>
            )}
            {showTabs && (
              <div className="tabs">
                {(["today", "library", "me"] as const).map((t) => (
                  <button key={t} className={tab === t ? "on" : ""} onClick={() => reset({ name: "tab", tab: t })}>
                    {{ today: "Today", library: "Library", me: "You" }[t]}
                  </button>
                ))}
              </div>
            )}
          </div>
        </nav>
      )}
    </>
  );
}
