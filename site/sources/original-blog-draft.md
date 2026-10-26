# Hawker Wars: Evaluating Decision Models in a Simulated Lunch Service

Benchmarks help us compare models on standardized tasks. A simulation asks a complementary question: what happens when a model’s decisions change the conditions it faces next?

Hawker Wars explores this through a simulated chicken rice stall. Jev, Zoom Decisions, and Zoom Decisions Pro choose actions during lunch service, managing inventory, cooking, customer queues, and promotions.

The goal is to understand how these models behave in this particular environment—and how the way we present decisions affects their choices.

### What the simulation measures

Each model controls an independent stall and selects from the available legal actions: RESTOCK, COOK, SERVE, PROMOTE, and WAIT.

Actions have delayed consequences. Ingredients take time to arrive, cooking takes time, customers lose patience, and prepared food can expire. A useful decision therefore depends on both the current state and what can happen before closing.

The simulation records profit, customers served, food waste, and a defined utility score that also accounts for abandonment and waiting time. These measures capture different aspects of performance. Serving more customers does not necessarily produce higher profit or less waste.

Hawker Wars evaluates the complete configuration: the model, prompt, supplied observation, action interface, and execution rules. Results should be interpreted at that level.

### The evaluation journey

The initial experiments established a working comparison against a fixed rules policy. Subsequent experiments examined whether more explicit instructions changed behavior.

Prompt v2 clarified action consequences, including delivery delays, cooking time, customer patience, and closing inventory value. All model paths received equivalent semantic information through their respective interfaces.

In the earlier clean-seed-7 comparison, Zoom Decisions and Zoom Decisions Pro recorded higher profit with v2. Jev’s profit and service count remained unchanged. The rules baseline reproduced the same trajectory.

Those observations motivated further investigation, but one run per prompt cannot separate the effect of the prompt from variation in model responses. They are historical results from that configuration, rather than a general ranking. [Earlier prompt comparison](https://github.com/jenzushsu/hawker-wars/blob/main/docs/deployment/prompt-v2-comparison.md)

### Investigating a repeated decision

In one earlier Jev run, the model repeatedly selected WAIT during a stockout while RESTOCK remained legal. The recorded observation included cash, remaining time, inventory, and pending-order information.

The repeated WAIT choices were accepted responses. A separate probability-validation error occurred earlier, but did not explain the later sequence.

This identifies behavior worth investigating. It does not establish the model’s internal reasoning or a general inability to plan. Possible influences include the prompt, state representation, decision interface, and the specific trajectory.

Timing also matters: replenishment may help future customers even when it cannot save the current queue. Near closing, the same action may offer no service benefit. [Recorded investigation](https://github.com/jenzushsu/hawker-wars/blob/main/docs/deployment/jev-investigation.md)

### From individual actions to supplied plans

Follow-up diagnostics changed how the decision was presented.

First, expanded instructions described a future-service horizon and the sequence RESTOCK → COOK → SERVE. Jev continued selecting WAIT in the captured early-stockout examples.

A later diagnostic offered two complete conditional plans: replenish immediately and then cook and serve, or wait ten turns before following the same plan.

At the early stockout state, all three models selected immediate replenishment. Jev’s choice therefore changed when the task changed from selecting an individual action to selecting a supplied plan.

This demonstrates sensitivity to decision framing. Several features changed together, so the experiment cannot identify which caused the difference. The plans were not executed, and no improvement in full-service performance was measured. A late-closing control also showed why a strong preference alone does not establish correct timing judgments. [Planning diagnostic](https://github.com/jenzushsu/hawker-wars/blob/main/docs/deployment/planning-experiment.md), [supplied-plan diagnostic](https://github.com/jenzushsu/hawker-wars/blob/main/docs/deployment/short-plan-experiment.md)

### Latest reported scenario results

The latest scenario results supplied for this article show a different balance:

| Model | Profit | Customers served | Portions wasted |
|---|---:|---:|---:|
| Jev 1.13.0 | $241 | 85 | 7 |
| Zoom Decisions | $221 | 102 | 40 |
| Zoom Decisions Pro | $246 | 98 | 24 |

Zoom Decisions Pro recorded the highest profit, $5 ahead of Jev. Zoom Decisions served the most customers, while Jev wasted the fewest portions.

These totals show tradeoffs rather than a single winner across every measure. Without the corresponding action traces, they do not explain which decisions caused those differences.

*Before publication, attach the run evidence and specify its scenario, seed, prompt version, exact model versions, and any fallbacks. These figures have not been independently verified here and should remain separate from the earlier seed-7 experiments.*

### Relationship to Contested Fast Decisions

[Contested Fast Decisions](https://huggingface.co/datasets/zoom-ai/contested-fast-decisions) evaluates difficult operational classifications, including routing and triage. Its 818 decisions were selected through model disagreement and subsequently relabelled and adjudicated. Performance is measured by exact agreement with reference label sets.

Hawker Wars asks a different, complementary question.

| Contested Fast Decisions | Hawker Wars |
|---|---|
| Classify supplied text | Choose actions in an evolving simulation |
| Evaluate independent decisions | Evaluate sequences and their consequences |
| Measure reference-label accuracy | Measure defined operational outcomes |

Accuracy on classification tasks does not, by itself, establish performance in sequential control. Likewise, a Hawker Wars result does not confirm or contradict the classification benchmark’s findings.

The protocols, tasks, metrics, and potentially model versions differ. Establishing a relationship would require matched versions and a broader, repeated evaluation.

### Related evaluations

Using simulations and games to evaluate models has established precedents. **Vending-Bench 2** studies sustained business operation, **InventoryBench** examines inventory decisions and combinations of language models with operations research, and **BALROG** evaluates agents across game environments. A community **System One Arena** evaluation also tests Jev 1.13 and other decision models in games. These provide methodological context, without making their scores directly comparable to Hawker Wars. [Vending-Bench 2](https://andonlabs.com/evals/vending-bench-2), [InventoryBench](https://tianyipeng.github.io/InventoryBench/), [BALROG](https://balrogai.com/index.html), [System One Arena](https://crewshal.com/benchmarks/system-one-arena)

### Conclusion

Hawker Wars is an exploratory evaluation of decision models under a specific simulation and interface. Its results describe observed behavior within that setup.

The experiments suggest that prompt and decision framing deserve careful attention. Selecting an immediate action, choosing a supplied plan, and executing a successful sequence are distinct tasks.

A stronger next evaluation would compare those approaches across repeated, held-out scenarios, alongside rules and planning baselines. That would help establish where each model configuration performs well, where it needs support, and whether those findings generalize beyond an individual run.
