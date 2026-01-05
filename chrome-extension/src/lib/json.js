/**
 * JSON 与路径相关的通用逻辑：尽量保持无 UI 依赖，便于测试与复用。
 */

export function safeJsonParse(text) {
  try {
    return { ok: true, value: parseJsonWithBigInt(text) };
  } catch {
    return { ok: false, value: null };
  }
}

export function stringifyPretty(value) {
  return stringifyJsonWithBigInt(value, { pretty: true });
}

export function stringifyCompact(value) {
  return stringifyJsonWithBigInt(value, { pretty: false });
}

export function stringifyValueForClipboard(value, { compact = false } = {}) {
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  if (typeof value === "bigint") return String(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  if (value === null) return "null";
  if (typeof value === "undefined") return "";
  try {
    return compact ? stringifyCompact(value) : stringifyPretty(value);
  } catch {
    return String(value);
  }
}

const MAX_SAFE_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);

function parseJsonWithBigInt(input) {
  const s = String(input ?? "");
  let i = 0;

  function error() {
    throw new Error("Invalid JSON");
  }

  function isWs(ch) {
    return ch === " " || ch === "\n" || ch === "\r" || ch === "\t";
  }

  function skipWs() {
    while (i < s.length && isWs(s[i])) i += 1;
  }

  function parseValue() {
    skipWs();
    const ch = s[i];
    if (ch === "{") return parseObject();
    if (ch === "[") return parseArray();
    if (ch === '"') return parseString();
    if (ch === "t" && s.startsWith("true", i)) {
      i += 4;
      return true;
    }
    if (ch === "f" && s.startsWith("false", i)) {
      i += 5;
      return false;
    }
    if (ch === "n" && s.startsWith("null", i)) {
      i += 4;
      return null;
    }
    if (ch === "-" || (ch >= "0" && ch <= "9")) return parseNumber();
    error();
  }

  function parseString() {
    if (s[i] !== '"') error();
    i += 1;
    let out = "";
    while (i < s.length) {
      const ch = s[i];
      if (ch === '"') {
        i += 1;
        return out;
      }
      if (ch === "\\") {
        i += 1;
        if (i >= s.length) error();
        const esc = s[i];
        if (esc === '"' || esc === "\\" || esc === "/") {
          out += esc;
          i += 1;
          continue;
        }
        if (esc === "b") {
          out += "\b";
          i += 1;
          continue;
        }
        if (esc === "f") {
          out += "\f";
          i += 1;
          continue;
        }
        if (esc === "n") {
          out += "\n";
          i += 1;
          continue;
        }
        if (esc === "r") {
          out += "\r";
          i += 1;
          continue;
        }
        if (esc === "t") {
          out += "\t";
          i += 1;
          continue;
        }
        if (esc === "u") {
          const hex = s.slice(i + 1, i + 5);
          if (!/^[0-9a-fA-F]{4}$/.test(hex)) error();
          const codeUnit = Number.parseInt(hex, 16);
          out += String.fromCharCode(codeUnit);
          i += 5;
          continue;
        }
        error();
      }
      out += ch;
      i += 1;
    }
    error();
  }

  function parseNumber() {
    const start = i;
    if (s[i] === "-") i += 1;
    if (i >= s.length) error();

    if (s[i] === "0") {
      i += 1;
    } else {
      if (!(s[i] >= "1" && s[i] <= "9")) error();
      while (i < s.length && s[i] >= "0" && s[i] <= "9") i += 1;
    }

    let isInt = true;
    if (s[i] === ".") {
      isInt = false;
      i += 1;
      if (!(s[i] >= "0" && s[i] <= "9")) error();
      while (i < s.length && s[i] >= "0" && s[i] <= "9") i += 1;
    }

    if (s[i] === "e" || s[i] === "E") {
      isInt = false;
      i += 1;
      if (s[i] === "+" || s[i] === "-") i += 1;
      if (!(s[i] >= "0" && s[i] <= "9")) error();
      while (i < s.length && s[i] >= "0" && s[i] <= "9") i += 1;
    }

    const raw = s.slice(start, i);
    if (!isInt) return Number(raw);
    if (raw === "-0") return -0;
    const bi = BigInt(raw);
    const abs = bi < 0n ? -bi : bi;
    if (abs <= MAX_SAFE_BIGINT) return Number(raw);
    return bi;
  }

  function parseArray() {
    if (s[i] !== "[") error();
    i += 1;
    const out = [];
    skipWs();
    if (s[i] === "]") {
      i += 1;
      return out;
    }
    while (true) {
      out.push(parseValue());
      skipWs();
      const ch = s[i];
      if (ch === ",") {
        i += 1;
        continue;
      }
      if (ch === "]") {
        i += 1;
        return out;
      }
      error();
    }
  }

  function parseObject() {
    if (s[i] !== "{") error();
    i += 1;
    const out = {};
    skipWs();
    if (s[i] === "}") {
      i += 1;
      return out;
    }
    while (true) {
      skipWs();
      if (s[i] !== '"') error();
      const key = parseString();
      skipWs();
      if (s[i] !== ":") error();
      i += 1;
      out[key] = parseValue();
      skipWs();
      const ch = s[i];
      if (ch === ",") {
        i += 1;
        continue;
      }
      if (ch === "}") {
        i += 1;
        return out;
      }
      error();
    }
  }

  const value = parseValue();
  skipWs();
  if (i !== s.length) error();
  return value;
}

