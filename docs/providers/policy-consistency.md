# Four-policy comparison consistency

Rules, Jev, Zoom Standard and Zoom Pro use the same simulator, starting state,
base demand schedule, legal-action calculation and scoring function. Each has
its own stall: observations can diverge after different actions, and promotions
can create additional arrivals according to the same shared mechanics.

The objective is final utility, including profit, abandonment, waiting and waste.
Profit is also reported separately for every policy. Provider API charges do not
change either game score. The rules baseline remains frozen `rules-1`; it uses
current observable state and legal actions, with no access to future arrivals.
It does not consume a natural-language prompt.

Prompt `hawker-decision-prompt-2` gives all three models byte-identical semantic
context and question instructions for the same input. Each legal choice now has
its action mechanics repeated beside the question, including restock cost and
delay and WAIT's lack of direct action. Descriptions come from the same action
text already included in the context. No model receives special restock advice,
a preferred answer, a forced action override or hidden schedule information.
Provider-specific JSON envelopes retain the documented wire shapes.

The adapter bypasses inference for sole WAIT for every model. When RESTOCK and
WAIT are both legal, both remain selectable. Equal decisions across all four
policies must produce equal state and scores; the full-round regression also
checks equal model observations and choices when their prior actions match.

The prompt version is included in live provider configuration identity, so a
worker cannot silently resume an old round under new instructions. The completed
2026-10-24 campaign used prompt version 1 and remains historical evidence. Version
2 has offline validation only; no new paid campaign or deployment is implied.
