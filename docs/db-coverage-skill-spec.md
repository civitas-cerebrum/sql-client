# Capability spec: the `db-coverage` skill

A buildable design for turning the [Database Coverage Workflow](./db-coverage-workflow.md) from a doc
+ manual pass into an **onboarding-grade, orchestrated achilles skill** — and for wiring it so it
*composes* with the UI/API pipeline into coverage neither layer reaches alone.

Status: design spec. Destined for the achilles skill suite; authored here because sql-client is the
backing engine. Depends on the activation plan ([steps-sql-integration](./steps-sql-integration.md)) —
the skill drives tests through the framework's `steps.sql*` surface, which is backed by `sql-client`.

## 1. Positioning — the decomposition map

achilles already decomposes UI coverage into discover → drive → compose → adversarial → verify, each a
skill, gated by a reviewer. The DB analogue reuses that exact shape:

| achilles UI skill | DB analogue | Role |
|---|---|---|
| `journey-mapping` | **`schema-mapping`** (Phases 1–2) | Introspect the live schema → derive the coverage matrix |
| `coverage-expansion` | **`db-coverage`** (this skill) | Drive the matrix to exhaustion, table/relationship by relationship |
| `test-composer` | per-target composer (inside `db-coverage`) | Compose one table's / relationship's test set |
| `bug-discovery` | **adversarial pass** (inside `db-coverage`) | Generate constraint / boundary / concurrency edge cases |
| `database-testing` (exists) | — | The `steps.sql*` verification primitives + DB-as-oracle bridge that everything above emits |
| `workflow-reviewer` | **`db-coverage-reviewer`** | Gate each phase against exit criteria; reject-and-loop |

`database-testing` is the *library*; `db-coverage` is the *orchestrator* that uses it. This mirrors
`coverage-expansion` using `element-interactions`/`test-composer`.

## 2. Guarantees (the definition of done)

What a completed `db-coverage` run mechanically guarantees — its edge over onboarding is that these are
*provable* against a finite, introspected schema, not heuristic:

- **G1 — Matrix completeness.** Every table has a CRUD round-trip; every FK has a join + a violation
  test; every UNIQUE a duplicate-rejection; every NOT NULL column a null-rejection; every column type a
  round-trip; every aggregatable column an aggregate vs a computed expectation. Coverage is reported as
  `covered/total` per category with the denominator taken from introspection — **100% is checkable.**
- **G2 — Cross-engine parity.** The identical suite passes on every configured engine; any
  engine-specific divergence is either handled (with a documented guard) or reported, never silently skipped.
- **G3 — Determinism.** Every assertion derives from a deterministic seed + a *computed* expectation;
  no value is asserted that the suite didn't establish. Rerunnable (mutations cleaned up).
- **G4 — Honest residuals.** Anything not covered (e.g. concurrency anomalies, a deliberately-skipped
  per-column tail) is named in the report with a reason. No "looks covered."

## 3. Phases + the apparatus the doc-only version lacked

| Phase | Adds over the manual pass |
|---|---|
| 1 — **Introspect** | Live `information_schema` / `pragma` / catalog-view reads per engine → a normalized inventory (the manual pass used the *known* schema; the skill discovers it). |
| 2 — **Matrix** | Emit the required-test set as structured data with a denominator; this is the gate's source of truth. |
| 3–6 — **Compose** (CRUD, relationships, constraints, type-fidelity) | Per-target composer subagents, dispatched in parallel where independent (distinct tables ⇒ no write conflict). |
| 5 — **Adversarial (generated)** | An edge-case *generator*, not a static list: boundary/precision/overflow values, NULL/collation semantics, FK/constraint races, transaction-isolation probes — derived from column types + constraints. |
| 7 — **API-surface sweep** | Every `steps.sql*` method exercised live per engine (already prototyped as `runDbCoverage`). |
| 8 — **Parity + report** | A persisted coverage report artifact (`db-coverage-report.md`) + the handover envelope; the reviewer gates on it. |
| (all) | **Iterate-to-convergence:** the reviewer can reject a phase and the orchestrator re-dispatches until the matrix gate passes or the reject cap trips. The manual pass had no loop — which is exactly why residuals slipped. |

## 4. The `db-coverage-reviewer` gate contract

Modeled on achilles `workflow-reviewer` (same verdict vocabulary + reject cap).

**Invocation:** dispatched at each phase handover with the phase's return envelope + the Phase-2 matrix.

**Per-phase exit criteria (the gate):**

