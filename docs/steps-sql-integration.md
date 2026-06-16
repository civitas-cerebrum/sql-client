# Activating `sql-client` across the achilles QA methodology

**Status:** design / activation plan. Cross-repo (`sql-client` → `element-interactions` → `achilles`).
**Author:** generated 2026-06-16.

## TL;DR

The database-verification layer the achilles methodology specifies is **already built, not missing** — it is just *unreleased* and running on an older `sql-client`. `element-interactions@0.3.7` (unreleased) fully implements the `steps.sql*` surface over `sql-client@^0.1.0`; the achilles `database-testing` skill is the dormant consumer whose "not shipped in `^0.3.6`" banner is **release skew**, not absent code. The work is therefore a *release-and-adopt* sequence plus incremental methodology enhancements — not a from-scratch build.

## How the framework wraps an engine (the precedent)

`element-interactions` exposes external engines through the `Steps` API + `baseFixture`, one client per named provider:

| Concern | HTTP (live) | SQL (built, unreleased) |
|---|---|---|
| Backing package | `@civitas-cerebrum/wasapi` | **`@civitas-cerebrum/sql-client`** |
| Steps methods | `apiGet/Post/Put/Delete/Patch/Head`, `verifyApi*` | `sqlQuery/sqlExecute/sqlTransaction/sqlSelect/Insert/Update/Delete`, `verifySql*` |
| Fixture options | `apiBaseUrl`, `apiProviders` | `dbUrl`, `dbProviders` |
| Provider registry | `Map<string, WasapiClient>` | `Map<string, SqlClient>` |
| Teardown | (pool lifecycle) | `steps.closeDbConnections()` |
| Methodology skill | `contract-testing` (live) | `database-testing` (dormant — release skew) |

The two verification companions are structural twins. The SQL twin's code exists in `element-interactions/src/steps/CommonSteps.ts` and typechecks clean; the `database-testing` skill's method list matches it exactly.

## Current state (verified 2026-06-16)

