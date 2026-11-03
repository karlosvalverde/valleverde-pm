# Valleverde PM

A personal, offline project-management companion. It keeps the day-to-day tools of a project manager in one place:

- bilingual mail templates (English and Spanish)
- a project calendar
- weekly goals
- a daily timesheet
- a project diary

It runs on your own computer and never sends anything over the network. Version 0.1 doesn’t connect to Odoo; see [Using it with Odoo](#using-it-with-odoo).

## Install

You need **Node.js 18 or newer** ([nodejs.org](https://nodejs.org)). There’s nothing else to install.

1. Download the latest `valleverde-pm-x.y.z.zip` from [Releases](https://github.com/karlosvalverde/valleverde-pm/releases).
2. Optionally, check that the download is intact by comparing its checksum with the `.sha256` file next to it in the release:
   ```bash
   shasum -a 256 valleverde-pm-0.1.0.zip           # macOS / Linux
   certutil -hashfile valleverde-pm-0.1.0.zip SHA256   # Windows
   ```
3. Unzip it anywhere you like, for example in your home folder.

## Start

Choose one:

- **Terminal:** run `npm start` inside the unzipped folder.
- **macOS / Linux:** run `./start.sh`.
- **Windows:** double-click `start.bat`.

Your browser opens **http://localhost:8080**. Keep the terminal window open while you use the app, and press `Ctrl+C` to stop it.

You can also give it its own app window. In Chrome, open the menu, then **Cast, save and share**, then **Install page as app**. In Edge, open the menu, then **Apps**, then **Install this site as an app**. Menu names can vary between browser versions.

Without Node.js, Python 3 also works: `python3 -m http.server 8080 --bind 127.0.0.1 --directory app`. Python doesn’t send the security headers that `server.js` adds, but the app’s own Content-Security-Policy still keeps it offline.

## Your data

- **Where it lives:** your workspace is saved in your browser for the address `http://localhost:8080`, and nowhere else.
- **Same address every time:** a different port or a different browser opens a separate, empty workspace.
- **Backups:** use **Settings, then Your data, then Download backup** regularly. Use **Restore from backup** to move your workspace to another computer or browser.
- **Updates keep your data:** download the new release, unzip it (you can replace the old folder), and start it as usual.

See [PRIVACY.md](PRIVACY.md) for details.

## Using it with Odoo

Version 0.1 is deliberately unconnected. You move your work into Odoo yourself:

- **Emails:** compose from a template, copy it, then paste it into the task’s chatter in Odoo (Send message), or click **Open in mail app**.
- **Timesheets:**
  1. On the Timesheet screen, click **Export week as CSV**.
  2. In Odoo, go to **Timesheets**, open the gear menu, then choose **Import records**.
  3. Upload the file. The columns are named after Odoo’s timesheet fields (`date`, `project_id`, `task_id`, `name`, `unit_amount`), so Odoo maps them automatically.
  4. Click **Test** before **Import**.

  Use the same project and task names as in Odoo so they match.

An opt-in direct connection is planned for 0.2.

## Development

```bash
git clone https://github.com/karlosvalverde/valleverde-pm.git
cd valleverde-pm
npm start          # run the app
npm run check      # release checks: syntax, versions, offline guarantee, fonts
npm run build      # build dist/valleverde-pm-<version>.zip and its checksum
```

### Repository layout

```
app/index.html      the whole app (HTML, CSS, JS)
app/fonts/          bundled fonts (SIL Open Font License, see OFL.txt)
server.js           local server, no dependencies
start.sh, start.bat launchers
tools/              check, build and release-notes scripts
.github/workflows/  ci.yml (checks on every push), release.yml (publishes releases)
```

### Versioning and releases

Valleverde PM follows [Semantic Versioning](https://semver.org/). While it’s at 0.x, minor versions (0.2, 0.3…) add features and patch versions (0.1.1) fix bugs.

To release:

1. Update `version` in `package.json` and `APP_VERSION` in `app/index.html`.
2. Move the notes under **Unreleased** in [CHANGELOG.md](CHANGELOG.md) to a new `## [x.y.z] - YYYY-MM-DD` section.
3. Run `npm run check`.
4. Commit, tag and push:
   ```bash
   git commit -am "Release v0.1.1"
   git tag v0.1.1
   git push && git push --tags
   ```

GitHub Actions then checks the tag against `package.json`, runs the checks, builds the zip and checksum, and publishes a GitHub release with the changelog notes.

## Licence

No licence chosen yet, so all rights are reserved by the author. The bundled fonts are under the SIL Open Font License (`app/fonts/OFL.txt`).
