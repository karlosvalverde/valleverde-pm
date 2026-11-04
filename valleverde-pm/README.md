# Valleverde PM

A small desktop planner for project managers, for the step before Odoo. It works like a daily to-do note that does the time maths for you:

- **Week goals** for the projects that matter this week.
- **Tasks:** projects and their time-boxed actions, like `15m FU` or `Icons - 2h`.
- **Time left:** the durations in your open lines, added up and compared with what remains of your working day.
- **Projects:** a numbered sheet per project with its to-dos, schedule, SPOC, DB, current website, version, task link, deadline, BA, salesperson, languages involved, goal, references, apps, sitemap and notes.
- **Mail templates** in English, Spanish, French and Italian that fill in from the project, with a language review by Claude.
- **Website copy:** page-by-page copy for web design projects, in each of the site's languages.

Everything is saved to one file on your computer. Switch between Plan, Projects and Mail with the tabs or ⌘1, ⌘2, ⌘3.

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
| ⌘+L | Link a task to a project or one of its to-dos |
| ⌘+, | Settings |

You can also drag a line by the dots to its left.

- **Linking tasks:** hover a task and choose **Link**, or press ⌘L, to link it to a project. The picker finds projects by name or number.
  - For a single task or an action, you can then pick one of the project's open to-dos, or add the task as a new to-do. Checking it off in either place checks both.
  - Actions under a linked project line belong to that project.
- **Projects and goals:** a task whose text, or linked project, matches a week goal shows “Goal 1”, “Goal 2”, and so on. The goal shows how much time is planned for it today. Numbering like `1 - Partena` or `1. Partena` is ignored when matching.
- **Done items:** checking every action of a project checks the project, and done projects collect at the bottom.
- **Moving work:** when a previous day still has open tasks, a banner offers to bring them over. The originals are marked “Moved to …”, so nothing is counted twice. Open goals carry over the same way at the start of a week.
- **Sharing:** the ⋯ menu copies the day as text, in the same format as the note, or a week summary with the time done per project, ready for entering timesheets in Odoo. Linked tasks count under their project.

## Projects

**New project** opens a sheet with the next number. Change the number next to the name to match Odoo; the sheet warns if another project already uses it.

- **The list** sorts by number, deadline or name. It shows each project's first SPOC, its next phase, open to-dos and how soon it's due.
- **Select** lets you pick several projects to **Duplicate**, **Archive** or **Delete** together. **Duplicate** on a sheet copies one project, with everything reset to not done.
- **Project schedule:** a list of phases, each with an optional date and a check when done. New projects start with the list from Settings, which is Homepage design + design line definition, Website design, Content review / adjustments, Training / Q&A, Go live. Press Return in a phase to add one after it.
- **Dates:** the deadline and phase dates can stay empty (“No deadline”, “No date”) and be removed once set.
- **SPOC** takes one contact per line.
- **Links:** any field holding a link or a domain (like `partena.odoo.com`) gets an **Open** button.
- **Archive** moves a project out of the list without deleting it.

**Plan today**, next to a project to-do, adds it to today's plan under the project, linked. It keeps the link when carried over to another day. The plan's week lists the deadlines and phase dates that fall in it.

## Projects in Markdown and Notes

**Import** in the project list reads project notes saved as Markdown.

- **From Notes,** on macOS 26 or later: select the notes, choose File, then Export as, then Markdown, and choose the exported files.
- **For one note:** in Notes, choose Edit, then Copy as Markdown, and paste it into the import window.

Headings, bold labels (`**SPOC:**`, `**DB**: …`) and `Label: value` lines are recognised, in English or Spanish:

- **Project TODO’s** become to-dos, and a checklist keeps what's done.
- **Project schedule:** each line becomes a phase, with its date when one is written (`15/12/2026`, `15.12.2026` or `2026-12-15`). A block of `**Phase** - date` lines between `—` separators counts as the schedule even without a heading, and `xxx` or `?` means no date yet.
- **Fields:** SPOC, DB, Current website, Version, Task, Deadline, BA, Salesperson, Language, Goal, Referencias, Apps and Sitemap fill those fields.
- **Anything else,** including your own headings, goes to Notes.

