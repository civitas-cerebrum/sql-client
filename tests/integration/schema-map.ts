/**
 * Database Coverage Workflow — Phase 1 (introspect) + Phase 2 (matrix).
 *
 * The engine of the `schema-mapping` capability from docs/db-coverage-skill-spec.md,
 * proven here against bookhive on all five engines. It reads the live catalog
 * (no prior schema knowledge), normalizes it into a SchemaInventory, and derives
 * the coverage matrix whose denominators make "exhaustive" checkable (guarantee G1).
 *
 * This is library-shaped (introspectSchema / deriveCoverageMatrix / formatMatrixReport)
 * so it transplants directly into the achilles skill, where it would run via
 * steps.sql*. `runSchemaMap(client)` asserts the bookhive shape per engine.
 *
 * Cross-engine notes: catalog sources differ (information_schema vs PRAGMA vs
 * USER_* views) and Oracle folds names to UPPERCASE, so every identifier is
 * lower-cased into the inventory for engine-neutral comparison.
 */

import assert from 'node:assert/strict';
import { SqlClient } from '../../src/client/SqlClient';
import { rows } from '../../src/result/ResultSet';

export interface ColumnInfo { name: string; nullable: boolean; }
export interface ForeignKey { column: string; refTable: string; refColumn: string; }
export interface TableInfo {
    name: string;
    columns: ColumnInfo[];
    primaryKey: string[];      // PK columns — exercised via CRUD, not dup-tested
    uniqueColumns: string[];   // single-column UNIQUE constraints (PK excluded)
    foreignKeys: ForeignKey[];
}
export interface SchemaInventory { tables: TableInfo[]; }

const lc = (v: unknown): string => String(v).toLowerCase();

// ---------------------------------------------------------------------------
// Phase 1 — introspection (per engine)
// ---------------------------------------------------------------------------

export async function introspectSchema(client: SqlClient): Promise<SchemaInventory> {
    switch (client.engine) {
        case 'sqlite': return introspectSqlite(client);
        case 'postgres': return introspectInformationSchema(client, 'public');
        case 'mssql': return introspectInformationSchema(client, 'dbo');
        case 'mysql': return introspectMysql(client);
        case 'oracle': return introspectOracle(client);
        default: throw new Error(`introspectSchema: unsupported engine ${client.engine}`);
    }
}

