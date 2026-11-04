# Changelog

All notable changes to Valleverde PM are recorded here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.5.1] - 2026-11-04

Markdown import and export adjusted to a real export from Notes on macOS 26.

### Added
- **Salesperson** and **References** fields on projects, in the order of a typical project note. Both fill `{{salesperson}}` and `{{references}}` in templates.

### Fixed
- The invisible line separators Notes writes (U+2028) no longer join lines together.
- **Titles in double bold** (`****Project****`) come through clean.
- **List items aren't read as labels,** so an app called “Website” under Apps stays an app.
- **Unknown bold labels** such as “SALESPERSON:” start their own section, instead of joining the field above.
- **A schedule between `—` separators,** written as `**Phase** - xxx` or `**Phase** - 15/12/2026`, becomes the project schedule without needing a heading.
- **Placeholders** like `xxx`, `?` and `-` count as empty, so “Deadline: ?” means no deadline yet.
- **Half-linked addresses** like `[https://site](https://site).com` are put back together.
- Lists keep one item per line, without bold markers.

### Changed
- **Exported files look like the original notes:** a bold title, `**Label:**` lines with Notes' line breaks, and the schedule as a checklist between `—` separators. Asterisks in the text are escaped.

## [0.5.0] - 2026-11-04

### Added
- **Import projects from Markdown:** files exported from Notes (File, then Export as, then Markdown, on macOS 26 or later), any `.md` or `.txt` file, or a note pasted after Edit, then Copy as Markdown.
  - Headings, bold labels and `Label: value` lines are recognised in English and Spanish, so “Project TODO’s”, “SPOC”, “DB”, “Current website”, “Deadline” and the rest land in the right place.
  - Checklists become to-dos, numbered or checked lists under the schedule become phases with their dates, and anything unrecognised goes to Notes.
  - A preview shows what was found. Projects that match existing ones can update them or be added as new.
- **Export projects to Markdown,** one from its sheet or several from Select. The files open in Notes (File, then Import Markdown) and import back into the app unchanged.
- **Language review:** Review with Claude, on an email or a template being edited, opens a new chat in your assistant with a request to check spelling, grammar and tone, in the email's language. Your assistant is set in Settings: Claude Desktop, Claude or ChatGPT in the browser, Gemini, or copy only.
- **French and Italian** for mail templates, with dates written in each language. The example templates come in all four languages.
- **Website copy** tab on each project:
  - A brief: audience, tone of voice, key messages, SEO keywords and calls to action, alongside the project goal.
  - Pages, which can be added from the sitemap. Each page has blocks (headline, subheadline, body text, call to action, list, SEO title, meta description), with character counts and limits for SEO.
  - One version per language listed under Languages involved.
  - Draft, Improve or Translate a page with your assistant, then paste its answer back to fill in the blocks.
  - Copy a page, or export the copy as Markdown, in one language or all of them.
- **Email language** per project, in Details.
- Spelling and grammar checks are on while writing emails and website copy.

### Changed
- The data file is now `schema: 5`. It adds website copy and the assistant setting.

## [0.4.0] - 2026-11-04

### Added
- **Project numbers:** every project gets the next number, which you can change to match Odoo. Numbers show in the list, on the sheet and in links, and fill `{{project_number}}`.
- **Duplicate** a project from its sheet, or several from the list.
- **Select** in the project list: pick several projects to duplicate, archive or delete them together.
- **Sort** the project list by number, deadline or name.
- **Project schedule** as a list of phases, each with an optional date and a check when done. New projects start with Homepage design + design line definition, Website design, Content review / adjustments, Training / Q&A and Go live; change that list in Settings.
  - The list and sheet show the next phase, and the plan's week shows phase dates that fall in it.
  - `{{schedule}}` writes the phases and dates into an email.
- **Links from the plan:** any task can be linked to a project, or to one of its to-dos, with Link or ⌘L.
  - Actions under a linked project line belong to that project.
  - From the picker, a task can also become a new to-do of the project.
  - Linked to-dos are checked off in both places.
  - Linked tasks are grouped under their project in the week summary.

### Changed
- **SPOC takes several lines,** one contact per line. Emails go to every address in it, and `{{first_name}}` greets the first contact.
- **Deadline can be left empty,** shown as “No deadline”, and removed once set.
- The data file is now `schema: 4`. A 0.3 project schedule written as text is kept at the end of the project's notes.

### Removed
- **Routines.** Their time no longer counts in the plan.
- **Matching projects to plan lines by name:** links are now set explicitly.

## [0.3.0] - 2026-11-04

Project notes and mail templates are back, inside the desktop app.

### Added
- **Projects:** a sheet for each project, with its own to-do list and these details: SPOC, DB, current website, version, task link, deadline, BA, languages involved, goal, sitemap, apps, project schedule and notes.
  - Links and bare domains in a field get an Open button.
  - The list is sorted by deadline, shows open to-dos and how soon each project is due, and keeps archived projects apart.
- **Plan today** on a project to-do adds it to today's plan under its project. Checking it in either place checks both, and carry-over keeps the link.
- **In the plan:** project lines link to their sheet, and the week shows the deadlines that fall in it.
- **Mail templates** in English and Spanish:
  - `{{placeholders}}` fill in from the chosen project and your details. For example, `{{first_name}}` and `{{spoc_email}}` come from the SPOC, and `{{deadline}}` is written out in the email's language.
  - Any other placeholder becomes a blank to fill in, and the preview marks the blanks still empty.
  - Copy the email or its subject, or open it in your mail app, addressed to the SPOC.
  - Four example templates to start from, and buttons to insert project details while editing.
- **Write an email** from a project sheet opens the templates with that project selected.
- **Import from version 0.1:** adds the templates and projects from a 0.1 backup file, skipping names you already have.
- **Settings:** your name, signature and default email language.
- Plan, Projects and Mail views, switched with ⌘1, ⌘2 and ⌘3.

### Changed
- The data file is now `schema: 3`. Files from 0.2 open as they are; version 0.2 won't edit a file saved by 0.3.
- The window opens a little wider.

## [0.2.0] - 2026-11-04

Valleverde PM becomes a local desktop app built with Tauri. It's a planning scratchpad that comes before Odoo, modeled on a daily to-do note.

### Added
- **Time budget:** time left is the sum of the durations written in open lines (`15m`, `2h`, `1h30`), compared with what remains of the working day: “1h15 free” or “45m over”.
- **Day ribbon:** a bar showing the time already gone, the work planned, the end of the day, and any overflow past it.
- **Tasks** as a keyboard-first outline of projects and their time-boxed actions. Projects show their open total; done projects collect at the bottom.
- **Week goals,** linked by name to the day's projects (“Goal 1”), with the time planned for each.
- **Routines:** recurring blocks added to every new day, which can be checked off or skipped for one day.
- **Carry-over:** open tasks from the previous day can be brought over in one click, and open goals from the previous week.
- **Copy day as text,** in the note's format, and **Copy week summary,** with time done per project for updating Odoo by hand.
- **Storage in one JSON file** in a folder you choose (iCloud Drive works), saved as you type, with a daily backup and the last 30 kept.
- A browser preview (`npm run preview`) for trying the interface without building the app.

### Removed
- The Odoo connection, the Cloudflare relay and the GitHub Pages deployment.
- Mail templates, the calendar, the project diary and the timesheet grid.
- Claude drafting and every API key.

## [0.1.0] - 2026-11-03

First version, as a web app on GitHub Pages connected to Odoo through a relay: mail templates in English and Spanish, calendar, weekly goals, timesheet and project diary.
