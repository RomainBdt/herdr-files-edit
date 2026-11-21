// The layout switch changes the Files panel and nothing else, and restore gives back the same bytes.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { apply, restore } from "../scripts/files-edit-layout.mjs";

const SCRIPT = path.resolve("scripts/files-edit-layout.mjs");

// A board-style layout: the Files block carries a label and an icon for the tab bar's button.
const board = `{
  "id": "root",
  "type": "row",
  "children": [
    { "id": "main", "type": "block", "content": { "tab": "active" } },
    {
      "id": "panel", "type": "column", "hidden": true,
      "children": [
        {
          "id": "panel-body",
          "type": "stack",
          "active": "files",
          "children": [
            {
              "id": "files",
              "type": "block",
              "content": {
                "mod": "files",
                "props": { "label": "Files", "icon": "mods/files/file.svg" }
              }
            },
            { "id": "changes", "type": "block", "content": { "mod": "changes", "props": { "label": "Changes", "icon": "mods/changes/changes.svg" } } },
            { "id": "graph", "type": "block", "content": { "mod": "git-graph" } }
          ]
        }
      ]
    }
  ]
}
`;
// A main-style layout: no props, content before id, CRLF, no final newline.
const main = `{\r\n  "id": "root", "type": "row", "children": [\r\n    { "content": { "mod": "files" }, "type": "block", "id": "files" },\r\n    { "id": "tabs", "type": "block", "content": { "mod": "tabs" } }\r\n  ]\r\n}`;

const own = ({ children, ...rest }) => rest;
const walk = (node, out = []) => { out.push(node); for (const c of node.children ?? []) walk(c, out); return out; };

for (const [name, text] of [["board", board], ["main", main]]) {
  test(`${name}: apply changes only the Files block, and restore gives back the same bytes`, () => {
    const after = apply(text);
    const a = JSON.parse(text), b = JSON.parse(after);
    const before = walk(a), now = walk(b);
    assert.equal(before.length, now.length);
    for (let i = 0; i < before.length; i++) {
      if (before[i].id === "files") {
        assert.equal(now[i].content.mod, "files-edit");
        if (before[i].content.props) assert.equal(now[i].content.props.icon, "mods/files-edit/file.svg");
        assert.equal(now[i].content.props?.label, before[i].content.props?.label);
      } else assert.deepEqual(own(now[i]), own(before[i]), `block ${before[i].id} must be untouched`);
    }
    // Line by line, only the lines that name the mod or its icon differ.
    const x = text.split("\n"), y = after.split("\n");
    assert.equal(x.length, y.length);
    for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) assert.match(x[i], /"mod": "files"|mods\/files\/file\.svg/);
    assert.equal(restore(after), text);
  });
}

test("the other panels' mods and icons are left alone", () => {
  const after = apply(board);
  assert.match(after, /"mod": "changes"/);
  assert.match(after, /mods\/changes\/changes\.svg/);
  assert.match(after, /"mod": "git-graph"/);
  assert.equal(after.includes("mods/files/"), false);
});

test("it refuses what it cannot do exactly", () => {
  assert.throws(() => restore(board), /not "files-edit"/);
  assert.throws(() => apply(apply(board)), /not "files"/);
  assert.throws(() => apply(board.replace('"id": "files"', '"id": "documents"')), /no block with "id": "files"/);
  // A second panel that also shows `files` makes "the Files panel" ambiguous.
  assert.throws(() => apply(board.replace('"mod": "git-graph"', '"mod": "files"')), /appears 2 times/);
  assert.throws(() => apply("{ not json"), SyntaxError);
});

test("the command line: wrong layout, mod not installed, then a clean apply and restore", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "herdr-home-"));
  fs.mkdirSync(path.join(home, "layouts"));
  const file = path.join(home, "layouts", "mine-files-edit.json");
  fs.writeFileSync(file, board);
  const run = (...args) => spawnSync(process.execPath, [SCRIPT, ...args], { encoding: "utf8" });

  let r = run("apply", path.join(home, "layouts", "main.json"));
  assert.equal(r.status, 1);
  assert.match(r.stderr, /Herdr's own layouts/);

  r = run("apply", file);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /mod is not installed/);
  assert.equal(fs.readFileSync(file, "utf8"), board);

  fs.mkdirSync(path.join(home, "mods", "files-edit"), { recursive: true });
  fs.writeFileSync(path.join(home, "mods", "files-edit", "main.js"), "");
  r = run("apply", file);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(fs.readFileSync(file, "utf8"), apply(board));
  r = run("restore", file);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(fs.readFileSync(file, "utf8"), board);

  r = run("apply");
  assert.equal(r.status, 2);
  execFileSync(process.execPath, ["--check", SCRIPT]);
});
