// The real main.js, run against fakes of herdr and gpui (tests/fakes) and a real folder on disk.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { register } from "node:module";

globalThis.__fake = {};
register("./fakes/hooks.mjs", import.meta.url);
const { default: FilesEdit } = await import("../mods/files-edit/main.js");

// A fake Context: spawned work is kept so a test can wait for it.
function context() {
  const work = [], cx = {
    clipboard: null, notified: 0, stopped: 0, timers: [],
    notify() { cx.notified++; },
    stop_propagation() { cx.stopped++; },
    write_to_clipboard(t) { cx.clipboard = t; },
    spawn(fn) { const p = Promise.resolve().then(() => fn(cx)); work.push(p); return p; },
    timer: { every() {}, after(ms, fn) { cx.timers.push({ ms, fn }); } },
    // The folder watcher is a task that never ends, so wait for the rest in short rounds instead of for all of it.
    async settle() { for (let i = 0; i < 6; i++) await Promise.race([Promise.all(work), new Promise(r => setTimeout(r, 15))]); },
  };
  return cx;
}
const walk = (node, out = []) => { out.push(node); for (const k of node.kids ?? []) if (k && typeof k === "object") walk(k, out); return out; };
const byId = (view, id) => walk(view.render(context())).find(n => n.eid === id);
const click = (view, id) => byId(view, id).hd.click({}, context());
const texts = view => walk(view.render(context())).flatMap(n => n.kids.filter(k => typeof k === "string"));

async function folder(files = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "files-edit-"));
  for (const [name, content] of Object.entries(files)) await fs.writeFile(path.join(dir, name), content);
  Object.assign(globalThis.__fake, { cwd: dir, machine: null, git: null, platform: "windows", reads: 0, writes: 0, states: [],
    listing: Object.keys(files).map(name => ({ name, dir: false })).concat([{ name: "sub", dir: true }]) });
  return dir;
}
async function open(view, cx, name) {
  byId(view, `file-${name}`).hd.click({}, cx);
  await cx.settle();
}
async function start() {
  const cx = context(), view = new FilesEdit();
  view.init({}, cx); await cx.settle();
  return { view, cx };
}
const editor = () => globalThis.__fake.states.at(-1);
const read = (dir, name) => fs.readFile(path.join(dir, name), "utf8");
const winPath = (dir, name) => path.win32.join(dir.replaceAll("/", "\\"), name);

test("the tree lists the folder, and every asset path names this mod", async () => {
  await folder({ "a.txt": "hi" });
  const { view } = await start();
  const nodes = walk(view.render(context()));
  assert.ok(nodes.some(n => n.eid === "file-a.txt") && nodes.some(n => n.eid === "file-sub"));
  const icons = nodes.filter(n => n.tag === "svg").map(n => n.node_path);
  assert.ok(icons.length >= 3 && icons.every(p => p.startsWith("mods/files-edit/")), icons.join());
});

test("right-click copies the full path and does not open or close a folder", async () => {
  const dir = await folder({ "a.txt": "hi" });
  const { view } = await start();
  const cx = context();
  const row = byId(view, "file-sub");
  row.hd["down:right"]({ button: "right" }, cx);
  assert.equal(cx.clipboard, winPath(dir, "sub"));
  assert.equal(cx.stopped, 1);
  // Even if the release also arrives as a click, nothing opens.
  row.hd.click({}, cx);
  assert.equal(view.folders.has("sub"), false);
  // The confirmation shows in the header, then goes.
  assert.match(view.notice, /Path copied/);
  cx.timers[0].fn(cx);
  assert.equal(view.notice, null);
  // A file works the same, and a later left click still opens the folder.
  byId(view, "file-a.txt").hd["down:right"]({}, cx);
  assert.equal(cx.clipboard, winPath(dir, "a.txt"));
  assert.equal(view.file, null);
  const again = byId(view, "file-sub");
  again.hd["down:left"]({}, cx);
  again.hd.click({}, cx);
  assert.equal(view.folders.has("sub"), true);
});

test("an open folder stays open on right-click", async () => {
  await folder({ "a.txt": "hi" });
  const { view, cx } = await start();
  byId(view, "file-sub").hd.click({}, cx);
  assert.equal(view.folders.has("sub"), true);
  byId(view, "file-sub").hd["down:right"]({}, cx);
  byId(view, "file-sub").hd.click({}, cx);
  assert.equal(view.folders.has("sub"), true);
});

