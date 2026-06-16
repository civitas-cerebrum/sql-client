import { SqlEngine } from '../models/SqlEngine';

/**
 * Split a multi-statement SQL script into individual executable statements.
 *
 * Single-pass tokenizer: splits on top-level ';' (separator dropped) while skipping
 * separators inside single-quoted strings (with '' escape), double-quoted identifiers
 * (with "" escape), `--` line comments and block comments. Comments are preserved in
 * the statement text (Oracle hint comments matter). Statements are trimmed; empties dropped.
 *
 * Engine extras:
 * - 'oracle': a line consisting solely of '/' flushes the current statement (PL/SQL block
 *   terminator), and ';' splitting is suppressed inside a BEGIN..END body — including the
 *   block-closing ';', which stays in the text so `BEGIN ... END;` executes as-is.
 *   `END IF`/`END LOOP`/`END CASE` close inner constructs, not the block.
 * - 'mssql': a line consisting solely of 'GO' (case-insensitive) flushes the current statement.
 *
 * Known limits: no $$ dollar-quoting (Postgres), no nested block comments, no MySQL
 * DELIMITER directives, no T-SQL bracket-quoted ';', and for Oracle no bare-END CASE
 * expressions inside blocks nor DECLARE-section ';' suppression before the BEGIN keyword.
 */
export function splitSqlScript(sqlText: string, engine?: SqlEngine): string[] {
    const statements: string[] = [];
    const n = sqlText.length;
    let current = '';
    let blockDepth = 0;       // oracle BEGIN..END nesting
    let keepNextSemi = false; // oracle: the ';' closing the outermost END stays in the statement
    let atLineStart = true;   // only whitespace seen since the last newline
    const flush = () => {
        const stmt = current.trim();
        if (stmt) statements.push(stmt);
        current = '';
        blockDepth = 0;
        keepNextSemi = false;
    };
    const isWordChar = (c: string) => /[A-Za-z0-9_$#]/.test(c);
    const restOfLineBlank = (from: number): boolean => {
        let j = from;
        while (j < n && (sqlText[j] === ' ' || sqlText[j] === '\t' || sqlText[j] === '\r')) j++;
        return j >= n || sqlText[j] === '\n';
    };
    // Consume a quoted region from `i` (string or identifier); doubled quotes escape.
    const consumeQuoted = (i: number, quote: string): number => {
        let j = i + 1;
        while (j < n) {
            if (sqlText[j] === quote) {
                if (sqlText[j + 1] === quote) { j += 2; continue; }
                return j + 1;
            }
            j++;
        }
        return n; // unterminated: swallow the rest, the engine will report the error
    };

    let i = 0;
    while (i < n) {
        const ch = sqlText[i];
        const next = i + 1 < n ? sqlText[i + 1] : '';
        if (ch === "'" || ch === '"') {
            const j = consumeQuoted(i, ch);
            current += sqlText.slice(i, j);
            i = j; atLineStart = false; continue;
        }
        if (ch === '-' && next === '-') {
            let j = i + 2;
            while (j < n && sqlText[j] !== '\n') j++;
            current += sqlText.slice(i, j); // the newline is consumed by the default path below
            i = j; atLineStart = false; continue;
        }
        if (ch === '/' && next === '*') {
            const close = sqlText.indexOf('*/', i + 2);
            const j = close === -1 ? n : close + 2;
            current += sqlText.slice(i, j);
            i = j; atLineStart = false; continue;
        }
        if (engine === 'oracle' && ch === '/' && atLineStart && restOfLineBlank(i + 1)) {
            flush();
            i++; continue;
        }
        if (engine === 'mssql' && atLineStart && (ch === 'G' || ch === 'g') && (next === 'O' || next === 'o')
            && restOfLineBlank(i + 2)) {
            flush();
            i += 2; continue;
        }
        if (ch === ';') {
            if (engine === 'oracle' && (blockDepth > 0 || keepNextSemi)) {
                current += ';';
                keepNextSemi = false;
            } else {
                flush();
            }
            i++; atLineStart = false; continue;
        }
        if (engine === 'oracle' && /[A-Za-z]/.test(ch)) {
            let j = i;
            while (j < n && isWordChar(sqlText[j])) j++;
            if (i === 0 || !isWordChar(sqlText[i - 1])) { // whole-word boundary only
                const word = sqlText.slice(i, j).toUpperCase();
                if (word === 'BEGIN') blockDepth++;
                else if (word === 'END' && blockDepth > 0) {
                    let k = j;
                    while (k < n && /\s/.test(sqlText[k])) k++;
                    let m = k;
                    while (m < n && isWordChar(sqlText[m])) m++;
                    const peek = sqlText.slice(k, m).toUpperCase();
                    if (peek !== 'IF' && peek !== 'LOOP' && peek !== 'CASE') {
                        blockDepth--;
                        if (blockDepth === 0) keepNextSemi = true;
                    }
                }
            }
            current += sqlText.slice(i, j);
            i = j; atLineStart = false; continue;
        }
        current += ch;
        if (ch === '\n') atLineStart = true;
        else if (ch !== ' ' && ch !== '\t' && ch !== '\r') atLineStart = false;
        i++;
    }
    flush();
    return statements;
}
