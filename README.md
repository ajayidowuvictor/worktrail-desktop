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
- Without internet, a "can't connect" page appears with a **Try again** button.

## Keyboard
F5 or Ctrl+R reload, F11 full screen, Alt+Left go back.

## For developers
- `npm install` then `npm start` runs it.
- `npm run dist` builds the Windows installer (done automatically by GitHub on every push).
- `WORKTRAIL_URL` changes the website address (used by the automatic self-check).