test("outside Windows the path keeps its slashes", async () => {
  await folder({ "a.txt": "hi" });
  Object.assign(globalThis.__fake, { platform: "linux", cwd: "/home/me/proj" });
  const { view } = await start();
  const cx = context();
  byId(view, "file-a.txt").hd["down:right"]({}, cx);
  assert.equal(cx.clipboard, "/home/me/proj/a.txt");
});

test("edit, see it is unsaved, save to disk", async () => {
  const dir = await folder({ "a.txt": "one\n" });
  const { view, cx } = await start();
  await open(view, cx, "a.txt");
  assert.equal(view.why, null);
  assert.equal(view.dirty, false);
  editor().type("one\ntwo\n", cx);
  assert.equal(view.dirty, true);
  assert.ok(texts(view).some(t => t.includes("● a.txt · unsaved")), texts(view).join("|"));
  click(view, "files-save");
  await cx.settle();
  assert.equal(await read(dir, "a.txt"), "one\ntwo\n");
  assert.equal(view.dirty, false);
  assert.match(view.notice, /Saved a\.txt/);
});

test("typing and then undoing back to the original is not unsaved", async () => {
  await folder({ "a.txt": "one\n" });
  const { view, cx } = await start();
  await open(view, cx, "a.txt");
  editor().type("one!\n", cx); assert.equal(view.dirty, true);
  editor().type("one\n", cx); assert.equal(view.dirty, false);
});

test("a save does not overwrite a change made on disk by something else", async () => {
  const dir = await folder({ "a.txt": "one\n" });
  const { view, cx } = await start();
  await open(view, cx, "a.txt");
  editor().type("mine\n", cx);
  await fs.writeFile(path.join(dir, "a.txt"), "theirs\n");
  click(view, "files-save"); await cx.settle();
  assert.equal(await read(dir, "a.txt"), "theirs\n");
  assert.equal(view.conflict, "changed");
  assert.equal(view.dirty, true);
  assert.equal(editor().value(), "mine\n");
  // Saving again is still refused: only the explicit Overwrite writes.
  click(view, "files-save"); await cx.settle();
  assert.equal(await read(dir, "a.txt"), "theirs\n");
  // Overwrite keeps the person's text.
  click(view, "files-overwrite"); await cx.settle();
  assert.equal(await read(dir, "a.txt"), "mine\n");
  assert.equal(view.conflict, null);
  assert.equal(view.dirty, false);
});

test("Reload drops the edits and shows the disk", async () => {
  const dir = await folder({ "a.txt": "one\n" });
  const { view, cx } = await start();
  await open(view, cx, "a.txt");
  editor().type("mine\n", cx);
  await fs.writeFile(path.join(dir, "a.txt"), "theirs\n");
  click(view, "files-save"); await cx.settle();
  click(view, "files-reload"); await cx.settle();
  assert.equal(view.conflict, null);
  assert.equal(view.dirty, false);
  assert.equal(editor().value(), "theirs\n");
});

test("a file that changes on disk while unedited is shown fresh; while edited it is flagged, not replaced", async () => {
  const dir = await folder({ "a.txt": "one\n" });
  const { view, cx } = await start();
  await open(view, cx, "a.txt");
  await fs.writeFile(path.join(dir, "a.txt"), "two\n");
  view.refresh(cx); await cx.settle();
  assert.equal(editor().value(), "two\n");
  editor().type("mine\n", cx);
  await fs.writeFile(path.join(dir, "a.txt"), "three\n");
  view.refresh(cx); await cx.settle();
  assert.equal(view.conflict, "changed");
  assert.equal(editor().value(), "mine\n");
});

test("a file deleted under unsaved edits can be recreated, never silently", async () => {
  const dir = await folder({ "a.txt": "one\n" });
  const { view, cx } = await start();
  await open(view, cx, "a.txt");
  editor().type("mine\n", cx);
  await fs.rm(path.join(dir, "a.txt"));
  click(view, "files-save"); await cx.settle();
  assert.equal(view.conflict, "deleted");
  await assert.rejects(read(dir, "a.txt"));
  click(view, "files-overwrite"); await cx.settle();
  assert.equal(await read(dir, "a.txt"), "mine\n");
});

test("CRLF line endings survive a save", async () => {
  const dir = await folder({ "a.txt": "one\r\ntwo\r\n" });
  const { view, cx } = await start();
  await open(view, cx, "a.txt");
  assert.equal(editor().value(), "one\ntwo\n");
  assert.equal(view.dirty, false);
  editor().type("one\ntwo\nthree\n", cx);
  click(view, "files-save"); await cx.settle();
  assert.equal(await read(dir, "a.txt"), "one\r\ntwo\r\nthree\r\n");
});

