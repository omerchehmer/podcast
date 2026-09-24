/**
 * Create invite codes for friends.
 *   pnpm demo:invite                 → one code, one use
 *   pnpm demo:invite --count 10      → ten codes
 *   pnpm demo:invite --uses 20 --note "friends batch 1"   → one code many people can use
 */
import { parseArgs } from "node:util";
import { randomInt } from "node:crypto";
import { serviceClient } from "../db/repo";

const { values } = parseArgs({
  options: { count: { type: "string", default: "1" }, uses: { type: "string", default: "1" }, note: { type: "string" } },
});

// No 0/O or 1/I, so codes are easy to read out loud.
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const code = () => Array.from({ length: 6 }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");

const rows = Array.from({ length: Number(values.count) }, () => ({ code: code(), max_uses: Number(values.uses), note: values.note ?? null }));
const { error } = await serviceClient().from("invite_codes").insert(rows);
if (error) {
  console.error(error.message);
  process.exit(1);
}
for (const r of rows) console.log(`${r.code}  (uses: ${r.max_uses})`);
