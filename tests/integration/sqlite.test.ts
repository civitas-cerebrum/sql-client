import { readFileSync } from 'node:fs';
import { SqlClient } from '../../src/client/SqlClient';
import { runUseCases } from './use-cases';
import { runLookups } from './lookups';
import { runBuilderCases } from './builder-cases';

async function main() {
    const db = new SqlClient({ engine: 'sqlite', connectionString: ':memory:' });

    // Bootstrap: load schema + seed into the in-memory database.
    // Split on ';\n' — statements are simple; no embedded semicolons outside string literals.
    for (const file of ['tests/sql/sqlite.schema.sql', 'tests/sql/sqlite.seed.sql']) {
        const sql = readFileSync(file, 'utf8');
        for (const stmt of sql.split(/;\s*\n/).map((s) => s.trim()).filter(Boolean)) {
            await db.execute(stmt);
        }
    }

    await runUseCases(db);
    await runLookups(db);
    await runBuilderCases(db);
    await db.end();
    console.log('integration/sqlite.test.ts PASSED');
}

main().catch((e) => { console.error(e); process.exit(1); });