| Phase | Approve only if |
|---|---|
| Introspect | Inventory enumerates every table/column/constraint/FK the live catalog reports (count-matched). |
| Matrix | Every inventory element maps to ≥1 planned cell; denominator published. |
| Compose (3,4,6) | Every planned cell of that category is present **and green on every engine**, or carries an authorized skip. |
| Adversarial (5) | Every constraint has a rejection test; generated edges ran; concurrency frontier explicitly scoped. |
| Report (8) | `covered/total` per category matches the matrix; residuals named with reasons; parity holds. |

**Verdict schema** (`db-coverage-reviewer.schema.json`):
```json
{
  "verdict": "approve | reject | escalate",
  "phase": "introspect | matrix | compose | adversarial | report",
  "coverage": { "<category>": { "covered": 0, "total": 0 } },
  "unmet": ["<matrix cell or criterion not satisfied>"],
  "reason": "<one line>",
  "next-action": "<directive for the orchestrator>"
}
```
**Reject cap:** 3 reject cycles per phase (as `workflow-reviewer`); the 4th escalates to the user with the
unmet list — prevents an infinite compose↔reject loop.

## 5. Return-shape schema (handover envelope)

Reuses the achilles composer envelope shape (`composer.schema.json`) so the orchestrator and reviewer
share a contract:
```json
{
  "handover": {
    "role": "db-coverage-compose-<table-or-relationship>",
    "cycle": 1,
    "status": "new-tests-landed | covered-exhaustively | blocked | skipped",
    "next-action": "..."
  },
  "tests-added": 0,
  "coverage": { "<category>": { "covered": 0, "total": 0 } },
  "summary": "<cells covered, engines green, gaps>"
}
```

## 6. Invocation points — how it plugs into the existing pipeline

Two entry modes, mirroring how `contract-testing`/`database-testing` already enter (intent +
method-trigger + cross-skill), per [steps-sql-integration](./steps-sql-integration.md):

1. **Standalone / onboarding phase.** A new **Phase 4.5 — Data-layer coverage** in `onboarding`, gated
   between journey-mapping and coverage-expansion: when a `dbUrl` is configured, run `db-coverage` to
   exhaustively cover the data layer before UI coverage builds on it. Gate: the `db-coverage-reviewer`
   report. When no DB is configured, the phase is a documented skip.
2. **Inside coverage-expansion (the L3 oracle bridge).** When `coverage-expansion`/`test-composer` writes
   a P0/P1 journey that *mutates* state, it invokes the `database-testing` primitives to add the **L3 DB
   oracle** assertion (the activation plan's dormant clause). `db-coverage` owns the *standalone* data-layer
   matrix; the bridge owns *per-journey* persistence verification. Same primitives, two altitudes.

## 7. What this composes into — coverage neither layer reaches alone

- **`db-coverage` alone** proves the data layer is internally correct (contracts, constraints, query
  fidelity) — but is blind to whether the app *uses* it correctly.
- **coverage-expansion alone** proves user flows behave — but its strongest native oracle is L2 (API said
  201, UI showed a toast).
- **Composed:** coverage-expansion drives the action; the DB-as-oracle bridge proves the action *persisted
  the right state* (L3); `db-coverage` separately proves the schema it persisted into is itself sound.
  The closed loop — "the button worked, the API answered, **and** the database now holds exactly the right
  rows with no orphan or duplicate" — is reachable only with both.

## 8. Boundaries & frontiers (the honest ceiling)

- **Out of scope (by design):** system/behavioral correctness — that's the app-driving skills. `db-coverage`
  is a data-**layer** workflow; its system-level value is exclusively as the L3 oracle + data-layer guarantee.
- **Frontier (flagged, not silently skipped):** concurrency / transaction-isolation anomalies (phantom
  reads, lost updates, deadlocks) are hard to test deterministically; the adversarial phase attempts the
  tractable subset and the report names what it could not guarantee.
- **Not an ORM/migration/schema-management tool** — it *reads* the schema, it doesn't own it.

## 9. Build order

1. Land the activation chain (publish `sql-client` 0.1.1 → EI 0.3.7 ships `steps.sql*` → achilles floors
   to `^0.3.7`, `database-testing` goes live). **Prerequisite** — `db-coverage` emits `steps.sql*`.
2. Package `schema-mapping` (introspect + matrix) with the reviewer's matrix contract.
3. Package `db-coverage` orchestrator (compose + adversarial + iterate-to-convergence) reusing the
   `runDbCoverage` prototype as its API-sweep phase.
4. Add `db-coverage-reviewer` + the schemas.
5. Wire the onboarding Phase 4.5 + the coverage-expansion L3 bridge.
