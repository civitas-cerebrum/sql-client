import { readFileSync } from 'node:fs';
import { SqlClient } from '../../src/client/SqlClient';
import { runUseCases } from './use-cases';
import { runLookups } from './lookups';
import { runBuilderCases } from './builder-cases';
import { runSchemaMap, runCoverageReport } from './schema-map';
import { runDbCoverage } from './db-coverage';

async function main() {
    const db = new SqlClient({ engine: 'sqlite', connectionString: ':memory:' });

    // Bootstrap: load schema + seed into the in-memory database.
    for (const file of ['tests/sql/sqlite.schema.sql', 'tests/sql/sqlite.seed.sql']) {
        await db.runScript(readFileSync(file, 'utf8'));
    }

    await runUseCases(db);
    await runLookups(db);
    await runBuilderCases(db);
    await runSchemaMap(db);
    const __ledger = await runDbCoverage(db);
    await runCoverageReport(db, __ledger);
    await db.end();
    console.log('integration/sqlite.test.ts PASSED');
}

main().catch((e) => { console.error(e); process.exit(1); });
