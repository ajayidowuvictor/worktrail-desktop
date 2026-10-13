# Rockmines WorkTrail (Windows program)

A Windows program for Rockmines Geo-Environmental Services Limited. It opens
**rockminesgeo.com/worktrail/** in its own window, with its own icon, a welcome
animation, and a friendly page when the internet is down. All data stays on the
website, so the General Manager always sees everyone's work as it happens.

Developed by JustNew.

## Get the installer
1. Open the **Releases** page of this repository (right-hand side of the main page).
2. Click the newest release, then click **Rockmines-WorkTrail-Setup-x.y.z.exe** to download it.
3. Double-click the downloaded file. WorkTrail installs itself and opens.
4. If Windows shows a blue "Windows protected your PC" box, click **More info**, then **Run anyway**.

## What staff see
- Click the **Rockmines WorkTrail** icon: the welcome animation plays (click anywhere to skip).
- WorkTrail opens and shows the sign-in box. People stay signed in on that PC.
- Only WorkTrail is shown: the website's own menu, banner, footer and WordPress bar are hidden inside the program (the website in a browser is unchanged).
- **File → Log out** signs out on that PC.
- Closing the window keeps the program running near the clock. Pop-ups appear for new tasks and messages. Right-click the icon to quit, or to turn on **Start with Windows**.
- Updates download by themselves; the program asks before restarting. **Help → Check for updates** checks straight away.
- Without internet, a "can't connect" page appears with a **Try again** button.

## Keyboard
F5 or Ctrl+R reload, F11 full screen, Alt+Left go back.

## For developers
- `npm install` then `npm start` runs it.
- `npm run dist` builds the Windows installer (done automatically by GitHub on every push).
- Every push to `main` builds a release `v<APP_BASE>.<build number>` (see `APP_BASE` in the workflow) with `latest.yml`, which installed programs read to find updates. The repository must be public (or the files hosted elsewhere) for staff PCs to download installers and updates.
- `WORKTRAIL_URL` changes the website address (used by the automatic self-check).
