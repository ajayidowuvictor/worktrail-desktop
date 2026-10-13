'use strict';
/* Rockmines WorkTrail for Windows.
   A window around rockminesgeo.com/worktrail/ with a welcome animation, its own
   icon, and a friendly page when the internet is down. All data stays on the
   website, so the General Manager always sees everyone's work as it happens. */

const { app, BrowserWindow, WebContentsView, Menu, ipcMain, shell, session } = require('electron');
const fs = require('fs');
const path = require('path');

const SITE_URL = process.env.WORKTRAIL_URL || 'https://rockminesgeo.com/worktrail/';
const SITE_ORIGIN = new URL(SITE_URL).origin;
const PARTITION = 'persist:worktrail'; // keeps people signed in between launches
const LOAD_TIMEOUT_MS = 30000;
const TITLE = 'Rockmines WorkTrail';

app.setAppUserModelId('com.justnew.rockmines.worktrail');

if (!app.requestSingleInstanceLock()) {
	app.quit();
}

let win = null;
let site = null; // the WorkTrail website, shown once the welcome animation ends
let siteState = 'loading'; // loading | ready | failed
let failInfo = '';
let entered = false;
let loadTimer = null;

/* ---------- window size memory ---------- */

function stateFile() {
	return path.join(app.getPath('userData'), 'window-state.json');
}

function readState() {
	try {
		const s = JSON.parse(fs.readFileSync(stateFile(), 'utf8'));
		if (s && Number.isFinite(s.width) && Number.isFinite(s.height)) return s;
	} catch (e) { /* first launch */ }
	return { width: 1360, height: 860, maximized: false };
}

function saveState() {
	if (!win || win.isDestroyed()) return;
	try {
		const b = win.isMaximized() || win.isFullScreen() ? win.getNormalBounds() : win.getBounds();
		fs.writeFileSync(stateFile(), JSON.stringify({ ...b, maximized: win.isMaximized() }));
	} catch (e) { /* not important */ }
}

/* ---------- the website view ---------- */

function setSiteState(state) {
	siteState = state;
	if (win && !win.isDestroyed()) win.webContents.send('site-state', state);
}

function layoutSite() {
	if (!win || win.isDestroyed() || !site || !entered) return;
	const b = win.getContentBounds();
	site.setBounds({ x: 0, y: 0, width: b.width, height: b.height });
}

function createSite() {
	if (site) {
		try { win.contentView.removeChildView(site); } catch (e) { /* not attached */ }
		try { site.webContents.close(); } catch (e) { /* already closed */ }
	}
	site = new WebContentsView({
		webPreferences: {
			partition: PARTITION,
			contextIsolation: true,
			sandbox: true,
			nodeIntegration: false,
		},
	});
	const wc = site.webContents;

	wc.on('did-finish-load', () => {
		if (siteState === 'loading') {
			clearTimeout(loadTimer);
			setSiteState('ready');
		}
	});
	wc.on('did-fail-load', (_e, code, desc, url, isMainFrame) => {
		if (!isMainFrame || code === -3) return; // -3 = cancelled by a redirect
		clearTimeout(loadTimer);
		failInfo = desc || String(code);
		setSiteState('failed');
		if (entered) showOffline();
	});
	wc.on('did-navigate', (_e, url, httpCode) => {
		if (httpCode >= 500 && url.startsWith(SITE_ORIGIN)) {
			failInfo = 'server code ' + httpCode;
			setSiteState('failed');
			if (entered) showOffline();
		}
	});

	// Links: same website opens in a program window (so downloads and sign-in keep working);
	// anything else opens in the normal browser.
	wc.setWindowOpenHandler(({ url }) => {
		if (url.startsWith(SITE_ORIGIN)) {
			return {
				action: 'allow',
				overrideBrowserWindowOptions: { autoHideMenuBar: true, icon: iconPath(), title: TITLE },
			};
		}
		if (/^https?:/i.test(url)) shell.openExternal(url);
		return { action: 'deny' };
	});
	wc.on('will-navigate', (event, url) => {
		if (!url.startsWith(SITE_ORIGIN)) {
			event.preventDefault();
			if (/^https?:/i.test(url)) shell.openExternal(url);
		}
	});

	// Keyboard shortcuts (the program has no menu bar).
	wc.on('before-input-event', (event, input) => {
		if (input.type !== 'keyDown') return;
		const ctrl = input.control || input.meta;
		if (input.key === 'F5' || (ctrl && input.key.toLowerCase() === 'r')) {
			event.preventDefault();
			wc.reload();
		} else if (input.key === 'F11') {
			event.preventDefault();
			win.setFullScreen(!win.isFullScreen());
		} else if (input.alt && input.key === 'ArrowLeft' && wc.navigationHistory.canGoBack()) {
			event.preventDefault();
			wc.navigationHistory.goBack();
		}
	});
}

