"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { formatGameMoney, getTurn, type DemoAction, type DemoData, type DemoScenario } from "../lib/demo";
import styles from "./AnalysisTabs.module.css";

export interface AnalysisTabsProps {
  data: DemoData;
  scenario: DemoScenario;
  position: number;
  selected: number;
  pinned: number | null;
  onSelectDecision: (policyIndex: number, tick: number) => void;
}

const TABS = ["Match", "Decisions", "Benchmarks"] as const;
type Tab = (typeof TABS)[number];
const ACTIONS: readonly DemoAction[] = ["SERVE", "COOK", "RESTOCK", "PROMOTE", "WAIT"];

/** Read-only views of the public recording; the parent owns replay and inspector selection. */
export function AnalysisTabs({ data, scenario, position, selected, pinned, onSelectDecision }: AnalysisTabsProps) {
  const id = useId();
  const [active, setActive] = useState<Tab>("Match");
  const [policyIndex, setPolicyIndex] = useState(() => Math.max(0, Math.min(2, Math.floor(selected))));
  const [action, setAction] = useState<DemoAction | "all">("all");
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const panelRefs = useRef<Partial<Record<Tab, HTMLDivElement | null>>>({});
  const scrollPositions = useRef<Record<Tab, number>>({ Match: 0, Decisions: 0, Benchmarks: 0 });
  const policySelect = useRef<HTMLSelectElement>(null);
  const focusedTick = useRef<number | null>(null);
  const boundedPosition = Math.max(0, Math.min(120, Math.floor(position)));
  const latestTick = Math.min(boundedPosition, 119);
  const frame = boundedPosition === 120 ? scenario.terminal : getTurn(scenario, boundedPosition);
  const policy = data.competitors[policyIndex]!;
  // Only committed decisions at or before the visible boundary. Settlement adds no121st decision.
  const history = scenario.turns.slice(0, Math.min(boundedPosition + 1, 120)).filter(turn => turn.tick <= latestTick);
  const rows = history.filter(turn => action === "all" || turn.stalls[policyIndex]!.action === action).toReversed();

  function moveTab(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let next: number;
    if (event.key === "ArrowRight") next = (index + 1) % TABS.length;
    else if (event.key === "ArrowLeft") next = (index + TABS.length - 1) % TABS.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = TABS.length - 1;
    else return;
    event.preventDefault();
    setActive(TABS[next]!);
    tabRefs.current[next]?.focus();
  }

  useLayoutEffect(() => {
    const panel = panelRefs.current[active];
    if (panel) panel.scrollTop = scrollPositions.current[active];
  }, [active]);

  // A hidden HUD stays mounted. Restore its scroll when it gains a layout box again.
  useEffect(() => {
    const panel = panelRefs.current[active];
    if (!panel || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      if (panel.clientHeight > 0) panel.scrollTop = scrollPositions.current[active];
    });
    observer.observe(panel);
    return () => observer.disconnect();
  }, [active]);

  useLayoutEffect(() => {
    if (focusedTick.current !== null && !rows.some(turn => turn.tick === focusedTick.current)) {
      focusedTick.current = null;
      if (document.activeElement === document.body) policySelect.current?.focus();
    }
  }, [rows]);

  const panelProps = (tab: Tab) => ({
    id: `${id}-panel-${tab}`,
    role: "tabpanel" as const,
    "aria-labelledby": `${id}-tab-${tab}`,
    hidden: active !== tab,
    tabIndex: 0,
    className: styles.panel,
    "data-analysis-scroll": tab.toLowerCase(),
    ref: (element: HTMLDivElement | null) => { panelRefs.current[tab] = element; },
    onScroll: (event: { currentTarget: HTMLDivElement }) => {
      if (event.currentTarget.clientHeight > 0) scrollPositions.current[tab] = event.currentTarget.scrollTop;
    },
  });

  return (
    <section className={styles.analysis} aria-label="Replay analysis">
      <div className={styles.tabs} role="tablist" aria-label="Analysis views">
        {TABS.map((tab, index) => (
          <button
            key={tab}
            ref={element => { tabRefs.current[index] = element; }}
            type="button"
            role="tab"
            id={`${id}-tab-${tab}`}
            aria-controls={`${id}-panel-${tab}`}
            aria-selected={active === tab}
            tabIndex={active === tab ? 0 : -1}
            onClick={() => setActive(tab)}
            onKeyDown={event => moveTab(event, index)}
          >
            {tab}
          </button>
        ))}
      </div>

      <div {...panelProps("Match")}>
        <table className={styles.comparison}>
          <caption>
            {boundedPosition === 120 ? "Final settled" : "Provisional cumulative"} results · identical rules-demo mirrors
          </caption>
          <thead>
            <tr><th scope="col">Policy position</th><th scope="col">Served</th><th scope="col">Profit SGD</th><th scope="col">Utility pts</th></tr>
          </thead>
          <tbody>
            {data.competitors.map((competitor, index) => (
              <tr key={competitor.id}>
                <th scope="row">{competitor.shortName} <small>· demo</small></th>
                <td>{frame.stalls[index]!.served}</td>
                <td>{formatGameMoney(frame.stalls[index]!.profitCents)}</td>
                <td>{frame.stalls[index]!.utilityPoints.toFixed(1)}</td>
              </tr>
            ))}
            <tr className={styles.baseline}>
              <th scope="row">Rules baseline</th>
              <td>{frame.rulesBaseline.served}</td>
              <td>{formatGameMoney(frame.rulesBaseline.profitCents)}</td>
              <td>{frame.rulesBaseline.utilityPoints.toFixed(1)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div {...panelProps("Decisions")}>
        <div className={styles.filters}>
          <label>
            <span>Decision policy</span>
            <select ref={policySelect} value={policyIndex} onChange={event => setPolicyIndex(Number(event.target.value))}>
              {data.competitors.map((competitor, index) => <option key={competitor.id} value={index}>{competitor.name} · rules demo mirror</option>)}
            </select>
          </label>
          <label>
            <span>Decision action</span>
            <select value={action} onChange={event => setAction(event.target.value as DemoAction | "all")}>
              <option value="all">All actions</option>
              {ACTIONS.map(value => <option key={value} value={value}>{value}</option>)}
            </select>
          </label>
        </div>
        <table
          className={styles.history}
          onFocusCapture={event => {
            const button = (event.target as HTMLElement).closest<HTMLElement>("[data-decision-tick]");
            if (button) focusedTick.current = Number(button.dataset.decisionTick);
          }}
          onBlurCapture={event => {
            if (event.relatedTarget instanceof Node && !event.currentTarget.contains(event.relatedTarget)) focusedTick.current = null;
          }}
        >
          <caption>Recorded decisions through tick {latestTick} · {policy.shortName} rules-demo mirror</caption>
          <thead><tr><th scope="col">Tick</th><th scope="col">Action</th><th scope="col">Outcome</th></tr></thead>
          <tbody>
            {rows.map(turn => {
              const decision = turn.stalls[policyIndex]!;
              const isPinned = selected === policyIndex && pinned === turn.tick;
              return (
                <tr
                  key={turn.tick}
                  className={isPinned ? styles.pinned : undefined}
                  onClick={() => onSelectDecision(policyIndex, turn.tick)}
                >
                  <th scope="row">
                    <button
                      type="button"
                      data-decision-tick={turn.tick}
                      aria-label={`Inspect ${policy.name} decision at tick ${turn.tick}`}
                      aria-pressed={isPinned}
                      onClick={event => { event.stopPropagation(); onSelectDecision(policyIndex, turn.tick); }}
                    >
                      {String(turn.tick).padStart(3, "0")}
                    </button>
                  </th>
                  <td className={styles.action}>{decision.action}<small>{decision.validation === "forced-wait" ? "Forced WAIT" : "Valid local rules"}</small></td>
                  <td>{decision.consequence}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {rows.length === 0 && <p className={styles.empty}>No {action === "all" ? "recorded" : action} decisions through tick {latestTick}. Choose another action or advance the replay.</p>}
      </div>

      <div {...panelProps("Benchmarks")}>
        <div className={styles.benchmarks}>
          <div>
            <h3>Model benchmarks unavailable</h3>
            <p>No model inference or provider benchmark results are included in this replay.</p>
            <p>The three named stalls mirror one recorded local rules policy. Match shows its cumulative results alongside the separate Rules baseline.</p>
            <a href="/demo.json" download="hawker-wars-offline-rules-data.json">Download recorded rules data</a>
          </div>
          <dl>
            <div><dt>Replay schema</dt><dd>{data.schemaVersion}</dd></div>
            <div><dt>Rules policy</dt><dd>{data.baselineVersion}</dd></div>
            <div><dt>Simulation</dt><dd>{data.simulationVersion}</dd></div>
            <div><dt>Scorer</dt><dd>{data.scorerVersion}</dd></div>
            <div><dt>Recording</dt><dd>{scenario.title}</dd></div>
          </dl>
        </div>
      </div>
    </section>
  );
}

export default AnalysisTabs;