The preview shows what was found before anything is imported. If a note matches a project you already have, you can update it (the note's details are added, nothing is removed) or add it as a new project.

**Export** on a sheet, or after **Select** in the list, saves projects as `.md` files laid out like a project note (bold labels, the schedule between `—` separators). `tools/fixtures/notes-export.md` is a real Notes export the importer is tested against. In Notes, File, then Import Markdown, turns them into notes, and they import back into the app unchanged. Website copy isn't included; it has its own export.

## Mail templates

Write each template in English, Spanish, French or Italian (or several), with the parts that change in `{{double braces}}`. Pick a project and these fill in by themselves:

| Placeholder | Filled with |
|---|---|
| `{{project}}`, `{{project_number}}` | The project name and number |
| `{{first_name}}`, `{{contact}}` | The first SPOC's first name and full name |
| `{{spoc_email}}` | Every email address in the SPOC field |
| `{{spoc}}`, `{{db}}`, `{{website}}`, `{{version}}`, `{{task_link}}`, `{{ba}}`, `{{languages}}`, `{{goal}}`, `{{sitemap}}`, `{{apps}}`, `{{notes}}` | That field of the project |
| `{{schedule}}` | The project's phases, with their dates |
| `{{deadline}}`, `{{date}}` | The deadline and today, written out in the email's language |
| `{{week}}` | This week's number |
| `{{my_name}}`, `{{signature}}` | Your details from Settings |

Anything else, like `{{next_steps}}`, becomes a blank to fill in, and the preview marks blanks that are still empty. **Copy email** copies the text; **Open in mail app** starts a new email to every SPOC address. Very long emails can get cut short by some mail apps on the way, so copy those instead.

**Review with Claude**, on an email or on a template you're editing, opens a new chat with a request to check spelling, grammar and tone in the email's language. It changes nothing in the app: you read the corrected version in Claude and copy it from there.

- **Which assistant:** Settings, then Language review and copywriting. Choose Claude in the desktop app (the default), Claude or ChatGPT in the browser, or Gemini.
- **Signing in:** the request opens in your own account, with your existing subscription. The app needs no API key and makes no network requests.
- **Sending:** Claude waits for you to press send. ChatGPT sends straight away.
- **Gemini, or long requests:** Gemini can't receive a request through a link, and very long requests don't fit in one. In those cases the request is copied for you to paste.

Spelling and grammar checks are on while you write templates, blanks and website copy, using the languages enabled in System Settings, then Keyboard, then Text Input.

**Write an email** on a project sheet opens the templates with that project chosen. Each project's email language is set in its Details. If you have a backup from version 0.1, **Import from version 0.1…** in the ⋯ menu adds its templates and projects.

## Website copy

The **Website copy** tab on a project holds the text for each page of the site.

- **Brief:** audience, tone of voice, key messages, SEO keywords and calls to action. The project's goal comes from Details.
- **Pages:** **Add pages from the sitemap** makes one page per line of the Sitemap field. Each page starts with a headline, subheadline, body text, call to action, SEO title (60 characters) and meta description (155 characters). Blocks can be renamed, changed, added or removed.
- **Languages** come from Languages involved, in Details, with one version of every block per language.
- **Writing with your assistant:** **Draft with Claude** sends the brief, the sitemap and the page's blocks, and asks for the answer under `[Block name]` labels. Once a page has text it becomes **Improve with Claude**. A page still empty in this language offers **Translate from ES**, or another language that has text. Copy the whole answer, choose **Paste the answer**, and the blocks fill in.
- **Sharing:** **Copy page** copies the page as text. **Export** saves the copy deck as Markdown, in one language or all of them.

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

The shell gives the page these commands:

- load, save, and check for outside changes;
- choose the data folder, and show the file;
- save Markdown files where you choose, to one file or to a folder;
- open a web link, an email draft or a new Claude Desktop chat. Only `http`, `https`, `mailto` and `claude://claude.ai/new` are allowed. The page has no other access to your disk, and the content-security policy blocks network requests.

## Licence

No licence yet: all rights reserved by the author.
