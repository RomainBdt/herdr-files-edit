# Files Edit for Herdr

A drop-in replacement for the Files panel of the [Herdr](https://herdr.dev) desktop
app. It shows the same tree of the focused terminal's folder, with the same git marks,
limits and look, and adds two things:

- **Edit a text file and save it.** Open a file from the tree, change it, press Save.
- **Right-click to copy a path.** Right-click a file or a folder in the tree and its
  full path goes to the clipboard.

It is a native Herdr mod (no web view). It's based on Herdr's built-in Files mod, which
it leaves alone: both can be installed together, and you choose which one a layout shows.

## What it does

- **The tree.** As Herdr's Files: the focused pane's folder, folders loaded as you open
  them, `A`/`M`/`D`/`U` marks from `git status`, at most 500 entries per folder and 5,000
  in all (it says so when a list is cut), refreshed every 10 seconds and when the folder
  changes.
- **Editing.** Click a file to open it in the editor, syntax-colored as before and now
  editable. Save is the button in the header (and Ctrl+S, see Limits).
  - **Unsaved changes show.** The header marks the file `● name · unsaved` and the Save
    button lights up; undoing back to what is on disk clears it. The back arrow asks
    before it throws unsaved changes away (Save, Discard or Keep editing). Changes also
    survive the panel following another terminal to a different folder, and are there
    when you come back.
  - **A save never silently replaces someone else's change.** Saving only writes if the
    file on disk is still exactly what the panel last read or wrote (Herdr's
    `writeTextFile` checks it). If something else changed the file, nothing is written: a
    bar says so, and you choose **Reload** (drop your changes, show the disk) or
    **Overwrite** (write yours over it). The panel also looks at the open file on its
    refresh: if you haven't edited it, it shows the new text; if you have, it raises the
    same bar. A file deleted from under you offers **Recreate**.
  - **Line endings are kept.** A file with CRLF line endings is edited and written back
    with CRLF.
  - **What stays read-only, and why.** A bar under the header says it:
    - *Binary file* (it holds a NUL): no text view at all, as in Herdr's Files.
    - *Larger than 400,000 characters*: only the start is shown, so saving it would cut
      the rest off.
    - *Not valid UTF-8* (it holds U+FFFD): a save could damage it.
    - *Mixed or old-style line endings*: a save would change them.
    - *On another machine*: Herdr can only write files on this computer.
    - A file over 1 MiB, or one that can't be read, can't be shown.
- **Right-click.** On a row, a right-click copies the full path, written the way the
  system writes it (`C:\Users\you\project\src\main.js` on Windows, `/home/you/project/src`
  elsewhere), and the header shows `✓ Path copied · name` for a moment. The right-click
  does not open or close a folder, and doesn't open a file.

## What it runs

The same as Herdr's Files: a directory listing (`powershell` on Windows, `sh`
elsewhere, on the pane's machine for spaces on another machine) and
`git rev-parse` and `git status` in the folder. Saving calls Herdr's `writeTextFile`.
Copying uses the clipboard. The mod makes no network request and has no update check.

## Install

From your own copy of this repository, copy the mod into Herdr's mods folder:

```sh
cp -R mods/files-edit ~/.config/herdr-app/mods/
```

On Windows (PowerShell):

```powershell
Copy-Item -Recurse mods\files-edit $HOME\.config\herdr-app\mods\
```

That adds one folder, `mods/files-edit`, and changes nothing else: no other mod, layout
or setting is touched, and nothing changes on screen until you point a layout at it.

If you already have a mod called `files-edit`, rename this one's folder, and the
`mods/files-edit/` paths in `main.js`, to match.

### Updating

An installed copy never checks for updates and never contacts anything. To update, do it
by hand from your own copy of this repository:

```sh
git pull   # or bring your changes in however you keep this copy
rm -rf ~/.config/herdr-app/mods/files-edit && cp -R mods/files-edit ~/.config/herdr-app/mods/
```

## Switch the Files panel to it

Herdr's own layouts and mods are replaced on every start, so you don't edit them. Instead
you make a clone of the layout you use, and the clone's Files panel shows this mod. The
layout you use now stays exactly as it is.

1. Find your layout's name (`"layout"` in `herdr-app status`; Herdr's default is `main`, used below: put yours in its place),
   and clone it. `layout.clone` switches the window to the clone:

   ```sh
   herdr-app do layout.clone '{"name":"main","as":"main-files-edit"}'
   ```

