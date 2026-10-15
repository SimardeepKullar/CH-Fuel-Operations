import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * The real driver names the local-only real-invoice tests assert, kept out
 * of the repository (T-50): a committed file must not carry a real driver's
 * name, even inside a `describe.skipIf(!hasRealFixture)` block. They live in
 * gitignored `data/bvd-invoices/real-names.json`, beside the invoices they
 * come from, as `{ "<key>": "<name as printed>" }`.
 */
export const REAL_NAMES_FILE = fileURLToPath(new URL("../../../data/bvd-invoices/real-names.json", import.meta.url));

/** One real name by key. Call it inside `it`, never at describe level. A
 * missing file or key throws rather than skipping, so a real-invoice test
 * cannot pass by asserting nothing. */
export function realName(key: string): string {
  if (!existsSync(REAL_NAMES_FILE)) {
    throw new Error(`real-invoice tests need ${REAL_NAMES_FILE} (gitignored, local only)`);
  }
  const names = JSON.parse(readFileSync(REAL_NAMES_FILE, "utf8")) as Record<string, string>;
  const name = names[key];
  if (name === undefined) {
    throw new Error(`no "${key}" in ${REAL_NAMES_FILE}`);
  }
  return name;
}