function stringifyJsonWithBigInt(value, { pretty }) {
  const indentUnit = "  ";
  const seen = new WeakSet();

  function stringifyAny(v, depth, inArray) {
    if (v === null) return "null";
    const t = typeof v;
    if (t === "string") return JSON.stringify(v);
    if (t === "number") return Number.isFinite(v) ? String(v) : "null";
    if (t === "bigint") return v.toString();
    if (t === "boolean") return v ? "true" : "false";
    if (t === "undefined" || t === "function" || t === "symbol") return inArray ? "null" : undefined;

    if (Array.isArray(v)) {
      if (v.length === 0) return "[]";
      if (!pretty) {
        const parts = [];
        for (let idx = 0; idx < v.length; idx += 1) {
          const item = stringifyAny(v[idx], depth + 1, true);
          parts.push(item === undefined ? "null" : item);
        }
        return `[${parts.join(",")}]`;
      }
      const pad = indentUnit.repeat(depth);
      const nextPad = indentUnit.repeat(depth + 1);
      const parts = [];
      for (let idx = 0; idx < v.length; idx += 1) {
        const item = stringifyAny(v[idx], depth + 1, true);
        parts.push(`${nextPad}${item === undefined ? "null" : item}`);
      }
      return `[\n${parts.join(",\n")}\n${pad}]`;
    }

    if (t === "object") {
      if (seen.has(v)) throw new TypeError("Converting circular structure to JSON");
      seen.add(v);

      const keys = Object.keys(v);
      if (keys.length === 0) {
        seen.delete(v);
        return "{}";
      }

      if (!pretty) {
        const parts = [];
        for (const k of keys) {
          const item = stringifyAny(v[k], depth + 1, false);
          if (item === undefined) continue;
          parts.push(`${JSON.stringify(k)}:${item}`);
        }
        seen.delete(v);
        return `{${parts.join(",")}}`;
      }

      const pad = indentUnit.repeat(depth);
      const nextPad = indentUnit.repeat(depth + 1);
      const parts = [];
      for (const k of keys) {
        const item = stringifyAny(v[k], depth + 1, false);
        if (item === undefined) continue;
        parts.push(`${nextPad}${JSON.stringify(k)}: ${item}`);
      }
      seen.delete(v);
      if (parts.length === 0) return "{}";
      return `{\n${parts.join(",\n")}\n${pad}}`;
    }

    return JSON.stringify(String(v));
  }

  const out = stringifyAny(value, 0, false);
  if (out === undefined) return "null";
  return out;
}

export function isUriString(value) {
  if (typeof value !== "string") return false;
  const text = value.trim();
  if (!text) return false;
  if (/\s/.test(text)) return false;
  return /^[A-Za-z][A-Za-z0-9+.-]*:/.test(text);
}

export function isPlainObject(value) {
  return Object.prototype.toString.call(value) === "[object Object]";
}

export function isJsonString(value) {
  if (typeof value !== "string") return false;
  const text = value.trim();
  if (!text) return false;
  if (!/^[\{\[]/.test(text)) return false;
  const parsed = safeJsonParse(text);
  if (!parsed.ok) return false;
  return parsed.value !== null && typeof parsed.value === "object";
}

export function getAtPath(target, path) {
  let cur = target;
  for (const seg of path) {
    if (cur == null) return undefined;
    cur = cur[seg];
  }
  return cur;
}

export function setAtPath(target, path, value) {
  if (!path.length) return value;
  let cur = target;
  for (let i = 0; i < path.length - 1; i += 1) {
    cur = cur[path[i]];
  }
  cur[path[path.length - 1]] = value;
  return target;
}

export function formatPath(segments) {
  const isIdentifier = (s) => /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(s);
  let out = "";
  for (const seg of segments) {
    if (typeof seg === "number") {
      out += `[${seg}]`;
      continue;
    }
    if (out.length === 0) {
      out += seg;
      continue;
    }
    if (isIdentifier(seg)) {
      out += `.${seg}`;
      continue;
    }
    out += `["${seg.replaceAll('"', '\\"')}"]`;
  }
  return out;
}

export function joinFullPath(parentFullPath, relSegments) {
  const rel = formatPath(relSegments);
  if (!parentFullPath) return rel;
  if (!rel) return parentFullPath;
  if (rel.startsWith("[")) return `${parentFullPath}${rel}`;
  return `${parentFullPath}.${rel}`;
}