/** SQLite: sqlite_master + PRAGMA (table names are our own, safe to inline). */
async function introspectSqlite(client: SqlClient): Promise<SchemaInventory> {
    const tableRows = rows(await client.query(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`)).column('name').map(lc);
    const tables: TableInfo[] = [];
    for (const name of tableRows) {
        const cols = rows(await client.query(`PRAGMA table_info('${name}')`)).all();
        const columns: ColumnInfo[] = cols.map((r) => ({ name: lc(r.get('name')), nullable: Number(r.get('notnull')) === 0 }));
        const pkCols = cols.filter((r) => Number(r.get('pk')) > 0).map((r) => lc(r.get('name')));
        const fks = rows(await client.query(`PRAGMA foreign_key_list('${name}')`)).all()
            .map((r) => ({ column: lc(r.get('from')), refTable: lc(r.get('table')), refColumn: lc(r.get('to')) }));
        const uniqueColumns = new Set<string>();
        for (const idx of rows(await client.query(`PRAGMA index_list('${name}')`)).all()) {
            if (Number(idx.get('unique')) !== 1) continue;
            const idxCols = rows(await client.query(`PRAGMA index_info('${idx.get('name')}')`)).column('name').map(lc);
            if (idxCols.length === 1 && !pkCols.includes(idxCols[0])) uniqueColumns.add(idxCols[0]);
        }
        tables.push({ name, columns, primaryKey: pkCols, uniqueColumns: [...uniqueColumns], foreignKeys: fks });
    }
    return { tables };
}

/** Postgres + SQL Server: ANSI information_schema. */
async function introspectInformationSchema(client: SqlClient, schema: string): Promise<SchemaInventory> {
    const p = (i: number) => client.dialect.placeholder(i);
    const tableNames = rows(await client.query(
        `SELECT table_name FROM information_schema.tables WHERE table_schema = ${p(1)} AND table_type = 'BASE TABLE'`, [schema])).column('table_name').map(lc);
    const colRows = rows(await client.query(
        `SELECT table_name, column_name, is_nullable FROM information_schema.columns WHERE table_schema = ${p(1)}`, [schema])).all();
    // FK introspection via referential_constraints (FK → referenced unique constraint),
    // joining key_column_usage twice by ordinal_position. The simpler constraint_column_usage
    // join is NOT portable: SQL Server returns the *referencing* table there for a FK.
    const fkRows = rows(await client.query(
        `SELECT kcu1.table_name AS t, kcu1.column_name AS c, kcu2.table_name AS rt, kcu2.column_name AS rc
         FROM information_schema.referential_constraints rc
         JOIN information_schema.key_column_usage kcu1 ON kcu1.constraint_name = rc.constraint_name AND kcu1.constraint_schema = rc.constraint_schema
         JOIN information_schema.key_column_usage kcu2 ON kcu2.constraint_name = rc.unique_constraint_name AND kcu2.constraint_schema = rc.unique_constraint_schema AND kcu2.ordinal_position = kcu1.ordinal_position
         WHERE kcu1.table_schema = ${p(1)}`, [schema])).all();
    const uqRows = rows(await client.query(
        `SELECT tc.constraint_name AS cn, tc.table_name AS t, kcu.column_name AS c,
                CASE WHEN tc.constraint_type = 'PRIMARY KEY' THEN 'P' ELSE 'U' END AS kind
         FROM information_schema.table_constraints tc
         JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
         WHERE tc.constraint_type IN ('UNIQUE','PRIMARY KEY') AND tc.table_schema = ${p(1)}`, [schema])).all();
    return assembleInventory(tableNames, colRows, fkRows, uqRows);
}

/** MySQL: information_schema with DATABASE() scope; FK ref columns live on key_column_usage. */
async function introspectMysql(client: SqlClient): Promise<SchemaInventory> {
    const tableNames = rows(await client.query(
        `SELECT table_name FROM information_schema.tables WHERE table_schema = DATABASE() AND table_type = 'BASE TABLE'`)).column('table_name').map(lc);
    const colRows = rows(await client.query(
        `SELECT table_name, column_name, is_nullable FROM information_schema.columns WHERE table_schema = DATABASE()`)).all();
    const fkRows = rows(await client.query(
        `SELECT table_name AS t, column_name AS c, referenced_table_name AS rt, referenced_column_name AS rc
         FROM information_schema.key_column_usage
         WHERE table_schema = DATABASE() AND referenced_table_name IS NOT NULL`)).all();
    const uqRows = rows(await client.query(
        `SELECT index_name AS cn, table_name AS t, column_name AS c,
                CASE WHEN index_name = 'PRIMARY' THEN 'P' ELSE 'U' END AS kind
         FROM information_schema.statistics WHERE table_schema = DATABASE() AND non_unique = 0`)).all();
    return assembleInventory(tableNames, colRows, fkRows, uqRows);
}

/** Oracle: USER_* data-dictionary views; nullable flag is 'Y'/'N'. */
async function introspectOracle(client: SqlClient): Promise<SchemaInventory> {
    const tableNames = rows(await client.query(`SELECT table_name FROM user_tables`)).column('table_name').map(lc);
    const colRows = rows(await client.query(
        `SELECT table_name, column_name, CASE nullable WHEN 'Y' THEN 'YES' ELSE 'NO' END AS is_nullable FROM user_tab_columns`)).all();
    const fkRows = rows(await client.query(
        `SELECT ac.table_name AS t, acc.column_name AS c, rac.table_name AS rt, racc.column_name AS rc
         FROM user_constraints ac
         JOIN user_cons_columns acc ON ac.constraint_name = acc.constraint_name
         JOIN user_constraints rac ON ac.r_constraint_name = rac.constraint_name
         JOIN user_cons_columns racc ON rac.constraint_name = racc.constraint_name AND acc.position = racc.position
         WHERE ac.constraint_type = 'R'`)).all();
    const uqRows = rows(await client.query(
        `SELECT ac.constraint_name AS cn, ac.table_name AS t, acc.column_name AS c, ac.constraint_type AS kind
         FROM user_constraints ac
         JOIN user_cons_columns acc ON ac.constraint_name = acc.constraint_name
         WHERE ac.constraint_type IN ('U','P')`)).all();
    return assembleInventory(tableNames, colRows, fkRows, uqRows);
}

/** Shared assembler for the information_schema-style row shapes. */
function assembleInventory(
    tableNames: string[],
    colRows: Array<{ get(k: string): unknown }>,
    fkRows: Array<{ get(k: string): unknown }>,
    uqRows: Array<{ get(k: string): unknown }>,
): SchemaInventory {
    // Group constraint columns; single-column constraints feed the matrix. PK ('P')
    // and UNIQUE ('U') are tracked separately — PKs are exercised via CRUD, not dup-tested.
    const byConstraint = new Map<string, { table: string; kind: string; cols: string[] }>();
    for (const r of uqRows) {
        const key = `${lc(r.get('t'))}.${lc(r.get('cn'))}`;
        const entry = byConstraint.get(key) ?? { table: lc(r.get('t')), kind: String(r.get('kind')), cols: [] };
        entry.cols.push(lc(r.get('c')));
        byConstraint.set(key, entry);
    }
    const pkByTable = new Map<string, Set<string>>();
    const uniqueByTable = new Map<string, Set<string>>();
    for (const { table, kind, cols } of byConstraint.values()) {
        if (cols.length !== 1) continue;
        const target = kind === 'P' ? pkByTable : uniqueByTable;
        (target.get(table) ?? target.set(table, new Set()).get(table)!).add(cols[0]);
    }
    const fkByTable = new Map<string, ForeignKey[]>();
    for (const r of fkRows) {
        const t = lc(r.get('t'));
        (fkByTable.get(t) ?? fkByTable.set(t, []).get(t)!).push({ column: lc(r.get('c')), refTable: lc(r.get('rt')), refColumn: lc(r.get('rc')) });
    }
    const colsByTable = new Map<string, ColumnInfo[]>();
    for (const r of colRows) {
        const t = lc(r.get('table_name'));
        (colsByTable.get(t) ?? colsByTable.set(t, []).get(t)!).push({ name: lc(r.get('column_name')), nullable: lc(r.get('is_nullable')) === 'yes' });
    }
    return {
        tables: tableNames.map((name) => ({
            name,
            columns: colsByTable.get(name) ?? [],
            primaryKey: [...(pkByTable.get(name) ?? [])],
            uniqueColumns: [...(uniqueByTable.get(name) ?? [])],
            foreignKeys: fkByTable.get(name) ?? [],
        })),
    };
}

// ---------------------------------------------------------------------------
// Phase 2 — coverage matrix derivation
// ---------------------------------------------------------------------------

export interface CoverageMatrix {
    crud: string[];          // one per table
    fkJoins: string[];       // one per FK edge: "table.col->refTable.refCol"
    fkViolations: string[];  // one per FK edge
    uniques: string[];       // "table.col"
    notNull: string[];       // "table.col" for each NOT NULL column
}

export function deriveCoverageMatrix(inv: SchemaInventory): CoverageMatrix {
    const m: CoverageMatrix = { crud: [], fkJoins: [], fkViolations: [], uniques: [], notNull: [] };
    for (const t of inv.tables) {
        m.crud.push(t.name);
        for (const fk of t.foreignKeys) {
            const edge = `${t.name}.${fk.column}->${fk.refTable}.${fk.refColumn}`;
            m.fkJoins.push(edge);
            m.fkViolations.push(edge);
        }
        for (const u of t.uniqueColumns) m.uniques.push(`${t.name}.${u}`);
        for (const c of t.columns) if (!c.nullable) m.notNull.push(`${t.name}.${c.name}`);
    }
    return m;
}

// ---------------------------------------------------------------------------
// Phase 8 — report formatter (markdown)
// ---------------------------------------------------------------------------

export function formatMatrixReport(engine: string, m: CoverageMatrix): string {
    const cat = (name: string, cells: string[]) => `- **${name}**: ${cells.length} required cell${cells.length === 1 ? '' : 's'}`;
    return [
        `### Coverage matrix — ${engine}`,
        cat('CRUD round-trips', m.crud),
        cat('FK joins', m.fkJoins),
        cat('FK violations', m.fkViolations),
        cat('UNIQUE rejections', m.uniques),
        cat('NOT NULL rejections', m.notNull),
        `- **Total required cells**: ${m.crud.length + m.fkJoins.length + m.fkViolations.length + m.uniques.length + m.notNull.length}`,
    ].join('\n');
}

// ---------------------------------------------------------------------------
// Verification — bookhive shape, per engine
// ---------------------------------------------------------------------------

export async function runSchemaMap(client: SqlClient): Promise<void> {
    const inv = await introspectSchema(client);
    const tableNames = inv.tables.map((t) => t.name).sort();

    // SM-1: all six bookhive tables discovered (exactly).
    assert.deepEqual(tableNames, ['books', 'cart_items', 'marketplace_listings', 'order_items', 'orders', 'users'],
        `SM-1: introspected tables mismatch (got ${tableNames.join(', ')})`);

    // SM-2: every expected FK edge discovered.
    const edges = new Set(inv.tables.flatMap((t) => t.foreignKeys.map((fk) => `${t.name}.${fk.column}->${fk.refTable}.${fk.refColumn}`)));
    for (const edge of [
        'orders.user_id->users.user_id',
        'order_items.order_id->orders.order_id',
        'order_items.book_id->books.book_id',
        'cart_items.user_id->users.user_id',
        'cart_items.book_id->books.book_id',
        'marketplace_listings.seller_id->users.user_id',
        'marketplace_listings.book_id->books.book_id',
    ]) {
        assert.ok(edges.has(edge), `SM-2: FK edge not introspected: ${edge} (found: ${[...edges].join(', ')})`);
    }

    // SM-3: every expected single-column UNIQUE discovered.
    const uniques = new Set(inv.tables.flatMap((t) => t.uniqueColumns.map((c) => `${t.name}.${c}`)));
    for (const u of ['books.isbn', 'users.username', 'users.email']) {
        assert.ok(uniques.has(u), `SM-3: UNIQUE not introspected: ${u} (found: ${[...uniques].join(', ')})`);
    }

    // SM-4: explicitly-declared NOT NULL columns discovered. book_id (PK) is excluded:
    // SQLite reports a non-INTEGER PRIMARY KEY as notnull=0, so PK-ness is asserted via
    // SM-3-style uniques, not here — this keeps the assertion engine-neutral.
    const booksNotNull = inv.tables.find((t) => t.name === 'books')!.columns.filter((c) => !c.nullable).map((c) => c.name).sort();
    for (const col of ['author', 'genre', 'price', 'stock', 'title']) {
        assert.ok(booksNotNull.includes(col), `SM-4: books.${col} should be NOT NULL (got ${booksNotNull.join(', ')})`);
    }
    // book_id is the PK → tracked separately from UNIQUE constraints on every engine.
    assert.ok(inv.tables.find((t) => t.name === 'books')!.primaryKey.includes('book_id'), `SM-4: books.book_id should be the primary key`);

    // SM-5: the derived matrix has the expected denominators.
    const m = deriveCoverageMatrix(inv);
    assert.equal(m.crud.length, 6, `SM-5: CRUD denominator should be 6 tables`);
    assert.equal(m.fkViolations.length, 7, `SM-5: FK denominator should be 7 edges`);
    assert.equal(m.uniques.length, 3, `SM-5: UNIQUE denominator should be 3 (isbn, username, email; PKs excluded)`);
    assert.ok(m.notNull.length >= 20, `SM-5: NOT NULL denominator should be >= 20 columns (got ${m.notNull.length})`);

    if (process.env.DB_COVERAGE_REPORT) console.log('\n' + formatMatrixReport(client.engine, m) + '\n');
}

// ---------------------------------------------------------------------------
// Phase 8 — coverage ledger + report (numerator vs the matrix denominator)
// ---------------------------------------------------------------------------

export type MatrixCategory = keyof CoverageMatrix;

/**
 * Records which matrix cells the running test suite actually exercises. Coverage
 * is claimed only by calling `cover()` from a test that ran — so the numerator is
 * tied to execution, and a removed test drops its claim automatically.
 */
export class CoverageLedger {
    private readonly covered: Record<MatrixCategory, Set<string>> = {
        crud: new Set(), fkJoins: new Set(), fkViolations: new Set(), uniques: new Set(), notNull: new Set(),
    };
    cover(category: MatrixCategory, cell: string): void { this.covered[category].add(cell); }
    has(category: MatrixCategory, cell: string): boolean { return this.covered[category].has(cell); }
}

export interface CategoryCoverage { covered: number; total: number; uncovered: string[]; }
export type CoverageReport = Record<MatrixCategory, CategoryCoverage>;

/** Cross-reference the ledger (numerator) against the derived matrix (denominator). */
export function reportCoverage(matrix: CoverageMatrix, ledger: CoverageLedger): CoverageReport {
    const categories = Object.keys(matrix) as MatrixCategory[];
    const out = {} as CoverageReport;
    for (const cat of categories) {
        const uncovered = matrix[cat].filter((cell) => !ledger.has(cat, cell));
        out[cat] = { covered: matrix[cat].length - uncovered.length, total: matrix[cat].length, uncovered };
    }
    return out;
}

export function formatCoverageReport(engine: string, report: CoverageReport): string {
    const line = (name: string, c: CategoryCoverage) =>
        `- **${name}**: ${c.covered}/${c.total}` + (c.uncovered.length ? ` — uncovered: ${c.uncovered.join(', ')}` : ' ✓');
    return [
        `### Coverage report — ${engine}`,
        line('CRUD round-trips', report.crud),
        line('FK joins', report.fkJoins),
        line('FK violations', report.fkViolations),
        line('UNIQUE rejections', report.uniques),
        line('NOT NULL rejections', report.notNull),
    ].join('\n');
}

/**
 * Phase 8 — cross-reference a coverage ledger against the live-introspected matrix,
 * print the report (DB_COVERAGE_REPORT=1), and ENFORCE the gate: 100% on the
 * categories the matrix-driven suite owns (crud/fkJoins/fkViolations/uniques) and
 * representative-per-table on NOT NULL (the documented depth policy). A schema
 * change that adds an uncovered table/FK/constraint fails this gate — the
 * convergence discipline the doc-only workflow lacked, enforced in CI.
 */
export async function runCoverageReport(client: SqlClient, ledger: CoverageLedger): Promise<void> {
    const matrix = deriveCoverageMatrix(await introspectSchema(client));
    const report = reportCoverage(matrix, ledger);
    if (process.env.DB_COVERAGE_REPORT) console.log('\n' + formatCoverageReport(client.engine, report) + '\n');

    // SQLite doesn't enforce FKs by default, so FK-violation cases can't run there —
    // exempt that one category on SQLite (documented in db-coverage-workflow.md).
    const gated: MatrixCategory[] = client.engine === 'sqlite'
        ? ['crud', 'fkJoins', 'uniques']
        : ['crud', 'fkJoins', 'fkViolations', 'uniques'];
    for (const cat of gated) {
        assert.equal(report[cat].covered, report[cat].total,
            `coverage gate (${client.engine}): ${cat} ${report[cat].covered}/${report[cat].total} — uncovered: ${report[cat].uncovered.join(', ')}`);
    }
    // NOT NULL: representative-per-table — every table with NOT NULL columns has >= 1 covered.
    const tablesWithNotNull = new Set(matrix.notNull.map((c) => c.split('.')[0]));
    const tablesCovered = new Set(matrix.notNull.filter((c) => ledger.has('notNull', c)).map((c) => c.split('.')[0]));
    for (const t of tablesWithNotNull) {
        assert.ok(tablesCovered.has(t), `coverage gate (${client.engine}): NOT NULL has no covered column for table ${t}`);
    }
}
