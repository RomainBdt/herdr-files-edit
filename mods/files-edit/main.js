// Files, with editing: a lazy file browser for the focused pane's folder. Based on Herdr's own Files mod:
// the same tree, git marks, limits and look, plus saving a text file back to disk and copying a path on right-click.
import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, Editor, EditorState } from "gpui-base";
import { spaces, panes, focused, exec, readTextFile, writeTextFile, watchFolder, theme, settings, window } from "herdr";
import { classify, toDisk, diskState, fullPath, baseName, markKey } from "./edit.js";

function location() {
  const space = spaces().find(s => s.active), f = focused();
  const pane = f?.pane ? panes().find(p => p.pane === f.pane) : null;
  const on = f?.pane === null ? (f.terminal?.includes("/") ? f.terminal.split("/")[0] : null) : space?.machine ?? null;
  return { cwd: pane?.cwd || f?.cwd || space?.folder, on, space: space?.id };
}
const key = () => JSON.stringify(location());
const LANG = { ts: "js", tsx: "js", mts: "js", cts: "js", jsx: "js", mjs: "js", toml: "yaml", jsonc: "json", svelte: "html", vue: "html" };
const PER_FOLDER = 500, TOTAL = 5000;

async function directory(path, on) {
  const windowsDirectory = async () => {
    // Windows PowerShell otherwise uses the console code page; exec decodes UTF-8.
    // Links keep directory attributes even when dangling; check their target.
    // Other reparse points (OneDrive's folders) have no LinkType and are folders.
    // PowerShell reads curly single quotes as quotes too, so they're doubled like '.
    const r = await exec("powershell", ["-NoProfile", "-Command", "[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false); & { param($p) @(Get-ChildItem -LiteralPath $p -Force -ErrorAction Stop | Where-Object Name -ne '.git' | Select-Object -First 501 | ForEach-Object { @{ name=$_.Name; dir=($_.PSIsContainer -and (-not ($_.Attributes -band [IO.FileAttributes]::ReparsePoint) -or -not $_.LinkType -or ($_.Target -and [IO.Directory]::Exists(([IO.Path]::Combine([IO.Path]::GetDirectoryName($_.FullName), $_.Target[0])))))) } }) | ConvertTo-Json -Compress } '" + path.replace(/['‘’‚‛]/g, "$&$&") + "'"], { on });
    if (r.code !== 0) throw new Error(r.stderr || "Cannot list this folder");
    const result = JSON.parse(r.stdout || "[]");
    return Array.isArray(result) ? result : [result];
  };
  if (!on && window()?.platform === "windows") return windowsDirectory();
  const script = 'n=0; for p in "$1"/* "$1"/.[!.]* "$1"/..?*; do [ -e "$p" ] || [ -L "$p" ] || continue; name=${p##*/}; [ "$name" = .git ] && continue; if [ -d "$p" ]; then kind=d; else kind=f; fi; printf "%s\\0%s\\0" "$kind" "$name"; n=$((n+1)); [ "$n" -gt 500 ] && break; done; test -d "$1"';
  let r;
  try { r = await exec("sh", ["-c", script, "files", path], { on }); }
  catch (e) {
    if (on && String(e).includes("cannot start sh: program not found")) return windowsDirectory();
    throw e;
  }
  if (r.code !== 0) throw new Error(r.stderr || "Cannot list this folder");
  const fields = r.stdout.split("\0"), out = [];
  for (let i = 0; i + 1 < fields.length; i += 2) out.push({ name: fields[i + 1], dir: fields[i] === "d" });
  return out;
}

const NOTICE_MS = 1800;
const errText = e => String(/** @type {any} */ (e)?.message ?? e);

export default class FilesEdit extends View {
  init(_props, cx) {
    this.saved = new Map();
    this.entries = new Map(); this.folders = new Set(); this.pending = new Set(); this.marks = {};
    this.token = 0; this.noticeId = 0; this.rightPress = false;
    this.refresh(cx);
    cx.timer.every(10000, cx => this.refresh(cx));
  }

  watch(root, cx) {
    if (this.on || this.watched === root) return;
    this.watched = root;
    const context = this.context;
    cx.spawn(async cx => {
      try { while (this.context === context) { await watchFolder(root); if (this.current(context)) this.refresh(cx); } }
      catch { if (this.context === context) this.watched = null; }
    });
  }

  current(context) {
    return this.context === context && key() === context.key;
  }

  async loadFolder(path, context) {
    const { on, cwd: root } = context;
    const entries = await directory(path ? `${root}/${path}` : root, on);
    if (!this.current(context) || (path && !this.folders.has(path))) return;
    const used = [...this.entries.entries()].filter(([p]) => p !== path).reduce((n, [, e]) => n + e.length, 0);
    this.entries.set(path, entries.slice(0, Math.max(0, Math.min(PER_FOLDER, TOTAL - used))).sort((a, b) => Number(b.dir) - Number(a.dir) || a.name.localeCompare(b.name)));
    if (entries.length > PER_FOLDER || used + entries.length > TOTAL) this.limited = true;
  }

  // What would be lost if this panel stopped showing the open file now: the edits, and what they were made against.
  draft() {
    if (!this.code || this.why || !this.dirty) return null;
    return { text: this.code.value(), disk: this.disk, eol: this.eol, clean: this.clean };
  }

  refresh(cx) {
    const { cwd, on } = location(), next = key();
    if (next !== this.context?.key) {
      // Edits survive a change of folder (a click in another terminal): they come back with the folder.
      if (this.context) this.saved.set(this.context.key, { folders: this.folders, file: this.file, draft: this.draft() });
      const saved = this.saved.get(next);
      this.context = { key: next, cwd, on }; this.root = cwd; this.on = on; this.entries = new Map(); this.folders = new Set(saved?.folders);
      this.pending = new Set(); this.marks = {}; this.show(null); this.watched = null; this.error = null; this.limited = false;
      this.loading = false;
      if (saved?.file) this.show(saved.file, cx, saved.draft);
    }
    if (!cwd || this.loading) return;
    const context = this.context;
    this.loading = true;
    this.limited = false;
    cx.spawn(async cx => {
      try {
        for (const path of ["", ...this.folders]) {
          if (!this.current(context)) return;
          await this.loadFolder(path, context);
        }
        const top = await exec("git", ["rev-parse", "--show-toplevel"], { cwd, on }).catch(() => null);
        const marks = {};
        if (top?.code === 0) {
          // Writes nothing under .git (index lock, fsmonitor cookie): the folder watch would refresh again.
          const status = await exec("git", ["--no-optional-locks", "-c", "core.fsmonitor=false", "status", "--porcelain=v1", "-z", "--no-renames", "--untracked-files=all"], { cwd, on }).catch(() => null);
          if (status?.code === 0) for (const entry of status.stdout.split("\0").filter(Boolean).slice(0, TOTAL)) {
            const xy = entry.slice(0, 2);
            marks[markKey(`${top.stdout.trim()}/${entry.slice(3)}`)] = xy === "??" || xy.includes("A") ? "A" : xy.includes("U") ? "U" : xy.includes("D") ? "D" : "M";
          }
        }
        if (!this.current(context)) return;
        this.marks = marks; this.error = null; this.watch(cwd, cx);
        await this.checkDisk(context, cx);
      } catch (e) { if (this.current(context)) this.error = String(e); }
      finally { if (this.context === context) this.loading = false; cx.notify(); }
    });
  }

  toggle(path, cx) {
    if (this.folders.has(path)) {
      for (const folder of [...this.folders]) if (folder === path || folder.startsWith(path + "/")) {
        this.folders.delete(folder);
        this.entries.delete(folder);
      }
    } else {
      this.folders.add(path);
      if (!this.entries.has(path) && !this.pending.has(path)) {
        const context = this.context;
        this.pending.add(path);
        cx.spawn(async cx => {
          try { await this.loadFolder(path, context); }
          catch (e) { if (this.current(context)) this.error = String(e); }
          finally { if (this.context === context) this.pending.delete(path); cx.notify(); }
        });
      }
    }
    cx.notify();
  }

  // Opens a file (null closes it). `draft`: edits to put back on it, from draft().
  show(path, cx, draft = null) {
    this.code?.release(); this.code = null; this.file = path; this.fileError = null;
    this.why = null; this.disk = null; this.clean = null; this.eol = "\n"; this.dirty = false;
    this.conflict = null; this.saveError = null; this.saving = false; this.confirmBack = false;
    const token = ++this.token;
    if (!path || !cx) return;
    const context = this.context, root = this.root, on = this.on;
    cx.spawn(async cx => {
      try {
        const raw = await readTextFile(`${root}/${path}`, { on });
        if (token !== this.token || !this.current(context)) return;
        if (raw === null && !draft) { this.fileError = "This file is no longer available"; return; }
        const view = raw === null ? { kind: "text", text: draft.text, eol: draft.eol, reason: null } : classify(raw, { remote: Boolean(on) });
        // Edits that were put away keep their own baseline (what the disk held when they began), so a save
        // of them still notices a change made on disk since.
        if (view.kind === "binary" && !draft) { this.fileError = view.reason; return; }
        const t = theme(), ext = path.includes(".") ? path.split(".").pop() : "txt", editable = Boolean(draft) || !view.reason;
        this.code = EditorState.new({ language: LANG[ext] ?? ext, readonly: !editable,
          value: draft ? draft.text : view.text,
          font_family: settings().font_family, font_size: 12,
          syntax: { keyword: t.ansi5, string: t.ansi2, comment: t.dim, function: t.ansi4, type: t.ansi3, number: t.ansi1, constant: t.ansi6 } });
        const code = this.code;
        this.why = editable ? null : view.reason;
        this.eol = draft ? draft.eol : view.eol;
        this.disk = draft ? draft.disk : raw;
        // What the editor says about the text as loaded, not the disk's string: it may normalize it.
        this.clean = draft ? draft.clean : code.value();
        this.dirty = code.value() !== this.clean;
        if (draft && raw !== draft.disk) this.conflict = diskState(raw, draft.disk);
        if (editable) code.on("change", (_e, cx) => {
          if (this.code !== code) return;
          this.dirty = code.value() !== this.clean; cx.notify();
        });
      } catch { if (token === this.token && this.current(context)) this.fileError = "Read-only · this file cannot be shown (binary, over 1 MiB, or unreadable)"; }
      finally { cx.notify(); }
    });
  }

  // The open file may have been changed by something else. Unedited, the panel just shows the new text;
  // edited, it says so and lets the person choose, and a save still refuses until they do.
  async checkDisk(context, cx) {
    const { code, file, disk, token } = this;
    if (!code || !file || this.why || this.saving || this.on || !this.current(context)) return;
    const now = await readTextFile(`${this.root}/${file}`).catch(() => undefined);
    if (now === undefined || token !== this.token || this.disk !== disk || this.saving || !this.current(context)) return;
    const state = diskState(now, disk);
    if (state === "same") return;
    if (this.dirty) this.conflict = state;
    else this.show(file, cx);
  }

  save(cx, { force = false, then = null } = {}) {
    if (!this.code || this.why || this.saving || !this.file || (!this.dirty && !force)) return;
    const context = this.context, token = this.token, abs = `${this.root}/${this.file}`, name = baseName(this.file);
    const value = this.code.value(), out = toDisk(value, this.eol);
    this.saving = true; this.saveError = null; cx.notify();
    cx.spawn(async cx => {
      try {
        // Overwrite: the person has seen the file differs, so expect what is there now.
        const expected = force ? await readTextFile(abs) : this.disk;
        try { await writeTextFile(abs, out, expected); }
        catch (e) {
          // Refused: the file is not what this panel last saw (someone else wrote it), or the write itself failed.
          const now = await readTextFile(abs).catch(() => undefined);
          const state = now === undefined ? "same" : diskState(now, expected);
          if (token === this.token) {
            if (state !== "same") this.conflict = state;
            else this.saveError = `Could not save ${name}: ${errText(e)}`;
          }
          return;
        }
        if (token !== this.token) return;
        this.disk = out; this.clean = value; this.conflict = null;
        this.dirty = this.code.value() !== value;
        this.flash(`✓ Saved ${name}`, cx);
        then?.(cx);
      } catch (e) {
        if (token === this.token) this.saveError = `Could not save ${name}: ${errText(e)}`;
      } finally { if (token === this.token) this.saving = false; cx.notify(); }
    });
  }

  back(cx) {
    if (this.dirty) this.confirmBack = true; else this.show(null);
    cx.notify();
  }

  // A short message in the header.
  flash(text, cx) {
    const id = ++this.noticeId;
    this.notice = text;
    cx.timer.after(NOTICE_MS, cx => { if (this.noticeId === id) { this.notice = null; cx.notify(); } });
    cx.notify();
  }

  copyPath(path, cx) {
    const text = fullPath(this.root, path, { windows: !this.on && window()?.platform === "windows" });
    try { cx.write_to_clipboard(text); this.flash(`✓ Path copied · ${baseName(text)}`, cx); }
    catch { this.flash("Could not copy the path", cx); }
  }

  keydown(e, cx) {
    const m = e.modifiers;
    if (e.key === "s" && (m.control || m.platform) && !m.alt && !m.shift && this.code && !this.why) { cx.stop_propagation(); this.save(cx); }
  }

  rows(prefix, depth, out, t) {
    if (out.length >= TOTAL || depth > 40) return out;
    for (const entry of this.entries.get(prefix) ?? []) {
      if (out.length >= TOTAL) break;
      const path = prefix ? `${prefix}/${entry.name}` : entry.name, open = this.folders.has(path), mark = this.marks[markKey(`${this.root}/${path}`)];
      out.push(h_flex().id(`file-${path}`).h(28).flex_none().pl(8 + depth * 18).pr(8).gap(7).items_center().rounded(7).cursor_pointer().hover(s => s.bg(t.hover))
        // A right-click copies the path and nothing else. If the release also arrives as a click, it is dropped here;
        // the next left press clears the mark, so it can never swallow a real click.
        .on_mouse_down("left", () => { this.rightPress = false; })
        .on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); this.rightPress = true; this.copyPath(path, cx); })
        .on_click((_e, cx) => {
          if (this.rightPress) { this.rightPress = false; return; }
          if (entry.dir) this.toggle(path, cx); else this.show(path, cx);
        })
        .child(entry.dir ? svg(`mods/files-edit/chevron-${open ? "down" : "right"}.svg`).size(12).flex_none().text_color(t.dim) : div().w(12).flex_none())
        .child(svg(`mods/files-edit/${entry.dir ? "folder" : "file"}.svg`).size(14).flex_none().text_color(t.muted))
        .child(div().flex_1().min_w(0).truncate().child(entry.name))
        .when(Boolean(mark), el => el.child(div().text_size(11).text_color(mark === "A" ? t.ansi2 : mark === "D" || mark === "U" ? t.ansi1 : t.blocked).child(mark))));
      if (entry.dir && open) this.rows(path, depth + 1, out, t);
    }
    return out;
  }

  button(t, id, label, primary, onClick) {
    return h_flex().id(id).h(22).flex_none().px(8).items_center().rounded(5).cursor_pointer().text_size(12)
      .bg(primary ? t.accent : t.hover).text_color(primary ? t.accent_foreground : t.foreground)
      .on_click((_e, cx) => onClick(cx)).child(label);
  }

  bar(t, id, text, color, buttons) {
    return h_flex().id(id).flex_none().px(12).py(6).gap(8).items_center().border_b(1).border_color(t.border)
      .child(div().flex_1().min_w(0).text_size(12).text_color(color).child(text))
      .children(buttons);
  }

  // The messages above the file: why it is read-only, what is unsaved, what changed on disk.
  notices(t) {
    if (!this.file) return [];
    const out = [], name = baseName(this.file);
    if (this.why) out.push(this.bar(t, "files-why", `Read-only · ${this.why}`, t.dim, []));
    if (this.conflict) out.push(this.bar(t, "files-conflict",
      this.conflict === "deleted" ? `${name} was deleted on disk. Your changes are kept here, and nothing was saved.` : `${name} changed on disk since you opened it. Your changes are kept here, and nothing was saved.`, t.blocked, [
        this.button(t, "files-reload", "Reload", false, cx => this.show(this.file, cx)),
        this.button(t, "files-overwrite", this.conflict === "deleted" ? "Recreate" : "Overwrite", true, cx => this.save(cx, { force: true })),
      ]));
    if (this.saveError) out.push(this.bar(t, "files-save-error", this.saveError, t.ansi1, []));
    if (this.confirmBack) out.push(this.bar(t, "files-confirm", `${name} has unsaved changes.`, t.blocked, [
      this.button(t, "files-confirm-save", "Save", true, cx => this.save(cx, { then: cx => { if (!this.dirty) this.show(null); cx.notify(); } })),
      this.button(t, "files-confirm-discard", "Discard", false, cx => { this.show(null); cx.notify(); }),
      this.button(t, "files-confirm-keep", "Keep editing", false, cx => { this.confirmBack = false; cx.notify(); }),
    ]));
    return out;
  }

  render(cx) {
    if (key() !== this.context?.key) this.refresh(cx);
    const t = theme(), editing = Boolean(this.code) && !this.why;
    return v_flex().id("files").size_full().min_h(0).rounded(10).overflow_hidden().bg(t.background).border_1().border_color(t.border).text_color(t.foreground).text_size(13)
      .on_key_down((e, cx) => this.keydown(e, cx))
      .child(h_flex().h(42).flex_none().px(14).gap(8).items_center().border_b(1).border_color(t.border)
        .when(Boolean(this.file), el => el.child(div().id("files-back").w(20).cursor_pointer().text_color(t.muted).on_click((_e, cx) => this.back(cx)).child("←")))
        .child(div().font_semibold().child("Files"))
        .child(this.notice
          ? div().flex_1().min_w(0).truncate().text_right().text_size(12).text_color(this.notice.startsWith("✓") ? t.ansi2 : t.ansi1).child(this.notice)
          : div().flex_1().min_w(0).truncate().text_right().text_size(12).text_color(this.dirty ? t.blocked : t.dim)
            .child(this.file ? `${this.dirty ? "● " : ""}${this.file}${this.dirty ? " · unsaved" : ""}` : this.root?.split(/[\\/]/).pop() ?? ""))
        .when(editing, el => el.child(this.button(t, "files-save", this.saving ? "Saving…" : "Save", this.dirty, cx => this.save(cx)))))
      .children(this.notices(t))
      .when(!this.file, el => el.child(v_flex().id("files-tree").flex_1().min_h(0).overflow_y_scrollbar().p(6).children(this.rows("", 0, [], t))
        .when(Boolean(this.error) || !this.entries.get("")?.length, el => el.child(div().p(8).text_size(12).text_color(t.dim).child(this.error || (this.loading ? "Loading files…" : this.root ? "No files" : "No folder"))))
        .when(this.limited, el => el.child(div().p(8).text_size(11).text_color(t.dim).child("File list limited to 500 entries per folder and 5,000 total")))))
      .when(Boolean(this.file), el => el.child(this.code ? Editor.new(this.code).flex_1().min_h(0) : div().p(12).text_color(t.dim).child(this.fileError || "Loading file…")));
  }
}
