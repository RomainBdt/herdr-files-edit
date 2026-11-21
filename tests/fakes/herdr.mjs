// Herdr's API over a real temp folder. Tests steer it through globalThis.__fake.
import fs from "node:fs/promises";
const f = () => globalThis.__fake;
export const spaces = () => [{ active: true, id: "s1", folder: f().cwd, machine: f().machine ?? null }];
export const panes = () => [];
export const focused = () => ({ space: "s1", tab: "t1", pane: null, terminal: f().machine ? `${f().machine}/t1` : null, shown: null, agent: null, cwd: f().cwd });
export const window = () => ({ platform: f().platform ?? "windows" });
export const theme = () => new Proxy({}, { get: () => "#808080" });
export const settings = () => ({});
export const watchFolder = () => Object.assign(new Promise(() => {}), { cancel() {} });
export async function exec(command, args) {
  if (command === "powershell") return { code: 0, stdout: JSON.stringify(f().listing ?? []), stderr: "" };
  // The listing script's own format: kind and name, each ended by a NUL.
  if (command === "sh") return { code: 0, stdout: (f().listing ?? []).map(e => (e.dir ? "d" : "f") + "\0" + e.name + "\0").join(""), stderr: "" };
  if (command === "git" && f().git) {
    if (args[0] === "rev-parse") return { code: 0, stdout: f().git.top + "\n", stderr: "" };
    if (args.includes("status")) return { code: 0, stdout: f().git.status, stderr: "" };
  }
  return { code: 128, stdout: "", stderr: "not a git repository" };
}
export async function readTextFile(path) {
  f().reads = (f().reads ?? 0) + 1;
  try { return await fs.readFile(path, "utf8"); } catch { return null; }
}
export async function writeTextFile(path, text, expected) {
  f().writes = (f().writes ?? 0) + 1;
  const now = await readTextFile(path);
  if (now !== expected) throw new Error("the file changed since it was read");
  await fs.writeFile(path, text, "utf8");
  return null;
}
