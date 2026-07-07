JEE Pomodoro Flow PWA

This ZIP contains the full app:
- index.html
- style.css
- app.js
- manifest.json
- service-worker.js
- icon-192.png
- icon-512.png

Main features:
- Pomodoro timer
- Manual subject + question logging
- Weekly analytics generated dynamically from stored sessions
- Monthly analytics grouped by week
- First-run name prompt for leaderboard identity
- Firebase cloud sync for study records and leaderboard totals
- Hamburger menu navigation
- Local storage with cloud backup/sync when online
- Offline-capable PWA

How to use:
- Upload the files to GitHub Pages
- Open index.html or the GitHub Pages URL
- Install from Chrome / Add to Home Screen

Data notes:
- Session data is stored locally first, then queued to Firebase when online
- Leaderboard rows are shared across devices and ranked by total study time
- Clearing site data removes this device's local copy and identity
- Export backup is available from the menu

Easter eggs:
- About menu shows the creator credit
- Tap the title 7 times for a message
- Enayat's Challenge unlocks at 100 questions in a day


Version notes:
- Duplicate/dead code removed.
- Analytics indices separated for weekly and monthly views.
- Timer now uses monotonic time to avoid phone clock drift issues.
