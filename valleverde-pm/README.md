# Valleverde PM

A small desktop planner for project managers, for the step before Odoo. It works like a daily to-do note that does the time maths for you:

- **Week goals** for the projects that matter this week.
- **Routines,** like `15m PM Formech`, added to every day.
- **Tasks:** projects and their time-boxed actions, like `15m FU` or `Icons - 2h`.
- **Time left:** the durations in your open lines, added up and compared with what remains of your working day.

Everything is saved to one file on your computer.

## Using it

Type the way you would in a note. Write a duration anywhere in a line (`15m`, `2h`, `1h30`, `1.5h`) and it counts toward the time left.

| Keys | What it does |
|---|---|
| Return | New line |
| Tab, Shift+Tab | Make a task part of the project above, or a project of its own |
| ⌘+Return | Check or uncheck the line |
| Option+↑ / ↓ | Move the line, or the whole project |
| ← → T | Previous day, next day, today (when not typing) |
| N | Add a task (when not typing) |
| ⌘+, | Settings |

You can also drag a line by the dots to its left.

- **Projects and goals:** a project whose name matches a week goal shows “Goal 1”, “Goal 2”, and so on. The goal shows how much time is planned for it today. Numbering like `1 - Partena` or `1. Partena` is ignored when matching.
- **Done items:** checking every action of a project checks the project, and done projects collect at the bottom.
- **Moving work:** when a previous day still has open tasks, a banner offers to bring them over. The originals are marked “Moved to …”, so nothing is counted twice. Open goals carry over the same way at the start of a week.
- **Sharing:** the ⋯ menu copies the day as text, in the same format as the note, or a week summary with the time done per project, ready for entering timesheets in Odoo.

## Your data

Your data lives in `valleverde.json`, saved as you type. Before the first change each day, a copy goes to `backups/` next to it; the last 30 are kept.

- **Where it starts:** in the app's data folder. On macOS that's `~/Library/Application Support/com.karlosvalverde.valleverdepm/`.
- **Moving it:** Settings, then **Choose folder…**. Pick a folder in iCloud Drive and the same file works on your other Macs; the app reloads it when you come back to the window. If both Macs edit at the same moment, the last save wins, and the backups folder has the earlier copies.
- **Restoring a backup:** quit the app, copy a file from `backups/` over `valleverde.json`, and open the app again.

See [PRIVACY.md](PRIVACY.md).

## Build it

You need:

- **Node.js 18 or newer.**
- **Rust,** installed with [rustup](https://rustup.rs).
- **On macOS, the Xcode command line tools:** run `xcode-select --install`.

Other platforms need the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/).

```bash
git clone https://github.com/karlosvalverde/valleverde-pm.git
cd valleverde-pm
npm install
npm run dev      # opens the app with live reload of src/
npm run build    # makes the installable app
```

The first build downloads and compiles the Rust dependencies, which takes a few minutes; later builds are quick.

`npm run build` puts the app in `src-tauri/target/release/bundle/`, as `macos/Valleverde PM.app` and a `dmg/` installer. Drag the app to Applications. Because you built it yourself, macOS opens it without a warning.

To try the interface without Rust, run `npm run preview` and open http://localhost:8080. In the preview, data is kept in that browser instead of a file.

## Releases

Pushing a version tag runs `.github/workflows/release.yml`, which builds a universal macOS app and attaches it to a draft GitHub release. Copies downloaded from there aren't notarized by Apple. The first time you open one, macOS blocks it: go to System Settings, then Privacy & Security, and choose **Open Anyway**. Notarizing needs a paid Apple Developer account.

To release a version:

1. Update the version in `package.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml` and `APP_VERSION` in `src/app.js`.
2. Move the changes under **Unreleased** in [CHANGELOG.md](CHANGELOG.md) to a new `## [x.y.z] - date` heading.
3. Run `npm run check`, which confirms the versions match and runs the logic tests.
4. Commit, tag and push:

```bash
git commit -am "Release v0.2.1"
git tag v0.2.1
git push && git push --tags
```

## How it's built

```
src/                 the interface: plain HTML, CSS and JavaScript, no build step
  core.js            durations, outline operations, carry-over, text exports (tested)
  app.js             the page: outline editor, time budget, settings
src-tauri/           the desktop shell (Rust)
  src/lib.rs         reads and writes the data file, backups, folder choice
tools/check.js       release checks and tests for core.js
tools/preview.js     serves src/ for the browser preview
```

The shell gives the page five commands: load, save, check for outside changes, choose a folder, and show the file. The page has no other access to your disk, and the content-security policy blocks network requests.

## Licence

No licence yet: all rights reserved by the author.
