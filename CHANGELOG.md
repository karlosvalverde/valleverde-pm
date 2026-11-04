# Changelog

All notable changes to Valleverde PM are recorded here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

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
