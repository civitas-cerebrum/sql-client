import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SqlClient } from '../../src/client/SqlClient';
import { runUseCases } from './use-cases';
import { runLookups } from './lookups';
import { runBuilderCases } from './builder-cases';

const ORACLE_TEST_URL = process.env.ORACLE_TEST_URL ?? 'oracle://bookhive:bookhive@localhost:1521/FREEPDB1';

/**
 * Split an Oracle SQL file into individual statements.
 * The oracle schema uses '/' as a statement terminator (on its own line)
 * to allow PL/SQL blocks (BEGIN...END) as well as plain DDL/DML.
 */
function splitOracleSql(sql: string): string[] {
    return sql
        .split(/\n\/\s*\n?/)
        .map((s) => s.trim())
        .filter(Boolean);
}

async function main() {
    // Bootstrap: apply schema (PL/SQL drop blocks + DDL) and seed.
    const client = new SqlClient({ engine: 'oracle', connectionString: ORACLE_TEST_URL });

    const schemaPath = join(__dirname, '../sql/oracle.schema.sql');
    const seedPath = join(__dirname, '../sql/oracle.seed.sql');
    for (const filePath of [schemaPath, seedPath]) {
        const sql = readFileSync(filePath, 'utf8');
        for (const stmt of splitOracleSql(sql)) {
            await client.execute(stmt);
        }
    }

    await runUseCases(client);
    await runLookups(client);
    await runBuilderCases(client);
    await client.end();
    console.log('integration/oracle.test.ts PASSED');
}

main().catch((e) => { console.error(e); process.exit(1); });
