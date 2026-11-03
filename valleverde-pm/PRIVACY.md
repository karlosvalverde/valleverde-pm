# How Valleverde PM handles data (v0.1)

Valleverde PM 0.1 is a personal tool that works entirely offline.

**Where your data lives.** Your workspace (projects, templates, events, goals, time entries, diary entries and settings) is saved in your browser, on your computer, for the address `http://localhost:8080`. It isn’t uploaded anywhere.

**What leaves your computer.** Nothing. This is enforced rather than promised:
- The page carries a Content-Security-Policy with `connect-src 'none'`, so the browser refuses any network request the page might attempt.
- Fonts are bundled with the app, so no third-party server is contacted.
- The local server only answers requests from this computer, and it holds no data of its own.

The only time anything leaves the app is when you act yourself: clicking **Open in mail app** hands the email to your mail program, and downloads save files to your computer.

**Your responsibilities.** Because everything stays on your device:
- **Back it up:** download a backup from **Settings, Your data** regularly. Clearing your browser data, or switching browser or computer, leaves the workspace behind.
- **Follow your employer’s rules:** if you write notes about clients or colleagues, treat this like any work notebook and follow your organization’s rules for data on your device.

**Odoo.** Version 0.1 doesn’t connect to Odoo. You move work into Odoo yourself, by copying emails into chatter and importing the timesheet CSV through Odoo’s own import screen.
