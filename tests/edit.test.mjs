// The pure parts: file classification, line endings, conflict states, paths.
import test from "node:test";
import assert from "node:assert/strict";
import { classify, toDisk, diskState, fullPath, baseName, markKey, MAX_SHOWN } from "../mods/files-edit/edit.js";

test("plain text is editable and keeps LF", () => {
  const v = classify("a\nb\n");
  assert.deepEqual(v, { kind: "text", text: "a\nb\n", eol: "\n", reason: null });
});

test("CRLF files are edited with LF and written back with CRLF", () => {
  const v = classify("a\r\nb\r\n");
  assert.equal(v.reason, null);
  assert.equal(v.eol, "\r\n");
  assert.equal(v.text, "a\nb\n");
  assert.equal(toDisk("a\nb\nc\n", v.eol), "a\r\nb\r\nc\r\n");
  assert.equal(toDisk(v.text, v.eol), "a\r\nb\r\n");
});

test("mixed or lone CR line endings are read-only", () => {
  assert.match(classify("a\r\nb\n").reason, /line endings/);
  assert.match(classify("a\rb\r").reason, /line endings/);
});

test("binary files have no text view", () => {
  const v = classify("PK\0\0abc");
  assert.equal(v.kind, "binary");
  assert.match(v.reason, /Binary/);
});

test("a file too long to show in full is cut and read-only", () => {
  const v = classify("x".repeat(MAX_SHOWN + 10));
  assert.match(v.reason, /larger than 400,000/);
  assert.ok(v.text.length < MAX_SHOWN + 40 && v.text.endsWith("(file truncated)"));
  assert.equal(classify("x".repeat(MAX_SHOWN)).reason, null);
});

test("text that may not be UTF-8 is read-only", () => {
  assert.match(classify("caf\uFFFD").reason, /UTF-8/);
});

test("a file on another machine is read-only, and says why", () => {
  assert.match(classify("ok", { remote: true }).reason, /another machine/);
});

test("diskState", () => {
  assert.equal(diskState("a", "a"), "same");
  assert.equal(diskState("b", "a"), "changed");
  assert.equal(diskState(null, "a"), "deleted");
  assert.equal(diskState("", ""), "same");
});

test("fullPath", () => {
  assert.equal(fullPath("C:\\Users\\me\\proj", "src/main.js", { windows: true }), "C:\\Users\\me\\proj\\src\\main.js");
  assert.equal(fullPath("C:/Users/me/proj/", "src", { windows: true }), "C:\\Users\\me\\proj\\src");
  assert.equal(fullPath("/home/me/proj", "src/main.js"), "/home/me/proj/src/main.js");
  assert.equal(fullPath("/home/me/proj/", "a"), "/home/me/proj/a");
  assert.equal(baseName("C:\\a\\b.txt"), "b.txt");
  assert.equal(baseName("/a/b/"), "b");
});

test("a git mark's key is the same for git's slashes and a Windows pane's backslashes", () => {
  assert.equal(markKey("C:/Users/me/proj/notes.md"), "c:/Users/me/proj/notes.md");
  assert.equal(markKey("C:\\Users\\me\\proj/notes.md"), "c:/Users/me/proj/notes.md");
  assert.equal(markKey("c:\\Users\\me\\proj/src/a.js"), markKey("C:/Users/me/proj/src/a.js"));
  // Other systems keep their paths, a backslash in a file name included.
  assert.equal(markKey("/home/me/we\\ird.txt"), "/home/me/we\\ird.txt");
});
