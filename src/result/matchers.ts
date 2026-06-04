/** A predicate over a single column value. */
export type Matcher = (value: unknown) => boolean;

const isNullish = (v: unknown): boolean => v === null || v === undefined;

/** Coerce to a finite number, or NaN. */
function n(v: unknown): number {
    if (isNullish(v)) return NaN;
    return Number(v);
}

/** Loose-equality (String compare). */
export function eq(expected: unknown): Matcher {
    return (value) => String(value) === String(expected);
}
/** Loose-inequality. */
export function ne(expected: unknown): Matcher {
    return (value) => String(value) !== String(expected);
}

export function lt(bound: number): Matcher { return (v) => { const x = n(v); return !Number.isNaN(x) && x < bound; }; }
export function lte(bound: number): Matcher { return (v) => { const x = n(v); return !Number.isNaN(x) && x <= bound; }; }
export function gt(bound: number): Matcher { return (v) => { const x = n(v); return !Number.isNaN(x) && x > bound; }; }
export function gte(bound: number): Matcher { return (v) => { const x = n(v); return !Number.isNaN(x) && x >= bound; }; }

export function between(min: number, max: number): Matcher {
    return (v) => { const x = n(v); return !Number.isNaN(x) && x >= min && x <= max; };
}

export function oneOf(values: unknown[]): Matcher {
    const set = values.map((x) => String(x));
    return (value) => set.includes(String(value));
}

/** Escape RegExp metacharacters EXCEPT we handle % and _ ourselves. */
function escapeForLike(pattern: string): string {
    return pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** SQL-style LIKE: % = any run, _ = one char. Anchored, case-insensitive. */
export function like(pattern: string): Matcher {
    const re = new RegExp('^' + escapeForLike(pattern).replace(/%/g, '.*').replace(/_/g, '.') + '$', 'i');
    return (value) => (isNullish(value) ? false : re.test(String(value)));
}

export function contains(substr: string): Matcher {
    const s = substr.toLowerCase();
    return (value) => (isNullish(value) ? false : String(value).toLowerCase().includes(s));
}
export function startsWith(prefix: string): Matcher {
    const s = prefix.toLowerCase();
    return (value) => (isNullish(value) ? false : String(value).toLowerCase().startsWith(s));
}
export function endsWith(suffix: string): Matcher {
    const s = suffix.toLowerCase();
    return (value) => (isNullish(value) ? false : String(value).toLowerCase().endsWith(s));
}

export function matches(re: RegExp): Matcher {
    return (value) => (isNullish(value) ? false : re.test(String(value)));
}

export function isNull(): Matcher { return (value) => isNullish(value); }
export function notNull(): Matcher { return (value) => !isNullish(value); }
export function not(matcher: Matcher): Matcher { return (value) => !matcher(value); }
