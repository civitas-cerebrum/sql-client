import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SqlClient } from '../../src/client/SqlClient';
import { runUseCases } from './use-cases';
import { runLookups } from './lookups';
import { runBuilderCases } from './builder-cases';
import { runDbCoverage } from './db-coverage';

const ORACLE_TEST_URL = process.env.ORACLE_TEST_URL ?? 'oracle://bookhive:bookhive@localhost:1521/FREEPDB1';

async function main() {
    // Bootstrap: apply schema (PL/SQL drop blocks + DDL, '/'-terminated) and seed.
    const client = new SqlClient({ engine: 'oracle', connectionString: ORACLE_TEST_URL });

    const schemaPath = join(__dirname, '../sql/oracle.schema.sql');
    const seedPath = join(__dirname, '../sql/oracle.seed.sql');
    for (const filePath of [schemaPath, seedPath]) {
        await client.runScript(readFileSync(filePath, 'utf8'));
    }

    await runUseCases(client);
    await runLookups(client);
    await runBuilderCases(client);
    await runDbCoverage(client);
    await client.end();
    console.log('integration/oracle.test.ts PASSED');
}

main().catch((e) => { console.error(e); process.exit(1); });
