// Fails when the running Node's major differs from .nvmrc's (T-50). On this
// project a mismatch is not cosmetic: Node 24 aborted Windows test workers
// (0xC0000409) on 9 of 13 full backend runs where Node 22 aborted on none.
import { readFileSync } from "node:fs";

const want = readFileSync(new URL("../.nvmrc", import.meta.url), "utf8").trim().replace(/^v/, "").split(".")[0];
const have = process.versions.node.split(".")[0];
if (have !== want) {
  console.error(`Node ${process.version} is running, but .nvmrc pins Node ${want} (what CI uses).`);
  console.error(`Switch with your version manager (e.g. \`nvm use ${want}\`) and re-run.`);
  process.exit(1);
}
