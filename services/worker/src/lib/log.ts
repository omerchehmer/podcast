/**
 * Logger that never prints personal data.
 * Pass only IDs, counts, step names and timings. Keys that look personal are replaced.
 */
const BLOCKED = /context|profile|script|text|email|note|transcript|body|content|prompt/i;

type Fields = Record<string, unknown>;

function clean(fields: Fields): Fields {
  const out: Fields = {};
  for (const [k, v] of Object.entries(fields)) out[k] = BLOCKED.test(k) ? "[hidden]" : v;
  return out;
}

export const log = {
  info(msg: string, fields: Fields = {}) {
    if (process.env.LOG_LEVEL === "quiet") return;
    console.log(JSON.stringify({ level: "info", msg, ...clean(fields) }));
  },
  warn(msg: string, fields: Fields = {}) {
    console.warn(JSON.stringify({ level: "warn", msg, ...clean(fields) }));
  },
  error(msg: string, fields: Fields = {}) {
    console.error(JSON.stringify({ level: "error", msg, ...clean(fields) }));
  },
};
