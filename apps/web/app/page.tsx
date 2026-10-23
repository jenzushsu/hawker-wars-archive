"use client";
import { useEffect, useRef, useState } from "react";
import Arena from "../components/Arena";
import AnalysisTabs from "../components/AnalysisTabs";
import { Pictogram } from "../components/Pictogram";
import { parseDemoData, DemoLoadError } from "../lib/load-demo";
import {
  formatGameMoney,
  getScenario,
  getTurn,
  type DemoData,
  type DemoScenarioId,
} from "../lib/demo";
const accents = { green: "#246848", blue: "#245e91", amber: "#8b5b15" };
const votes = [
  {
    id: "bus",
    title: "Bus arrival",
    description: "Six extra customers arrive together.",
  },
  {
    id: "rain",
    title: "Afternoon rain",
    description: "Fewer customers arrive for a while.",
  },
  {
    id: "supplier-delay",
    title: "Supplier delay",
    description: "Deliveries take longer to reach the stalls.",
  },
];
function saveJson(value: unknown, filename: string) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export default function Home() {
  const [data, setData] = useState<DemoData | null>(null),
    [error, setError] = useState<false | "empty" | "invalid">(false),
    [scenarioId, setScenario] = useState<DemoScenarioId>("clean"),
    [position, setPosition] = useState(0),
    [playing, setPlaying] = useState(false),
    [mode, setMode] = useState<"cinematic" | "analytical">("cinematic"),
    [expanded, setExpanded] = useState(false),
    [selected, setSelected] = useState(0),
    [pinned, setPinned] = useState<number | null>(null),
    [rail, setRail] = useState(false),
    [vote, setVote] = useState<string | null>(null),
    [shortcuts, setShortcuts] = useState(true),
    [reducedMotion, setReducedMotion] = useState(false),
    [copyStatus, setCopyStatus] = useState<{
      key: string;
      message: string;
    } | null>(null),
    [defaultsRestored, setDefaultsRestored] = useState(false),
    [dialogType, setDialogType] = useState<"inspect" | "help">("inspect");
  const dialog = useRef<HTMLDialogElement>(null),
    railRef = useRef<HTMLElement>(null),
    returnFocus = useRef<HTMLElement | null>(null),
    voteToggle = useRef<HTMLButtonElement>(null),
    hudToggle = useRef<HTMLButtonElement>(null),
    copyRequest = useRef(0),
    copyIdentity = useRef("");
  useEffect(() => {
    const controller = new AbortController();
    fetch("/demo.json", { signal: controller.signal })
      .then((r) => {
        if (!r.ok) throw new Error("Unavailable");
        return r.json();
      })
      .then((d: unknown) => setData(parseDemoData(d)))
      .catch((e) => {
        if (e.name !== "AbortError")
          setError(
            e instanceof DemoLoadError && e.code === "empty"
              ? "empty"
              : "invalid",
          );
      });
    return () => controller.abort();
  }, []);
  useEffect(() => {
    const query = matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    try {
      const saved = localStorage.getItem("hawker-view");
      if (saved === "analytical") setMode(saved);
      const savedHud = localStorage.getItem("hawker-hud");
      setExpanded(savedHud ? savedHud === "expanded" : saved === "analytical");
      setShortcuts(localStorage.getItem("hawker-shortcuts") !== "off");
    } catch {}
  }, []);
  useEffect(() => {
    if (!playing) return;
    const timer = setInterval(
      () =>
        setPosition((p) => {
          if (p >= 120) {
            setPlaying(false);
            return 120;
          }
          return p + 1;
        }),
      800,
    );
    return () => clearInterval(timer);
  }, [playing]);
  function changeMode(next: "cinematic" | "analytical") {
    setMode(next);
    if (next === "cinematic" && document.activeElement?.closest(".hud-body"))
      hudToggle.current?.focus();
    setExpanded(next === "analytical");
    try {
      localStorage.setItem("hawker-view", next);
      localStorage.setItem(
        "hawker-hud",
        next === "analytical" ? "expanded" : "collapsed",
      );
    } catch {}
  }
  function openDialog(type: "inspect" | "help") {
    returnFocus.current = document.activeElement as HTMLElement;
    setDialogType(type);
    if (type === "help") setDefaultsRestored(false);
    if (type === "inspect" && pinned === null)
      setPinned(Math.min(position, 119));
    dialog.current?.showModal();
  }
  function closeRail() {
    setRail(false);
    voteToggle.current?.focus();
  }
  function toggleHud() {
    if (expanded && document.activeElement?.closest(".hud-body"))
      hudToggle.current?.focus();
    setExpanded((v) => !v);
    try {
      localStorage.setItem("hawker-hud", expanded ? "collapsed" : "expanded");
    } catch {}
  }
  function restoreDefaults() {
    if (document.activeElement?.closest(".hud-body"))
      hudToggle.current?.focus();
    setMode("cinematic");
    setExpanded(false);
    setShortcuts(true);
    setDefaultsRestored(true);
    try {
      localStorage.setItem("hawker-view", "cinematic");
      localStorage.setItem("hawker-hud", "collapsed");
      localStorage.setItem("hawker-shortcuts", "on");
    } catch {}
  }
  function selectStall(index: number) {
    setSelected(index);
    setPinned(Math.min(position, 119));
    setExpanded(true);
    try {
      localStorage.setItem("hawker-hud", "expanded");
    } catch {}
  }
  useEffect(() => {
    function key(e: KeyboardEvent) {
      if (e.key === "Escape" && !dialog.current?.open && rail) {
        closeRail();
        e.preventDefault();
        return;
      }
      if (
        !shortcuts ||
        e.ctrlKey ||
        e.metaKey ||
        e.altKey ||
        dialog.current?.open
      )
        return;
      const target = e.target as HTMLElement;
      if (target.matches("input,select,textarea") || target.isContentEditable)
        return;
      const k = e.key.toLowerCase();
      if (["1", "2", "3"].includes(k)) {
        selectStall(Number(k) - 1);
      } else if (k === "h") toggleHud();
      else if (k === "i") openDialog("inspect");
      else if (k === "a") changeMode("analytical");
      else if (k === "c") changeMode("cinematic");
      else if (k === "v") {
        setRail(true);
        setTimeout(() => railRef.current?.focus(), 0);
      } else if (k === "?") openDialog("help");
      else return;
      e.preventDefault();
    }
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  });
  const scenario = data ? getScenario(data, scenarioId) : null;
  const frame = scenario
    ? position === 120
      ? scenario.terminal
      : getTurn(scenario, position)
    : null;
  const decision = scenario
    ? getTurn(scenario, pinned ?? Math.min(position, 119))
    : null;
  const detail = decision?.stalls[selected];
  const selectedName = data?.competitors[selected]?.name ?? "Jev";
  const decisionKey = `${scenarioId}:${selected}:${decision?.tick ?? "none"}:${dialogType}`;
  copyIdentity.current = decisionKey;
  useEffect(() => {
    copyRequest.current += 1;
    setCopyStatus(null);
  }, [decisionKey]);
  const decisionPayload =
    detail && decision && data
      ? {
          schemaVersion: data.schemaVersion,
          classification: data.classification,
          baselineVersion: data.baselineVersion,
          simulationVersion: data.simulationVersion,
          scorerVersion: data.scorerVersion,
          scenario: scenarioId,
          tick: decision.tick,
          modelInferencePerformed: false,
          wallTimeMs: null,
          nativeUsage: null,
          canonicalStateHash: null,
          decision: detail,
        }
      : null;
  async function copyDecision() {
    if (!decisionPayload) return;
    const key = decisionKey,
      request = ++copyRequest.current;
    setCopyStatus(null);
    try {
      if (!navigator.clipboard?.writeText)
        throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(
        JSON.stringify(decisionPayload, null, 2),
      );
      if (
        request === copyRequest.current &&
        copyIdentity.current === key &&
        dialog.current?.open
      )
        setCopyStatus({ key, message: "Decision copied." });
    } catch {
      if (
        request === copyRequest.current &&
        copyIdentity.current === key &&
        dialog.current?.open
      )
        setCopyStatus({
          key,
          message: "Copy failed. Download this decision instead.",
        });
    }
  }
  function restoreDialogFocus() {
    copyRequest.current += 1;
    setCopyStatus(null);
    const target = returnFocus.current;
    if (target?.isConnected && target.getClientRects().length) target.focus();
    else hudToggle.current?.focus();
  }
  return (
    <main className={`app ${expanded ? "analysis-open" : ""}`}>
      <header className="topbar">
        <div className="brand">
          <h1>HAWKER WARS</h1>
          <span className="status">OFFLINE DEMO</span>
        </div>
        <div className="top-actions">
          <a href="/live">Watch live</a>
          <div className="mode" aria-label="Viewing mode">
            <button
              aria-pressed={mode === "cinematic"}
              onClick={() => changeMode("cinematic")}
            >
              Cinematic
            </button>
            <button
              aria-pressed={mode === "analytical"}
              onClick={() => changeMode("analytical")}
            >
              Analytical
            </button>
          </div>
          <button onClick={() => openDialog("help")}>Help</button>
        </div>
      </header>
      <p className="notice">
        Best viewed at 1366 × 768 or larger. Playback, decisions and downloads
        remain available here.
      </p>
      {!data || !frame || !scenario ? (
        <div className="empty" role="status">
          <h2>
            {error === "empty"
              ? "No recorded run is available."
              : error
                ? "The replay could not load."
                : "Opening the hawker centre…"}
          </h2>
          <p>
            {error === "empty"
              ? "There are no recorded decisions to display. Reload when a recording is available."
              : error
                ? "Reload to try the local demo again. No provider request has been made."
                : "Loading recorded rules decisions. No model calls are needed."}
          </p>
          {error && (
            <button onClick={() => location.reload()}>Reload demo</button>
          )}
        </div>
      ) : (
        <>
          <div className="stage">
            <section
              className="arena-column"
              aria-label="Three-stall offline arena"
            >
              <div className="venue">
                <div>
                  <h2>Same rice. Three rivals.</h2>
                  <p>
                    Singapore chicken rice · Rules replay ·{" "}
                    {position === 120 ? "Service complete" : "Lunch service"}
                  </p>
                </div>
                <label className="scenario-control">
                  Recorded scenario
                  <select
                    value={scenarioId}
                    onChange={(e) => {
                      setScenario(e.target.value as DemoScenarioId);
                      setPosition(0);
                      setPinned(null);
                      setPlaying(false);
                    }}
                  >
                    {data.scenarios.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.title}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="stall-labels">
                {data.competitors.map((c, i) => {
                  const s = frame.stalls[i]!;
                  return (
                    <button
                      key={c.id}
                      className="stall-label"
                      style={
                        { "--accent": accents[c.accent] } as React.CSSProperties
                      }
                      aria-label={`Inspect ${c.name}`}
                      aria-describedby={`profit-${c.id} source-${c.id} state-${c.id}`}
                      aria-pressed={selected === i && expanded}
                      onClick={() => selectStall(i)}
                    >
                      <h3>{c.name}</h3>
                      <span className="profit" id={`profit-${c.id}`}>
                        {formatGameMoney(s.profitCents)}
                        <span className="sr-only">
                          {" "}
                          {s.provisional ? "Provisional" : "Final"} profit SGD
                        </span>
                      </span>
                      <small id={`source-${c.id}`}>
                        Rules demo mirror · {s.action ?? "CLOSED"}
                      </small>
                      <small>
                        {s.provisional ? "Provisional" : "Final"} profit · SGD
                      </small>
                      <span className="state" id={`state-${c.id}`}>
                        <Pictogram name="queue" /> {s.queueCount} waiting ·{" "}
                        <Pictogram name="inventory" /> {s.readyPortions} ready
                      </span>
                      <small>Inspect decision →</small>
                    </button>
                  );
                })}
              </div>
              <div className="scene-frame">
                <Arena
                  tick={position}
                  sceneId={scenarioId}
                  customers={frame.customerActivity}
                  delivered={frame.effectActivity.delivered}
                  effects={frame.rulesBaseline.effects}
                  servedTotal={frame.rulesBaseline.served}
                  action={frame.rulesBaseline.action}
                  ready={frame.rulesBaseline.readyPortions}
                  raw={frame.rulesBaseline.rawPortions}
                  settled={position === 120}
                  profitCents={frame.rulesBaseline.profitCents}
                  paused={!playing}
                  reducedMotion={reducedMotion}
                  queue={frame.rulesBaseline.queueCount}
                  cooking={frame.rulesBaseline.cookingPortions > 0}
                />
              </div>
              <div className="scene-caption">
                <p>
                  {frame.eventSummary.slice(0, 2).join(" · ") ||
                    "Recorded service in progress."}
                </p>
                <span>
                  {position === 120 ? "Settled" : "Committed"} tick {frame.tick}
                </span>
              </div>
            </section>
            {rail && (
              <aside
                className="vote-rail"
                ref={railRef}
                tabIndex={-1}
                aria-label="Local vote preview"
              >
                <div className="rail-title">
                  <h2>Change the lunch rush</h2>
                  <button aria-label="Close vote preview" onClick={closeRail}>
                    Close
                  </button>
                </div>
                <p>
                  Local voting preview. Choose an event to explore the planned
                  interaction.
                </p>
                {votes.map((v) => (
                  <button
                    className="vote-choice"
                    key={v.id}
                    aria-pressed={vote === v.id}
                    onClick={() => setVote(v.id)}
                  >
                    <strong>{v.title}</strong>
                    <span>{v.description}</span>
                  </button>
                ))}
                <div className="vote-receipt" role="status">
                  {vote
                    ? `${votes.find((v) => v.id === vote)?.title} selected locally. No vote sent.`
                    : "No event selected."}
                </div>
                <p className="footnote">
                  Voting is unavailable in this rules replay. Your selection
                  does not change the recording or its results.
                </p>
              </aside>
            )}
          </div>
          <section className="hud" aria-label="Replay controls and analysis">
            <div className="playback">
              <button
                className="primary play"
                onClick={() => {
                  if (position === 120 && !playing) setPosition(0);
                  setPlaying((p) => !p);
                }}
              >
                {playing ? "Pause" : position === 120 ? "Replay" : "Play"}
              </button>
              <span className="time">
                <Pictogram name="time" />
                {String(position).padStart(3, "0")} / 120 ticks
              </span>
              <input
                className="scrubber"
                aria-label="Replay tick"
                type="range"
                min="0"
                max="120"
                value={position}
                onChange={(e) => {
                  setPosition(Number(e.target.value));
                  setPlaying(false);
                }}
              />
              <span className="summary-label">
                {frame.rulesBaseline.served} served · rules-1
              </span>
              <button
                ref={voteToggle}
                aria-expanded={rail}
                onClick={() => setRail((v) => !v)}
              >
                <Pictogram name="vote" /> Vote preview
              </button>
              <button
                ref={hudToggle}
                aria-expanded={expanded}
                onClick={toggleHud}
              >
                {expanded ? "Hide analysis" : "Show analysis"}
              </button>
            </div>
            <div className="hud-body" hidden={!expanded}>
              <AnalysisTabs
                data={data}
                scenario={scenario}
                position={position}
                selected={selected}
                pinned={pinned}
                onSelectDecision={(policyIndex, tick) => {
                  setSelected(policyIndex);
                  setPinned(tick);
                  setPlaying(false);
                }}
              />
              <section
                className="inspector-compact"
                aria-label="Selected decision"
              >
                <div className="inspector-heading">
                  <h3>
                    {selectedName} · tick {decision?.tick}
                  </h3>
                  <button onClick={() => openDialog("inspect")}>
                    <Pictogram name="expand" /> Expand decision
                  </button>
                </div>
                <span className="valid">
                  <Pictogram
                    name={
                      detail?.validation === "forced-wait"
                        ? "warning"
                        : "validation"
                    }
                  />{" "}
                  {detail?.validation === "forced-wait"
                    ? "Forced WAIT"
                    : "Validated local rules"}{" "}
                  · {detail?.action}
                </span>
                <div className="observation-compact">
                  Observed: {detail?.observationSummary?.queueCount ?? "—"}{" "}
                  waiting · {detail?.observationSummary?.readyPortions ?? "—"}{" "}
                  ready · {detail?.observationSummary?.rawPortions ?? "—"} raw
                </div>
                <p>{detail?.consequence}</p>
                <small>
                  <Pictogram name="latency" />{" "}
                  {pinned === null
                    ? "Latest recorded tick"
                    : "Pinned recorded tick"}{" "}
                  · latency not measured
                </small>
                {pinned !== null && position > pinned && (
                  <button onClick={() => setPinned(Math.min(position, 119))}>
                    Jump to latest ({Math.min(position, 119) - pinned})
                  </button>
                )}
              </section>
            </div>
          </section>
          <footer className="footer">
            <span>
              All three stalls mirror one recorded rules policy. These are not
              model results. <Pictogram name="sound" /> Sound off.
            </span>
            <a href="/demo.json" download="hawker-wars-offline-demo.json">
              Download replay data
            </a>
          </footer>
        </>
      )}
      <dialog
        ref={dialog}
        aria-labelledby="dialog-title"
        onClose={restoreDialogFocus}
      >
        <div className="dialog-header">
          <h2 id="dialog-title">
            {dialogType === "help"
              ? "Your seat at the hawker centre"
              : `${selectedName} · decision ${decision?.tick ?? 0}`}
          </h2>
          <button onClick={() => dialog.current?.close()}>Close</button>
        </div>
        {dialogType === "help" ? (
          <div className="help-content">
            <p>
              Watch a deterministic rules replay across three named stall
              positions. All three display the same policy, so equal scores are
              intentional. This demo contains no Jev or Zoom model comparison.
            </p>
            <p>
              Play advances recorded ticks. Drag or use arrow keys on the
              timeline to seek. Select a stall to pin its decision; new playback
              ticks will not replace the decision you are reading.
            </p>
            <dl>
              <dt>1 / 2 / 3</dt>
              <dd>Select a stall</dd>
              <dt>C / A</dt>
              <dd>Cinematic / Analytical</dd>
              <dt>H / I</dt>
              <dd>Toggle analysis / expand inspector</dd>
              <dt>V / ?</dt>
              <dd>Open vote preview / help</dd>
              <dt>Escape</dt>
              <dd>Close this dialog</dd>
            </dl>
            <label>
              <input
                type="checkbox"
                checked={shortcuts}
                onChange={(e) => {
                  setShortcuts(e.target.checked);
                  try {
                    localStorage.setItem(
                      "hawker-shortcuts",
                      e.target.checked ? "on" : "off",
                    );
                  } catch {}
                }}
              />
              Enable single-key shortcuts
            </label>
            <p>
              Shortcuts are inactive in form fields. Browser zoom and standard
              keyboard navigation always work.
            </p>
            <div className="restore-preferences">
              <button onClick={restoreDefaults}>Restore view defaults</button>
              <p>
                Returns to Cinematic, hides analysis and enables shortcuts.
                Replay position, scenario, pinned decision and local vote are
                kept.
              </p>
              <p role="status">
                {defaultsRestored
                  ? "View defaults restored. Replay and selections kept."
                  : ""}
              </p>
            </div>
            <p>
              <a
                href="/decision-states"
                target="_blank"
                rel="noopener noreferrer"
              >
                Decision state examples (opens in new tab)
              </a>
            </p>
            <p>{data?.scoreDefinitions.utility}</p>
            <a href="/demo.json" download>
              Download the recorded results
            </a>
          </div>
        ) : detail && decision ? (
          <>
            <div className="dialog-grid">
              <section>
                <h3>Observation</h3>
                <p>
                  {detail.observationSummary?.queueCount} customers waiting,{" "}
                  {detail.observationSummary?.readyPortions} ready portions and{" "}
                  {detail.observationSummary?.rawPortions} raw portions at
                  decision time.
                </p>
                <dl>
                  <dt>Game time remaining</dt>
                  <dd>{detail.observationSummary?.remainingMinutes} minutes</dd>
                  <dt>Oldest wait</dt>
                  <dd>
                    {detail.observationSummary?.oldestWaitMinutes} minutes
                  </dd>
                  <dt>Legal actions</dt>
                  <dd>{detail.observationSummary?.legalActions.join(", ")}</dd>
                </dl>
              </section>
              <section>
                <h3>Action</h3>
                <p>
                  <strong>{detail.action}</strong> · accepted local rules action
                </p>
                <p className="valid">
                  {detail.validation === "forced-wait"
                    ? "Forced WAIT"
                    : "Valid against the recorded observation"}
                </p>
                <dl>
                  <dt>Policy</dt>
                  <dd>rules-1 · mirrored demo</dd>
                  <dt>Model proposal</dt>
                  <dd>Not supplied — no model called</dd>
                  <dt>Provider latency</dt>
                  <dd>Not measured</dd>
                </dl>
              </section>
              <section>
                <h3>Outcome</h3>
                <p>{detail.consequence}</p>
                <dl>
                  <dt>Committed profit</dt>
                  <dd>{formatGameMoney(detail.profitCents)} · provisional</dd>
                  <dt>Utility</dt>
                  <dd>
                    {detail.utilityPoints.toFixed(1)} points · provisional
                  </dd>
                  <dt>Customers served</dt>
                  <dd>{detail.served} cumulative</dd>
                </dl>
              </section>
              <section>
                <h3>Technical details</h3>
                <p>
                  Public observation and committed outcome only. No credentials,
                  hidden demand schedule or model reasoning is included.
                </p>
                <dl className="technical-versions">
                  <dt>Schema</dt>
                  <dd>{data?.schemaVersion}</dd>
                  <dt>Baseline</dt>
                  <dd>{data?.baselineVersion}</dd>
                  <dt>Simulation</dt>
                  <dd>{data?.simulationVersion}</dd>
                  <dt>Scorer</dt>
                  <dd>{data?.scorerVersion}</dd>
                  <dt>Wall time</dt>
                  <dd>Not recorded in this offline replay</dd>
                  <dt>Native usage</dt>
                  <dd>Not recorded in this offline replay</dd>
                  <dt>Canonical state hash</dt>
                  <dd>Not recorded in this offline replay</dd>
                </dl>
                <details>
                  <summary>Inspect sanitized record</summary>
                  <pre>{JSON.stringify(decisionPayload, null, 2)}</pre>
                </details>
                <div className="decision-exports">
                  <button onClick={copyDecision}>Copy decision</button>
                  <button
                    onClick={() =>
                      saveJson(
                        decisionPayload,
                        `hawker-decision-${scenarioId}-${decision.tick}.json`,
                      )
                    }
                  >
                    Download decision
                  </button>
                </div>
                <p className="copy-status" role="status">
                  {copyStatus?.key === decisionKey ? copyStatus.message : ""}
                </p>
              </section>
            </div>
            <div className="dialog-nav">
              <button
                disabled={decision.tick === 0}
                onClick={() => setPinned(Math.max(0, decision.tick - 1))}
              >
                Previous
              </button>
              <span>Pinned recorded tick {decision.tick}</span>
              <button
                disabled={decision.tick >= Math.min(position, 119)}
                onClick={() =>
                  setPinned(Math.min(position, 119, decision.tick + 1))
                }
              >
                Next
              </button>
              <button onClick={() => setPinned(Math.min(position, 119))}>
                Jump to latest
              </button>
            </div>
          </>
        ) : (
          <p>Load a replay to inspect a decision.</p>
        )}
      </dialog>
    </main>
  );
}
