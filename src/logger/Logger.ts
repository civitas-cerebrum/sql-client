import debug from 'debug';

/** Public logging callable. Structural type so the published d.ts does not depend on "debug"
 *  (whose @types package is a devDependency and would break skipLibCheck:false consumers). */
export type SqlLogger = (fmt: string, ...args: unknown[]) => void;

const root = debug('sql');

/** Root namespace for all sql-client debug logging. Enable with DEBUG=sql:* */
export const log: SqlLogger = root as SqlLogger;

/** Create a child logger, e.g. createLogger('client') → DEBUG=sql:client */
export function createLogger(namespace: string): SqlLogger {
    return root.extend(namespace) as SqlLogger;
}