function loadSite() {
	siteState = 'loading';
	failInfo = '';
	createSite();
	clearTimeout(loadTimer);
	loadTimer = setTimeout(() => {
		if (siteState === 'loading') {
			failInfo = 'timed out';
			setSiteState('failed');
			if (entered) showOffline();
		}
	}, LOAD_TIMEOUT_MS);
	site.webContents.loadURL(SITE_URL);
}

function enterSite() {
	if (!win || win.isDestroyed() || !site) return;
	entered = true;
	win.contentView.addChildView(site);
	layoutSite();
	site.webContents.focus();
}

function showOffline() {
	if (!win || win.isDestroyed()) return;
	entered = false;
	if (site) {
		try { win.contentView.removeChildView(site); } catch (e) { /* not attached */ }
	}
	win.loadFile(path.join(__dirname, 'offline', 'offline.html'), { query: { why: failInfo } });
}

/* ---------- main window ---------- */

function iconPath() {
	return path.join(__dirname, '..', 'build', 'icon.png');
}

function createWindow() {
	const st = readState();
	win = new BrowserWindow({
		width: st.width,
		height: st.height,
		x: st.x,
		y: st.y,
		minWidth: 1000,
		minHeight: 640,
		show: false,
		backgroundColor: '#ffffff',
		title: TITLE,
		icon: iconPath(),
		autoHideMenuBar: true,
		webPreferences: {
			preload: path.join(__dirname, 'preload.js'),
			contextIsolation: true,
			sandbox: true,
			nodeIntegration: false,
		},
	});
	Menu.setApplicationMenu(null);
	if (st.maximized) win.maximize();

	win.on('page-title-updated', (e) => e.preventDefault());
	win.once('ready-to-show', () => win.show());
	win.on('resize', layoutSite);
	win.on('maximize', layoutSite);
	win.on('unmaximize', layoutSite);
	win.on('enter-full-screen', layoutSite);
	win.on('leave-full-screen', layoutSite);
	win.on('close', saveState);
	win.on('closed', () => { win = null; });

	win.loadFile(path.join(__dirname, 'splash', 'splash.html'));
	loadSite(); // loads in the background while the welcome animation plays
}

/* ---------- messages from the program's own screens ---------- */

ipcMain.handle('site-state', () => siteState);
ipcMain.handle('version', () => app.getVersion());

ipcMain.on('enter', () => {
	if (siteState === 'ready') enterSite();
	else if (siteState === 'failed') showOffline();
});

ipcMain.on('retry', () => {
	// Shown after a failure: try again, and go straight in (no second animation).
	loadSite();
	if (win && !win.isDestroyed()) {
		win.loadFile(path.join(__dirname, 'splash', 'splash.html'), { query: { quick: '1' } });
	}
});

/* ---------- start-up ---------- */

app.on('second-instance', () => {
	if (win) {
		if (win.isMinimized()) win.restore();
		win.focus();
	}
});

app.whenReady().then(() => {
	const ses = session.fromPartition(PARTITION);
	// The website never needs the camera, microphone, location and so on.
	ses.setPermissionRequestHandler((_wc, permission, callback) => {
		callback(['notifications', 'clipboard-sanitized-write', 'fullscreen'].includes(permission));
	});
	createWindow();
	if (process.env.WORKTRAIL_SMOKE) {
		// Automated self-check used by the GitHub build (never set on staff PCs).
		require('./smoke')({
			app,
			getWin: () => win,
			getSite: () => site,
			getState: () => siteState,
			showOffline,
			siteUrl: SITE_URL,
		});
	}
	app.on('activate', () => {
		if (BrowserWindow.getAllWindows().length === 0) createWindow();
	});
});

app.on('window-all-closed', () => app.quit());
