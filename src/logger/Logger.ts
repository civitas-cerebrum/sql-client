import debug from 'debug';

/** Root namespace for all sql-client debug logging. Enable with DEBUG=sql:* */
export const log = debug('sql');

/** Create a child logger, e.g. createLogger('client') → DEBUG=sql:client */
export function createLogger(namespace: string): debug.Debugger {
    return log.extend(namespace);
}
