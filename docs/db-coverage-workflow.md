# Database Coverage Workflow

A phased methodology for building **exhaustive, cross-engine** database test coverage — the
data-layer analogue of the achilles `onboarding` suite-building workflow. Each phase has a clear
input, output, and gate; phases run in order, and the whole thing is engine-portable (the same
suite must pass identically on every target engine).

This document is both the methodology *and* a dogfooding record: it is applied to the bookhive
schema inside this package's own integration suite (`tests/integration/`).

## Why a workflow (not just "write some tests")

Ad-hoc DB tests drift toward whatever the author remembered. A phased workflow makes coverage
*derivable from the schema*: every table, relationship, constraint, column type, and client API
method maps to a required test, so "exhaustive" becomes checkable rather than aspirational.

## Phases

| # | Phase | Input | Output | Gate |
|---|---|---|---|---|
| 1 | **Schema inventory** | Live DB or DDL | Tables, columns+types, PK/FK/UNIQUE/NOT-NULL/CHECK | Every table and constraint enumerated |
| 2 | **Coverage matrix** | Phase 1 inventory | The required test set (below), derived mechanically | Each schema element mapped to ≥1 planned test; gaps named |
| 3 | **CRUD round-trips** | Matrix | insert→select-back→update→delete per table, cleaned up | Every table has a rerunnable lifecycle test |
| 4 | **Relationships & analytics** | Matrix | FK joins, GROUP BY/HAVING, window/CTE, subqueries | Every FK exercised by a join; aggregates verified vs known seed |
| 5 | **Constraints & edges (adversarial)** | Matrix | UNIQUE/FK/NOT-NULL violations expect errors; NULL semantics; boundary values; transaction COMMIT/ROLLBACK integrity | Every constraint has a rejection test; rollback leaves no trace |
| 6 | **Type fidelity** | Matrix | Every column type round-trips (NUMERIC scale, TIMESTAMPTZ via `Date`, booleans, large ints) | Each distinct column type asserted, engine quirks absorbed |
| 7 | **API-surface sweep** | Client API | Every public method exercised live (incl. `whereIn`/`whereNull`/`whereNotNull`, `count`/`exists`, `fetch`/`one`/`maybeOne`/`scalar`, the `sql` tag, `runScript`, `ping`) | Every method invoked against each engine, not just the in-memory one |
| 8 | **Cross-engine parity & report** | Phases 3–7 | The same suite on every engine + a coverage report | No engine-specific drift; covered/uncovered named, nothing silently skipped |

The mapping onto `onboarding` is direct: **inventory↔scaffold/groundwork, coverage-matrix↔journey-mapping,
CRUD↔happy-path, relationships+API-sweep↔coverage-expansion, constraints/edges↔bug-discovery,
parity+report↔report.**

## Coverage matrix — derivation rules (Phase 2)

From the inventory, emit:

- **Per table** → a CRUD round-trip (Phase 3) + a type-fidelity check for its column types (Phase 6).
- **Per foreign key** → a JOIN across the relationship (Phase 4) + an FK-violation rejection (Phase 5).
- **Per UNIQUE constraint** → a duplicate-insert rejection (Phase 5).
- **Per NOT NULL column** → a null-insert rejection (Phase 5).
- **Per numeric/aggregatable column** → a SUM/COUNT/AVG with GROUP BY/HAVING against a known seed value (Phase 4).
- **Per client API method** → at least one live invocation per engine (Phase 7).

A test author can then diff *planned* against *present* and report the delta (Phase 8) — that delta is the
honest answer to "are we exhaustive?".

## Engine-portability rules (apply throughout)

- Parametrise via `client.dialect.placeholder(n)` (the `ph()` helper) — never hardcode `$1`/`?`/`@p1`/`:1`.
- Read through `rows()`/`Row` accessors (case-insensitive, type-coercing) — Oracle returns UPPERCASE keys; Postgres/MySQL return NUMERIC as strings.
- Quote reserved-word columns via the builder or the `statusCol`/`conditionCol` helpers (`status` is reserved in T-SQL; `condition` differs across engines).
- Bind timestamps as JS `Date` (the SQLite driver normalises to ISO; native drivers map `Date` themselves).
- Guard engine-specific defaults: **SQLite does not enforce foreign keys** unless `PRAGMA foreign_keys = ON`, and **SQL Server treats two NULLs in a UNIQUE column as duplicates** — note and handle these rather than letting a test pass/fail by accident.

## bookhive application (the spin)

Inventory (Phase 1): 6 tables — `books`, `users`, `orders`, `order_items`, `cart_items`,
`marketplace_listings`; FKs `orders→users`, `order_items→orders,books`, `cart_items→users,books`,
`marketplace_listings→users,books`; UNIQUE on `books.isbn`, `users.username`, `users.email`; NUMERIC(10,2)
money columns; TIMESTAMPTZ timestamps.

Pre-existing coverage (`use-cases.ts`, `lookups.ts`, `builder-cases.ts`) already satisfies Phases 3–4
and 6 well for the 0.1.0 surface. The dogfooding pass (`db-coverage.ts`, `runDbCoverage`) closes the
named gaps: **Phase 7** (the 0.1.1 API surface, previously absent cross-engine) and **Phase 5**
(constraint-violation and transaction-integrity adversarial cases). Remaining exhaustive depth —
full per-table CRUD for the under-covered tables and a complete type-fidelity sweep — is the
documented next pass.
