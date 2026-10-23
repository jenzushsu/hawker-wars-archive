"use client";

import { useState } from "react";
import {
  DECISION_STATE_EXAMPLES,
  type DecisionStateStatus,
} from "../../lib/decision-state";
import styles from "./page.module.css";

const labels: Record<DecisionStateStatus, string> = {
  pending: "Pending",
  invalid: "Invalid",
  timeout: "Timeout",
  fallback: "Fallback",
  "missing-usage": "Missing usage",
};
const descriptions: Record<DecisionStateStatus, string> = {
  pending:
    "The example request is waiting for a proposal. There is no accepted action or committed outcome.",
  invalid:
    "The COOK proposal is invalid in this example. It was not accepted, and no fallback or committed outcome is shown.",
  timeout:
    "The example request timed out before a proposal arrived. No action or committed outcome is shown.",
  fallback:
    "The COOK proposal was rejected in this example. A separate rules fallback supplies WAIT; it is not an accepted model proposal.",
  "missing-usage":
    "The SERVE proposal is accepted in this example, while native usage is unavailable. This does not represent a provider call or measured performance.",
};

export default function DecisionStateExamples() {
  const [status, setStatus] = useState<DecisionStateStatus>("pending");
  const example = DECISION_STATE_EXAMPLES.find(
    (item) => item.status === status,
  )!;
  const label = labels[status];
  const source = {
    none: "No action source",
    rules: "Rules fallback (example)",
    model: "Model proposal (example)",
  }[example.source];
  return (
    <main className={styles.examples}>
      <nav className={styles.navigation} aria-label="Example page navigation">
        <a className={styles.wordmark} href="/">
          HAWKER WARS
        </a>
        <a href="/">Back to replay</a>
      </nav>
      <header className={styles.header}>
        <h1>Decision state examples</h1>
        <p id="examples-disclosure" className={styles.disclosure}>
          Presentation examples only. No provider call or recorded result.
        </p>
        <p>
          Explore how the decision inspector distinguishes a proposal, an
          accepted action and a rules fallback. These examples are separate from
          the replay and do not change its decisions, scores or playback.
        </p>
      </header>
      <div className={styles.controls}>
        <label>
          Decision state
          <select
            value={status}
            aria-describedby="examples-disclosure"
            onChange={(event) => {
              const next = event.target.value;
              if (DECISION_STATE_EXAMPLES.some((item) => item.status === next))
                setStatus(next as DecisionStateStatus);
            }}
          >
            {DECISION_STATE_EXAMPLES.map((item) => (
              <option key={item.status} value={item.status}>
                {labels[item.status]}
              </option>
            ))}
          </select>
        </label>
        <p
          className={styles.announcement}
          role="status"
          aria-live="polite"
          aria-atomic="true"
        >
          Showing {label} example.
        </p>
      </div>
      <article
        className={styles.inspector}
        data-decision-state={status}
        aria-labelledby="example-title"
      >
        <header>
          <h2 id="example-title">{label} decision</h2>
          <p>{descriptions[status]}</p>
        </header>
        <div className={styles.sections}>
          <section aria-labelledby="action-heading">
            <h3 id="action-heading">Action and outcome</h3>
            <dl>
              <dt>Policy</dt>
              <dd>{example.policyLabel}</dd>
              <dt>Proposed action</dt>
              <dd>{example.proposal ?? "Not available"}</dd>
              <dt>Accepted action</dt>
              <dd>{example.acceptedAction ?? "None"}</dd>
              <dt>Fallback action</dt>
              <dd>{example.fallbackAction ?? "None"}</dd>
              <dt>Decision source</dt>
              <dd>{source}</dd>
              <dt>Outcome</dt>
              <dd>
                {example.outcome.status === "pending" ? (
                  "Pending — no committed outcome"
                ) : (
                  <>
                    Committed in this example
                    <span>{example.outcome.summary}</span>
                  </>
                )}
              </dd>
            </dl>
          </section>
          <section aria-labelledby="availability-heading">
            <h3 id="availability-heading">Available information</h3>
            <dl>
              <dt>Native usage</dt>
              <dd className={styles.unavailable}>
                Not available
                <span>
                  No usage was supplied for this presentation example.
                </span>
              </dd>
              <dt>Cost</dt>
              <dd className={styles.unavailable}>
                Unknown
                <span>A cost cannot be calculated without native usage.</span>
              </dd>
              <dt>Explanation</dt>
              <dd className={styles.unavailable}>
                Not supplied<span>No model reasoning is included.</span>
              </dd>
            </dl>
          </section>
        </div>
      </article>
      <p className={styles.footer}>
        A missing value stays unavailable. It is not treated as zero usage, zero
        cost or evidence of a successful decision. No scores are assigned to
        these examples.
      </p>
    </main>
  );
}
