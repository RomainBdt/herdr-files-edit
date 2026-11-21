#!/usr/bin/env node
// Points the Files panel of a layout file at this mod, or back at Herdr's own Files.
//
//   node scripts/files-edit-layout.mjs apply   ~/.config/herdr-app/layouts/<name>.json
//   node scripts/files-edit-layout.mjs restore ~/.config/herdr-app/layouts/<name>.json
//
// It changes the block with "id": "files" and nothing else: its `content.mod` (files <-> files-edit) and, when
// that block's `props.icon` names Herdr's own icon, the icon path. The file is edited as text, not rewritten,
// so every other byte stays as it was, and `restore` after `apply` gives back the file you started with.
// Before writing it checks that the edited file parses and differs from the original in exactly those fields;
// if anything is off it stops and writes nothing.
import fs from "node:fs";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { fileURLToPath } from "node:url";

const OWN = "files-edit", HERDRS = "files", PANEL = "files";
// Layouts Herdr ships are replaced on every start, so an edit there would be lost: clone one first.
const SHIPPED = new Set(["main", "terminals", "win98"]);

const find = (node, id) => {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) { const found = find(child, id); if (found) return found; }
  return null;
};
const count = (text, re) => (text.match(re) ?? []).length;
const quoted = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The layout text with its Files block moved from mod `from` to mod `to`. Throws, and changes nothing, if it can't
 *  be done exactly. */
export function switchFiles(text, from, to) {
  const data = JSON.parse(text);
  const node = find(data, PANEL);
  if (!node || node.type !== "block") throw new Error(`this layout has no block with "id": "${PANEL}"`);
  if (node.content?.mod !== from) throw new Error(`its "${PANEL}" block shows the mod "${node.content?.mod}", not "${from}"`);
  const mod = new RegExp(`("mod"\\s*:\\s*)"${quoted(from)}"`, "g");
  if (count(text, mod) !== 1) throw new Error(`"mod": "${from}" appears ${count(text, mod)} times, so which one is the Files panel is not clear`);
  let out = text.replace(mod, `$1"${to}"`);
  const expected = structuredClone(data);
  find(expected, PANEL).content.mod = to;
  const icon = node.content.props?.icon, fromIcon = `mods/${from}/file.svg`, toIcon = `mods/${to}/file.svg`;
  if (icon === fromIcon) {
    const re = new RegExp(`"${quoted(fromIcon)}"`, "g");
    if (count(text, re) !== 1) throw new Error(`"${fromIcon}" appears ${count(text, re)} times, so which one is the Files panel's is not clear`);
    out = out.replace(re, `"${toIcon}"`);
    find(expected, PANEL).content.props.icon = toIcon;
  }
  if (!isDeepStrictEqual(JSON.parse(out), expected)) throw new Error("the edit would change more than the Files panel");
  return out;
}
export const apply = text => switchFiles(text, HERDRS, OWN);
export const restore = text => switchFiles(text, OWN, HERDRS);

function main([command, file]) {
  const action = { apply, restore }[command];
  if (!action || !file) { console.error("usage: node scripts/files-edit-layout.mjs apply|restore <layouts/NAME.json>"); return 2; }
  const name = path.basename(file, ".json");
  if (SHIPPED.has(name)) {
    console.error(`"${name}" is one of Herdr's own layouts, which Herdr replaces on every start. Clone it first:\n  herdr-app do layout.clone '{"name":"${name}","as":"${name}-files-edit"}'\nthen run this on layouts/${name}-files-edit.json`);
    return 1;
  }
  const home = path.resolve(path.dirname(path.resolve(file)), "..");
  if (command === "apply" && !fs.existsSync(path.join(home, "mods", OWN, "main.js"))) {
    console.error(`the mod is not installed: ${path.join(home, "mods", OWN, "main.js")} is missing. Copy mods/${OWN} there first.`);
    return 1;
  }
  try {
    const before = fs.readFileSync(file, "utf8"), after = action(before);
    fs.writeFileSync(file, after);
    console.log(`${file}: the Files panel now shows ${command === "apply" ? OWN : HERDRS}`);
    return 0;
  } catch (e) {
    console.error(`${file}: not changed. ${e.message}`);
    return 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv.slice(2));