2. Point the clone's Files panel at the mod:

   ```sh
   node scripts/files-edit-layout.mjs apply ~/.config/herdr-app/layouts/main-files-edit.json
   ```

   The script changes the block with `"id": "files"`, its `content.mod` (`files` →
   `files-edit`) and, where the block names Herdr's file icon, that icon's path
   (`mods/files/file.svg` → `mods/files-edit/file.svg`). It edits the text in place and
   checks first that nothing else would differ; if anything is off it writes nothing.
   It refuses Herdr's own layouts (`main`, `terminals`, `win98`) and a Herdr without this
   mod installed. By hand, it is those same one or two lines.

Herdr follows the file within a second. The panel keeps its id (`files`), so the tab
bar's **Files** button, its key and the panel's place in the layout all work as before;
the other panels, mods and the rest of the layout are not touched.

### Going back

```sh
herdr-app do layout.switch '{"name":"main"}'
rm ~/.config/herdr-app/layouts/main-files-edit.json ~/.config/herdr-app/layouts/.state/main-files-edit.json
rm -rf ~/.config/herdr-app/mods/files-edit
```

The first line shows your original layout again (`ctrl-shift-l` cycles through
layouts too). The second removes the clone and the sizes Herdr kept for it, and the third
removes the mod; both can wait if you want to switch back and forth. Nothing of your
original layout, `keys.json`, `settings.json` or any other mod was changed, so there is
nothing to undo there. To go back without removing the clone, run
`node scripts/files-edit-layout.mjs restore <the clone's file>`: the clone shows Herdr's
Files again, byte for byte as it was.

## Limits

- **Not yet seen running in Herdr's window.** What has been checked: the mod loads and
  builds its first frame under `herdr-app check`; every call it makes type-checks against
  Herdr's own `herdr.d.ts` and `gpui-kit.d.ts`; and `npm test` runs the real `main.js`
  against stand-ins for Herdr's API and a real folder on disk (saving, conflicts, drafts,
  right-click, line endings, read-only cases). What has not been seen: the panel on
  screen, the real editor taking keystrokes, the real right-click and clipboard.
- **Ctrl+S** is wired through the panel's key handler, but whether Herdr's editor passes
  that key up hasn't been confirmed. The Save button always works.
- **Right-click** is handled on the press, and a click that follows it is dropped, so it
  can't open a folder. That the real window delivers it as assumed hasn't been confirmed.
- Unsaved changes live in the panel. Closing Herdr, or Herdr closing the panel, loses
  them; the back arrow and a change of folder keep or ask.
- Writes happen only on this computer. A file in a space on another machine is shown
  read-only.
- Tested on Windows only. Saving is Herdr's `writeTextFile`: it replaces the file
  atomically, so a file that is a symbolic link or has special permissions behaves as
  Herdr does, not specially here.
- The conflict check compares what the file holds with what the panel last read, so a
  change that happens to put back the same text is not a conflict.

## Development

```sh
npm test
```

`tests/edit.test.mjs` covers the pure parts (`mods/files-edit/edit.js`),
`tests/view.test.mjs` runs `main.js` against fakes of `herdr`, `gpui-kit` and `gpui-base`
(`tests/fakes`) and a real temporary folder, and `tests/layout.test.mjs` covers the layout
script: it changes only the Files block, and `restore` returns the same bytes.

`herdr-app check ~/.config/herdr-app/mods/files-edit` loads the installed mod.

## License

MIT for what this repository adds, see [LICENSE](LICENSE). The tree, listing and git
marks come from Herdr's built-in Files mod and stay under Herdr's terms. The chevron and
folder icons are Lucide (ISC, see `mods/files-edit/LICENSE-lucide.txt`).