- `sql-client`: `0.1.1` (PR #3 green, awaiting merge + tag/publish). `0.1.0` is published.
- `element-interactions`: `0.3.7` on branch `feat/0.3.7-integrity`, **unreleased**. Depends on `sql-client@^0.1.0`. `steps.sql*` + `verifySql*` complete; CI starts SQL fixture DBs.
- `achilles`: depends on `element-interactions@^0.3.6` (range accepts `0.3.7`). `database-testing` skill present but gated dormant by a Phase-0 preflight + "not shipped" banner.

## Activation sequence (critical path — order matters)

Do **not** flip the achilles gate before `element-interactions` ships, or achilles installs would still resolve a version without `steps.sql*` and the skill would lie.

1. **Publish `sql-client@0.1.1`** (merge PR #3, tag `v0.1.1`). Unblocks the adoption in step 2.
2. **`element-interactions`: bump `sql-client` to `^0.1.1`** and adopt the high-value `0.1.1` primitives in the `steps.sql*` layer (see next section). Re-run the SQL fixture specs.
3. **Release `element-interactions@0.3.7`.**
4. **`achilles`: bump the floor to `element-interactions@^0.3.7`** and flip `database-testing` from dormant to live — remove the "not shipped in `^0.3.6`" banner and turn the Phase-0 preflight into a real connectivity check (`steps.ping()`), not a capability gate.

Steps 1–3 are mechanical; step 4 is what actually raises the QA agent's ceiling.

## `0.1.1` adoption in the `steps.sql*` layer

The built surface targets `sql-client@0.1.0` and predates features we added in `0.1.1` that map directly onto framework needs:

| `0.1.1` feature | Use in `element-interactions` / methodology |
|---|---|
| `client.ping()` | Real Phase-0 preflight + a fail-fast fixture readiness check (replaces the dormant capability gate). |
| `client.runScript()` / `splitSqlScript()` | A `steps.sqlSeed(file)` / fixture helper that loads `schema.sql`/`seed.sql` — fills onboarding's **missing data-seeding step**. |
| `connectTimeoutMs` | Fixture-level fail-fast so a wrong `dbUrl` errors clearly in CI instead of hanging. |
| Typed `Row<T>` + numeric-aware matchers | Stronger internals for `verifySqlValue`/`verifySqlContains` (engine numeric/UPPERCASE quirks already absorbed). |
| `transaction()` carrying the dialect | A `withRollback` test-isolation wrapper (seed → assert → auto-rollback per test). |
| `sql` tagged template | Optional ergonomic for inline parametrised SQL in specs. |

## Entrypoints — define SQL as a first-class peer of contract-testing

Each verification companion should be reachable on three symmetric paths. Today contract-testing isn't even in the orchestrator's explicit intent-routing block; SQL should be added as a documented peer:

| Path | `contract-testing` | `database-testing` |
|---|---|---|
| **Intent** | "verify the API shape", "lock the contract" | "verify DB state", "assert the row persisted", "check the table" |
| **Method auto-trigger** | spec emits `steps.api*` / `steps.verifyApi*` | spec emits `steps.sql*` / `steps.verifySql*` |
| **Cross-skill invocation** | `test-composer` Step-3, `coverage-expansion`, `bug-discovery` | same callers, whenever a variant touches persisted state |

Ownership boundary (already stated correctly in the `sql-client` skill): inside framework specs → `steps.sql*` → `database-testing`; fixtures / seed scripts / the `steps.sql*` implementation / non-framework projects → `sql-client` directly.

## Per-phase enhancement roadmap (the capacity gains)

Beyond activation, these deepen the methodology. Marked by build state and priority.

| # | Phase | Enhancement | State | Priority |
|---|---|---|---|---|
| 1 | Coverage-expansion / test-composer | **L3 DB oracle** — the oracle ladder already specifies "L3 when a DB is configured AND `steps.sql*` has shipped" for P0 mutating steps. Activation makes this clause live; enforce it in the composer reviewer. | clause exists, gated | **P0** |
| 2 | Groundwork (Ph 2) / setup | **DB seeding helper** via `runScript()` — onboarding has no data-seeding step today. | unbuilt | **P0** |
| 3 | Coverage-expansion | **Cleanup verification** — `cleanupViaApiBackdoor()` never confirms deletion; a DB oracle proves teardown actually removed the row. | unbuilt | P1 |
| 4 | Journey-mapping (Ph 4) | **Data-layer map** — light `information_schema`/FK introspection (already in `database-testing` Phase 1) surfaces entities + cascade flows that UI crawling misses. | partial (in skill) | P1 |
| 5 | Bug-discovery (Ph 6) | **DB adversarial probes** — orphaned rows, FK/constraint races, soft-delete leakage, rollback integrity. Invisible from UI/API. | unbuilt | P1 |
| 6 | Report (Ph 8) | **Persistence-coverage tier** in the summary deck ("N P0 journeys verified at the DB layer"). | unbuilt | P2 |
| 7 | Secrets-sweep (Ph 7) | `dbUrl`/`dbProviders` as first-class env extractions. | unbuilt | P2 |

## What this buys the general QA agent

Closes the verification loop: today it proves a thing *looked* right (UI) and *responded* right (API) but not that the system *recorded* the right state. DB verification proves "the order exists with status COMPLETED, inventory decremented, no duplicate written." It also lets the agent **manufacture preconditions** (seed exact state instead of clicking prerequisites — faster, deterministic) and **reach a bug class** (data integrity, races, orphans) it currently cannot.

## Recommended next actions

- **Now:** merge `sql-client` PR #3, tag `v0.1.1`.
- **Then (EI):** bump `sql-client` → `^0.1.1`; wire `ping()` preflight + a `runScript` seed helper; release `0.3.7`.
- **Then (achilles):** floor → `element-interactions@^0.3.7`; flip `database-testing` live (banner + Phase-0); add the symmetric entrypoint routing.
- **Incremental:** roadmap items 1–3 first (highest capacity-per-effort).
