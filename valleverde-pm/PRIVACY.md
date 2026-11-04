# Privacy

Valleverde PM keeps everything on your computer.

- Your data is one file, `valleverde.json`, in the folder shown in Settings. Daily copies go to the `backups` folder next to it.
- **The only network request the app makes is reading the calendars you add by address**, from the address you pasted, over HTTPS. It sends nothing else: no accounts, analytics or API keys. The request is made by the app itself; the page you see still can't reach the network, as its content-security policy allows no connections.
- A calendar's secret address is stored in your data file, and its events are kept on each Mac in the app's own storage. Anyone who has the secret address can read that calendar, so treat it like a password: if it leaks, reset it in your calendar's settings and add the new one.
- An imported `.ics` file is read once; its events are stored in your data file.
- If you put the data folder in a synced location such as iCloud Drive, that service stores and syncs the file, including any calendar addresses, under your own account.
