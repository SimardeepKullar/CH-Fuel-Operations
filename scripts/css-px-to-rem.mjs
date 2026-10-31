/**
 * One-off (T-88): convert the stylesheets' `px` lengths to `rem`, so the root font size is the
 * one knob for how big the UI is. Kept in the repo so the conversion is reviewable and repeatable.
 *
 * Left alone: lengths of 2px or less (hairline borders, rules, outline offsets), media-query
 * conditions (they compare the viewport, which rem does not change), and comments.
 *
 *   node scripts/css-px-to-rem.mjs frontend/src/App.css frontend/src/banner.css ...
 */
import fs from "node:fs";

const BASE_PX = 16;
const HAIRLINE_PX = 2;

function toRem(px) {
  return `${Number((px / BASE_PX).toFixed(5))}rem`;
}

function convert(text) {
  return text.replace(/(-?\d*\.?\d+)px\b/g, (whole, n) => (Math.abs(Number(n)) <= HAIRLINE_PX ? whole : toRem(Number(n))));
}

let changed = 0;
for (const file of process.argv.slice(2)) {
  const crlf = fs.readFileSync(file, "utf8").includes("\r\n");
  const lines = fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n").split("\n");
  let inComment = false;
  const out = lines.map((line) => {
    // Walk the line, converting only what is outside a /* ... */ comment.
    let result = "";
    let rest = line;
    while (rest.length > 0) {
      if (inComment) {
        const end = rest.indexOf("*/");
        if (end < 0) { result += rest; rest = ""; } else { result += rest.slice(0, end + 2); rest = rest.slice(end + 2); inComment = false; }
      } else {
        const start = rest.indexOf("/*");
        const code = start < 0 ? rest : rest.slice(0, start);
        // A media query keeps its condition: only what follows its first `{` is converted.
        const media = /^\s*@media[^{]*\{/.exec(code);
        result += media ? media[0] + convert(code.slice(media[0].length)) : /^\s*@media/.test(code) ? code : convert(code);
        rest = start < 0 ? "" : rest.slice(start);
        if (start >= 0) inComment = true;
      }
    }
    if (result !== line) changed += 1;
    return result;
  });
  const next = out.join("\n");
  fs.writeFileSync(file, crlf ? next.replace(/\n/g, "\r\n") : next);
}
console.log(`${changed} lines changed`);
