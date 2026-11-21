// The parts of the editor that need no Herdr API, so `npm test` can run them under plain node.

/** How much of a file the panel shows (characters). A longer file is shown cut and stays read-only. */
export const MAX_SHOWN = 400000;

/** What a file read from disk becomes in the panel.
 *  `raw` is the exact string readTextFile returned (it is also what a save must expect to find on disk).
 *  Returns { kind: "binary" } for a file with no text view, else
 *  { kind: "text", text, eol, reason }: `text` goes in the editor with "\n" line ends, `eol` is what a
 *  save puts back ("\n" or "\r\n"), and `reason` is null when the file may be edited, else why it may not. */
export function classify(raw, { remote = false } = {}) {
  if (raw.includes("\0")) return { kind: "binary", reason: "Binary file · no text preview" };
  let eol = "\n", text = raw, reason = null;
  if (raw.includes("\r")) {
    const cr = count(raw, "\r"), lf = count(raw, "\n"), crlf = count(raw, "\r\n");
    if (cr === crlf && lf === crlf) { eol = "\r\n"; text = raw.replaceAll("\r\n", "\n"); }
    else reason = "mixed or old-style line endings would be changed by a save";
  }
  if (text.length > MAX_SHOWN) {
    text = text.slice(0, MAX_SHOWN) + "\n… (file truncated)";
    reason = `larger than ${MAX_SHOWN.toLocaleString("en-US")} characters, so only its start is shown`;
  } else if (raw.includes("\uFFFD")) {
    reason = "it is not valid UTF-8 (or holds U+FFFD), and a save could damage it";
  }
  if (remote) reason = "it is on another machine, and the mod can only write to this one";
  return { kind: "text", text, eol, reason };
}

/** The editor's text as it goes to disk. */
export function toDisk(text, eol) {
  return eol === "\r\n" ? text.replaceAll("\n", "\r\n") : text;
}

/** How the file on disk compares with what this panel last read or wrote.
 *  `now`: what readTextFile returns now (null: gone). */
export function diskState(now, disk) {
  if (now === null) return "deleted";
  return now === disk ? "same" : "changed";
}

/** A path for the clipboard: the folder shown plus the entry's path inside it (written with "/").
 *  On this computer under Windows it is written the way Windows writes it (C:\a\b); anywhere else as given. */
export function fullPath(root, rel, { windows = false } = {}) {
  if (!windows) return rel ? `${root.replace(/\/+$/, "")}/${rel}` : root;
  const base = root.replaceAll("/", "\\").replace(/\\+$/, "");
  return rel ? `${base}\\${rel.replaceAll("/", "\\")}` : root.replaceAll("/", "\\");
}

/** The key a git mark is stored and looked up under. `git rev-parse --show-toplevel` answers with slashes
 *  (C:/Users/me/proj) while a Windows pane's folder has backslashes (C:\Users\me\proj), so a Windows path is
 *  written with slashes and a lowercase drive letter on both sides. Anything else is left as it is. */
export function markKey(path) {
  return /^[A-Za-z]:[\\/]/.test(path) ? path[0].toLowerCase() + path.slice(1).replaceAll("\\", "/") : path;
}

/** The last part of a path, for messages. */
export function baseName(path) {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}

function count(text, piece) {
  let n = 0;
  for (let i = text.indexOf(piece); i !== -1; i = text.indexOf(piece, i + piece.length)) n++;
  return n;
}
