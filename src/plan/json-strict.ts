/**
 * Strict JSON parser (RFC 8259) for the Plan_Parser (requirement 3.3).
 *
 * JSON.parse keeps the last duplicate key and turns `5.0` into `5`; this
 * parser rejects duplicate keys, records which number lexemes have a fraction
 * or exponent, and records the source span of every value by path.
 *
 * Paths use dot notation with `[index]` for arrays; the root path is ''.
 * Keys that are not plain identifiers use `["key"]` form so paths stay
 * unambiguous.
 */

export type StrictResult =
  | {
      ok: true;
      value: unknown;
      /** Paths of numbers whose lexeme contains `.`, `e`, or `E`. */
      nonIntegerLexemes: Set<string>;
      /** Path -> [start, end) character offsets of the value in the input. */
      spans: Map<string, [number, number]>;
    }
  | { ok: false; offset: number; reason: string; path?: string };

export const MAX_DEPTH = 64;

class StrictError extends Error {
  constructor(
    readonly reason: string,
    readonly offset: number,
    readonly path?: string,
  ) {
    super(reason);
  }
}

const IDENT = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

function childKeyPath(parent: string, key: string): string {
  if (IDENT.test(key)) return parent === '' ? key : `${parent}.${key}`;
  return `${parent}[${JSON.stringify(key)}]`;
}

const isDigit = (c: number): boolean => c >= 0x30 && c <= 0x39;
const isHigh = (c: number): boolean => c >= 0xd800 && c <= 0xdbff;
const isLow = (c: number): boolean => c >= 0xdc00 && c <= 0xdfff;

function hexVal(c: number): number {
  if (c >= 0x30 && c <= 0x39) return c - 0x30;
  if (c >= 0x41 && c <= 0x46) return c - 0x41 + 10;
  if (c >= 0x61 && c <= 0x66) return c - 0x61 + 10;
  return -1;
}

const SIMPLE_ESCAPES: Record<string, string> = {
  '"': '"',
  '\\': '\\',
  '/': '/',
  b: '\b',
  f: '\f',
  n: '\n',
  r: '\r',
  t: '\t',
};

