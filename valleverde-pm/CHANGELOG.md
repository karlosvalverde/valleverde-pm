# Changelog

All notable changes to Valleverde PM are recorded here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Planned for 0.2.0
- Opt-in Odoo connection with your own API key: your tasks, timesheets and email, run locally and limited to an explicit list of allowed requests.

## [0.1.0] - 2026-11-03

First release: a personal, offline project-management companion.

### Added
- **Today:** a daily overview of upcoming events, weekly goals, time logged and recent diary entries, with a start/stop timer.
- **Mail templates** in English and Spanish:
  - `{{placeholders}}` that fill in from the project and your details.
  - Copy the email, or open it in your mail app.
  - Example templates to start from.
- **Calendar:** month view with meetings, milestones, deadlines, deliveries and site visits, colored by project.
- **Weekly goals** with statuses, carry-over to the next week, and weekly notes.
- **Timesheet:** daily log against a target, a weekly grid by project, and a CSV export laid out for Odoo’s timesheet import.
- **Diary:** notes, decisions, meetings, issues, risks and change requests, with open/closed status, follow-up dates and Markdown export.
- **Projects** with colors, client contacts and a default email language.
- **Settings:** your details and signature, backup and restore.
- **Local launch:** `npm start`, or `start.sh` / `start.bat`, serves the app on `http://localhost:8080`, to this computer only.

### Data handling
- Fully offline: the page’s Content-Security-Policy blocks all network requests, and fonts are bundled.
- Your workspace is stored only in your browser. No accounts, servers or API keys.