test("binary and too-large files are read-only with a reason, and Save does nothing", async () => {
  const dir = await folder({ "bin.dat": "ab\0cd", "big.txt": "x".repeat(400001) });
  const { view, cx } = await start();
  await open(view, cx, "bin.dat");
  assert.equal(view.code, null);
  assert.match(view.fileError, /Binary/);
  view.show(null);
  await open(view, cx, "big.txt");
  assert.match(view.why, /larger than 400,000/);
  assert.equal(editor().options.readonly, true);
  assert.equal(byId(view, "files-save"), undefined);
  assert.ok(byId(view, "files-why"));
  view.save(cx); await cx.settle();
  assert.equal(globalThis.__fake.writes, 0);
  assert.equal((await read(dir, "big.txt")).length, 400001);
});

test("a file on another machine is read-only", async () => {
  await folder({ "a.txt": "x" });
  globalThis.__fake.machine = "devbox";
  const { view, cx } = await start();
  assert.equal(view.on, "devbox");
  await open(view, cx, "a.txt");
  assert.match(view.why, /another machine/);
  view.save(cx); await cx.settle();
  assert.equal(globalThis.__fake.writes, 0);
});

test("Back with unsaved edits asks first; Keep editing keeps them, Discard drops them", async () => {
  const dir = await folder({ "a.txt": "one\n" });
  const { view, cx } = await start();
  await open(view, cx, "a.txt");
  editor().type("mine\n", cx);
  click(view, "files-back");
  assert.equal(view.confirmBack, true);
  assert.equal(view.file, "a.txt");
  click(view, "files-confirm-keep");
  assert.equal(view.confirmBack, false);
  assert.equal(editor().value(), "mine\n");
  click(view, "files-back");
  click(view, "files-confirm-save"); await cx.settle();
  assert.equal(await read(dir, "a.txt"), "mine\n");
  assert.equal(view.file, null);
  await open(view, cx, "a.txt");
  editor().type("again\n", cx);
  click(view, "files-back");
  click(view, "files-confirm-discard");
  assert.equal(view.file, null);
  assert.equal(await read(dir, "a.txt"), "mine\n");
  // An unedited file closes at once.
  await open(view, cx, "a.txt");
  click(view, "files-back");
  assert.equal(view.file, null);
});

test("unsaved edits come back after the panel follows another folder and returns", async () => {
  const a = await folder({ "a.txt": "one\n" });
  const { view, cx } = await start();
  await open(view, cx, "a.txt");
  editor().type("mine\n", cx);
  const other = await fs.mkdtemp(path.join(os.tmpdir(), "files-edit-other-"));
  globalThis.__fake.cwd = other;
  view.refresh(cx); await cx.settle();
  assert.equal(view.file, null);
  globalThis.__fake.cwd = a;
  view.refresh(cx); await cx.settle();
  assert.equal(view.file, "a.txt");
  assert.equal(view.dirty, true);
  assert.equal(editor().value(), "mine\n");
  // Still guarded: the file changed meanwhile, so the save is refused.
  await fs.writeFile(path.join(a, "a.txt"), "theirs\n");
  click(view, "files-save"); await cx.settle();
  assert.equal(await read(a, "a.txt"), "theirs\n");
  assert.equal(view.conflict, "changed");
});

test("Ctrl+S saves", async () => {
  const dir = await folder({ "a.txt": "one\n" });
  const { view, cx } = await start();
  await open(view, cx, "a.txt");
  editor().type("two\n", cx);
  const root = view.render(cx);
  root.hd.key({ key: "s", modifiers: { control: true, alt: false, shift: false, platform: false } }, cx);
  await cx.settle();
  assert.equal(await read(dir, "a.txt"), "two\n");
});

test("git marks show on a Windows folder, where git answers with slashes and the pane has backslashes", async () => {
  await folder({ "a.txt": "hi", "b.txt": "yo" });
  Object.assign(globalThis.__fake, { cwd: "C:\\Users\\me\\proj", git: { top: "C:/Users/me/proj", status: "?? a.txt\0 M b.txt\0" } });
  const { view } = await start();
  const marks = walk(view.render(context())).filter(n => n.tag === "div" && n.kids.length === 1 && (n.kids[0] === "A" || n.kids[0] === "M")).map(n => n.kids[0]);
  assert.deepEqual(marks, ["A", "M"]);
});
