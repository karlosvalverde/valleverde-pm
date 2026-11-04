# Changelog

All notable changes to Valleverde PM are recorded here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

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
