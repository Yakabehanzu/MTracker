# Money Tracker

A personal budget planner and money tracker in Rupiah, installable as an app (desktop, Android, iPhone).

- Sign in with Google; the app reads and writes its owner's Google Sheet and a receipts folder in Google Drive.
- No data lives in this repository or on any server: entries, amounts and receipts stay in the owner's Google account,
  and only Google accounts the sheet is shared with can open them.

## Files

| File | What it is |
|---|---|
| `index.html` | The dashboard (built from the project's main page) |
| `backend.js` | Talks to Google Sheets and Drive with the signed-in person's own Google token |
| `app-shell.js` | Install button, iPhone tip, sign-out, offline loading |
| `config.js` | The app's public Google Client ID and the sheet it uses |
| `sw.js` | Offline helper: keeps the app itself on the device (never caches data) |
| `manifest.webmanifest`, `icons/` | App name, colours and icons for installing |