export function parseStrict(text: string): StrictResult {
  const nonIntegerLexemes = new Set<string>();
  const spans = new Map<string, [number, number]>();
  let pos = 0;

  const fail = (reason: string, offset = pos, path?: string): never => {
    throw new StrictError(reason, offset, path);
  };

  const skipWs = (): void => {
    while (pos < text.length) {
      const c = text.charCodeAt(pos);
      if (c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0d) pos++;
      else break;
    }
  };

  const describeHere = (): string =>
    pos >= text.length ? 'unexpected end of input' : `unexpected character ${JSON.stringify(text[pos])}`;

  const parseHex4 = (at: number): number => {
    let v = 0;
    for (let i = 0; i < 4; i++) {
      const h = hexVal(text.charCodeAt(at + i)); // NaN (past the end) -> -1 below
      if (!(h >= 0)) return fail('invalid \\u escape', at + i);
      v = v * 16 + h;
    }
    return v;
  };

  const parseString = (): string => {
    const start = pos;
    pos++; // opening quote
    let out = '';
    let chunk = pos;
    for (;;) {
      if (pos >= text.length) return fail('unterminated string', start);
      const c = text.charCodeAt(pos);
      if (c === 0x22) {
        out += text.slice(chunk, pos);
        pos++;
        return out;
      }
      if (c < 0x20) return fail('unescaped control character in string');
      if (c === 0x5c) {
        out += text.slice(chunk, pos);
        const e = text[pos + 1];
        if (e === undefined) return fail('unterminated string', start);
        if (e === 'u') {
          const code = parseHex4(pos + 2);
          let end = pos + 6;
          if (isHigh(code)) {
            if (text[end] === '\\' && text[end + 1] === 'u') {
              const lo = parseHex4(end + 2);
              if (!isLow(lo)) return fail('invalid surrogate pair', pos);
              out += String.fromCharCode(code, lo);
              end += 6;
            } else {
              return fail('lone high surrogate', pos);
            }
          } else if (isLow(code)) {
            return fail('lone low surrogate', pos);
          } else {
            out += String.fromCharCode(code);
          }
          pos = end;
        } else {
          const mapped = SIMPLE_ESCAPES[e];
          if (mapped === undefined) return fail('invalid escape sequence', pos + 1);
          out += mapped;
          pos += 2;
        }
        chunk = pos;
        continue;
      }
      if (isHigh(c)) {
        if (!isLow(text.charCodeAt(pos + 1))) return fail('lone high surrogate');
        pos += 2;
        continue;
      }
      if (isLow(c)) return fail('lone low surrogate');
      pos++;
    }
  };

  const parseNumber = (path: string): number => {
    const start = pos;
    if (text[pos] === '-') pos++;
    if (text[pos] === '0') {
      pos++;
      if (isDigit(text.charCodeAt(pos))) return fail('leading zero in number');
    } else if (isDigit(text.charCodeAt(pos))) {
      while (isDigit(text.charCodeAt(pos))) pos++;
    } else {
      return fail('invalid number');
    }
    let nonInteger = false;
    if (text[pos] === '.') {
      nonInteger = true;
      pos++;
      if (!isDigit(text.charCodeAt(pos))) return fail('digit expected after decimal point');
      while (isDigit(text.charCodeAt(pos))) pos++;
    }
    if (text[pos] === 'e' || text[pos] === 'E') {
      nonInteger = true;
      pos++;
      if (text[pos] === '+' || text[pos] === '-') pos++;
      if (!isDigit(text.charCodeAt(pos))) return fail('digit expected in exponent');
      while (isDigit(text.charCodeAt(pos))) pos++;
    }
    const n = Number(text.slice(start, pos));
    if (!Number.isFinite(n)) return fail('number out of range', start);
    if (nonInteger) nonIntegerLexemes.add(path);
    return n === 0 ? 0 : n; // -0 -> 0
  };

  const expectLiteral = (word: string): void => {
    if (text.startsWith(word, pos)) {
      pos += word.length;
      return;
    }
    fail(`invalid literal, ${describeHere()}`);
  };

  const parseValue = (path: string, depth: number): unknown => {
    skipWs();
    const start = pos;
    let value: unknown;
    const c = text[pos];
    if (c === '{') {
      if (depth >= MAX_DEPTH) return fail(`nesting deeper than ${MAX_DEPTH}`);
      value = parseObject(path, depth + 1);
    } else if (c === '[') {
      if (depth >= MAX_DEPTH) return fail(`nesting deeper than ${MAX_DEPTH}`);
      value = parseArray(path, depth + 1);
    } else if (c === '"') {
      value = parseString();
    } else if (c === 't') {
      expectLiteral('true');
      value = true;
    } else if (c === 'f') {
      expectLiteral('false');
      value = false;
    } else if (c === 'n') {
      expectLiteral('null');
      value = null;
    } else if (c === '-' || (c !== undefined && isDigit(c.charCodeAt(0)))) {
      value = parseNumber(path);
    } else {
      return fail(describeHere());
    }
    spans.set(path, [start, pos]);
    return value;
  };

  const parseArray = (path: string, depth: number): unknown[] => {
    pos++; // [
    const arr: unknown[] = [];
    skipWs();
    if (text[pos] === ']') {
      pos++;
      return arr;
    }
    for (;;) {
      arr.push(parseValue(`${path}[${arr.length}]`, depth));
      skipWs();
      if (text[pos] === ',') {
        pos++;
        continue;
      }
      if (text[pos] === ']') {
        pos++;
        return arr;
      }
      return fail(`expected ',' or ']', ${describeHere()}`);
    }
  };

  const parseObject = (path: string, depth: number): Record<string, unknown> => {
    pos++; // {
    const obj: Record<string, unknown> = {};
    const seen = new Set<string>();
    skipWs();
    if (text[pos] === '}') {
      pos++;
      return obj;
    }
    for (;;) {
      skipWs();
      if (text[pos] !== '"') return fail(`expected string key, ${describeHere()}`);
      const keyStart = pos;
      const key = parseString();
      const childPath = childKeyPath(path, key);
      if (seen.has(key)) {
        return fail(`duplicate key ${JSON.stringify(key)}`, keyStart, childPath);
      }
      seen.add(key);
      skipWs();
      if (text[pos] !== ':') return fail(`expected ':', ${describeHere()}`);
      pos++;
      const v = parseValue(childPath, depth);
      // defineProperty makes `__proto__` an own data property instead of
      // invoking the prototype setter.
      Object.defineProperty(obj, key, {
        value: v,
        writable: true,
        enumerable: true,
        configurable: true,
      });
      skipWs();
      if (text[pos] === ',') {
        pos++;
        continue;
      }
      if (text[pos] === '}') {
        pos++;
        return obj;
      }
      return fail(`expected ',' or '}', ${describeHere()}`);
    }
  };

  try {
    skipWs();
    if (pos >= text.length) return { ok: false, offset: pos, reason: 'empty input' };
    const value = parseValue('', 0);
    skipWs();
    if (pos < text.length) return fail(`unexpected trailing content, ${describeHere()}`);
    return { ok: true, value, nonIntegerLexemes, spans };
  } catch (e) {
    if (e instanceof StrictError) {
      return e.path === undefined
        ? { ok: false, offset: e.offset, reason: e.reason }
        : { ok: false, offset: e.offset, reason: e.reason, path: e.path };
    }
    throw e;
  }
}
