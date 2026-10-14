'use strict';
/* Rockmines WorkTrail for Windows.
   A window around rockminesgeo.com/worktrail/ with a welcome animation, its own
   icon, a menu with Log out, an icon near the clock that keeps it running with
   pop-ups for new tasks and messages, automatic updates, and a friendly page when
   the internet is down. All data stays on the website, so the General Manager
   always sees everyone's work as it happens. */

const { app, BrowserWindow, WebContentsView, Menu, Tray, Notification, ipcMain, shell, session, dialog, nativeImage } = require('electron');
const fs = require('fs');
const path = require('path');

const SITE_URL = process.env.WORKTRAIL_URL || 'https://rockminesgeo.com/worktrail/';
const SITE_ORIGIN = new URL(SITE_URL).origin;
const PARTITION = 'persist:worktrail'; // keeps people signed in between launches
const LOAD_TIMEOUT_MS = 30000;
const POLL_MS = 60 * 1000;
const TITLE = 'Rockmines WorkTrail';
const SITE_PRELOAD = path.join(__dirname, 'site-preload.js');
const START_HIDDEN = process.argv.includes('--hidden'); // used when Windows starts the program at sign-in

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
let tray = null;
let quitting = false;
let trayHintShown = false;
let hiddenAt = 0; // when the window was last tucked away near the clock (0 = not hidden)
// Away this long and the welcome animation plays again on the way back in.
const AWAY_MS = 30 * 60 * 1000;
let updates = null;
const liveToasts = new Set();

// Notification watching
let seen = new Set();
let firstPoll = true;
let lastChat = 0;
let lastReload = 0;
let pollTimer = null;

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

/* ---------- small settings kept on this computer ---------- */

function settingsFile() {
	return path.join(app.getPath('userData'), 'settings.json');
}

function welcomeSoundOn() {
	try { return JSON.parse(fs.readFileSync(settingsFile(), 'utf8')).welcomeSound !== false; } catch (e) { return true; }
}

function setWelcomeSound(on) {
	try { fs.writeFileSync(settingsFile(), JSON.stringify({ welcomeSound: !!on })); } catch (e) { /* not important */ }
	if (tray) tray.setContextMenu(trayMenu());
	try { Menu.setApplicationMenu(buildMenu()); } catch (e) { /* not important */ }
}

function splashOptions() {
	// The welcome sound is off in the automated self-check and for the quick start at Windows sign-in.
	return { query: { sound: welcomeSoundOn() && !process.env.WORKTRAIL_SMOKE ? '1' : '0' } };
}

/* ---------- small helpers ---------- */

function iconPath() {
	return path.join(__dirname, '..', 'build', 'icon.png');
}

function toast(title, body, onClick) {
	try {
		if (!Notification.isSupported()) return;
		const n = new Notification({ title, body, icon: iconPath() });
		liveToasts.add(n); // keep a reference so it is not cleaned up before it is shown
		n.on('close', () => liveToasts.delete(n));
		if (onClick) n.on('click', onClick);
		n.show();
	} catch (e) { /* pop-ups are a bonus, never a problem */ }
}

function windowInUse() {
	if (process.env.WORKTRAIL_SMOKE) return false; // the self-check wants to see every pop-up decision
	return !!win && !win.isDestroyed() && win.isVisible() && !win.isMinimized() && win.isFocused();
}

function showMainWindow() {
	if (!win || win.isDestroyed()) {
		createWindow();
		return;
	}
	hiddenAt = 0;
	if (win.isMinimized()) win.restore();
	win.show();
	win.focus();
	if (updates && updates.hasReady()) updates.promptRestart();
}

// Opening the program from its icon: after a long time away, the welcome animation plays again.
// (Clicking a pop-up alert goes straight to the work, never through the animation.)
function reopenWindow() {
	if (!win || win.isDestroyed()) {
		createWindow();
		return;
	}
	if (hiddenAt && Date.now() - hiddenAt >= AWAY_MS) replayWelcome();
	showMainWindow();
}

function replayWelcome() {
	if (!win || win.isDestroyed()) return;
	entered = false;
	if (site) {
		try { win.contentView.removeChildView(site); } catch (e) { /* not attached */ }
	}
	setChrome(false);
	win.loadFile(path.join(__dirname, 'splash', 'splash.html'), splashOptions());
	loadSite(); // fresh copy of the website loads while the animation plays
}

function openRoute(hash) {
	showMainWindow();
	if (site && entered) {
		site.webContents.executeJavaScript('location.hash = ' + JSON.stringify(hash)).catch(() => {});
	}
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

function setChrome(on) {
	// The menu bar is shown while WorkTrail (or the "no internet" page) is on screen, not during the welcome animation.
	if (!win || win.isDestroyed()) return;
	win.setMenuBarVisibility(!!on);
	setTimeout(layoutSite, 80);
}

function createSite() {
	if (site) {
		try { win.contentView.removeChildView(site); } catch (e) { /* not attached */ }
		try { site.webContents.close(); } catch (e) { /* already closed */ }
	}
	site = new WebContentsView({
		webPreferences: {
			partition: PARTITION,
			preload: SITE_PRELOAD,
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
		// A server error, or the website briefly losing its pages (404/403), is shown as the friendly screen.
		if ((httpCode >= 500 || httpCode === 404 || httpCode === 403) && url.startsWith(SITE_ORIGIN)) {
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
				overrideBrowserWindowOptions: {
					autoHideMenuBar: true,
					icon: iconPath(),
					title: TITLE,
					webPreferences: { preload: SITE_PRELOAD, contextIsolation: true, sandbox: true, nodeIntegration: false },
				},
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

	// Keyboard shortcuts.
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
	setChrome(true);
	layoutSite();
	site.webContents.focus();
	if (!process.env.WORKTRAIL_SMOKE) schedulePoll(4000); // the self-check asks for its own look
}

function showOffline() {
	if (!win || win.isDestroyed()) return;
	entered = false;
	if (site) {
		try { win.contentView.removeChildView(site); } catch (e) { /* not attached */ }
	}
	setChrome(true);
	win.loadFile(path.join(__dirname, 'offline', 'offline.html'), { query: { why: failInfo } });
}

/* ---------- log out ---------- */

async function logOut(ask = true) {
	if (ask) {
		const r = await dialog.showMessageBox(win && win.isVisible() ? win : undefined, {
			type: 'question',
			title: TITLE,
			buttons: ['Log out', 'Cancel'],
			defaultId: 1,
			cancelId: 1,
			message: 'Log out of WorkTrail on this computer?',
			detail: 'You will need to sign in again the next time you open it.',
		});
		if (r.response !== 0) return false;
	}
	const ses = session.fromPartition(PARTITION);
	await ses.clearStorageData({ storages: ['cookies', 'localstorage', 'indexdb', 'serviceworkers', 'cachestorage'] });
	try { await ses.clearCache(); } catch (e) { /* not important */ }
	seen = new Set();
	firstPoll = true;
	lastChat = 0;
	setBadge(0);
	if (site) {
		if (!entered) {
			// The "no internet" page was showing: start from the beginning.
			win.loadFile(path.join(__dirname, 'splash', 'splash.html'), { query: { quick: '1' } });
			setChrome(false);
			loadSite();
		} else {
			site.webContents.loadURL(SITE_URL);
		}
	}
	return true;
}

/* ---------- tray icon, badge and pop-ups ---------- */

function dotImage() {
	const size = 16;
	const buf = Buffer.alloc(size * size * 4);
	const c = (size - 1) / 2;
	const r = 6.5;
	for (let y = 0; y < size; y++) {
		for (let x = 0; x < size; x++) {
			const d = Math.hypot(x - c, y - c);
			const a = d <= r - 0.5 ? 255 : d <= r + 0.5 ? Math.round(255 * (r + 0.5 - d)) : 0;
			const i = (y * size + x) * 4;
			buf[i] = 0x20; buf[i + 1] = 0x2d; buf[i + 2] = 0xd9; buf[i + 3] = a; // BGRA: red
		}
	}
	return nativeImage.createFromBitmap(buf, { width: size, height: size });
}

let dot = null;
function setBadge(total) {
	try {
		if (win && !win.isDestroyed() && process.platform === 'win32') {
			if (!dot) dot = dotImage();
			win.setOverlayIcon(total > 0 ? dot : null, total > 0 ? total + ' waiting' : '');
		}
		if (tray) tray.setToolTip(TITLE + (total > 0 ? ' - ' + total + ' waiting' : ''));
	} catch (e) { /* not important */ }
}

function autoStartOn() {
	try { return app.getLoginItemSettings({ args: ['--hidden'] }).openAtLogin; } catch (e) { return false; }
}

function setAutoStart(on) {
	try { app.setLoginItemSettings({ openAtLogin: !!on, args: ['--hidden'] }); } catch (e) { /* not important */ }
	if (tray) tray.setContextMenu(trayMenu());
}

function trayMenu() {
	return Menu.buildFromTemplate([
		{ label: 'Open Rockmines WorkTrail', click: reopenWindow },
		{ type: 'separator' },
		{ label: 'Check for updates', click: () => updates && updates.check(true) },
		{ label: 'Start with Windows', type: 'checkbox', checked: autoStartOn(), click: (item) => setAutoStart(item.checked) },
		{ label: 'Welcome sound', type: 'checkbox', checked: welcomeSoundOn(), click: (item) => setWelcomeSound(item.checked) },
		{ label: 'Log out…', click: () => { showMainWindow(); logOut(true); } },
		{ type: 'separator' },
		{ label: 'Quit', click: () => { quitting = true; app.quit(); } },
	]);
}

function createTray() {
	try {
		const img = nativeImage.createFromPath(iconPath()).resize({ width: 16, height: 16 });
		tray = new Tray(img);
		tray.setToolTip(TITLE);
		tray.setContextMenu(trayMenu());
		tray.on('click', reopenWindow);
		tray.on('double-click', reopenWindow);
		return true;
	} catch (e) {
		tray = null; // e.g. a test machine without a system tray
		return false;
	}
}

function schedulePoll(ms) {
	clearTimeout(pollTimer);
	pollTimer = setTimeout(async () => {
		try { await pollNotifications(); } catch (e) { /* try again next time */ }
		schedulePoll(POLL_MS);
	}, ms);
}

// Asks WorkTrail (inside the signed-in website window) whether anything new is waiting.
const POLL_SCRIPT = `(async function () {
	var c = window.WorkTrailConfig;
	if (!c || !c.restUrl) return { state: 'nocfg' };
	async function get(p) {
		var r = await fetch(c.restUrl + p, { credentials: 'same-origin', cache: 'no-store', headers: { 'X-WP-Nonce': c.nonce, 'Accept': 'application/json' } });
		if (!r.ok) return { __status: r.status };
		return r.json();
	}
	var n = await get('notifications');
	if (n.__status) return { state: 'http', code: n.__status };
	var m = await get('chat/unread');
	return {
		state: 'ok',
		unread: n.unread || 0,
		items: (n.items || []).filter(function (x) { return !x.is_read; }).slice(0, 15).map(function (x) {
			return { id: x.id, task_id: x.task_id, message: String(x.message || '') };
		}),
		chat: m && typeof m.unread === 'number' ? m.unread : 0
	};
})()`;

async function pollNotifications() {
	const out = { state: 'skipped', unread: 0, chat: 0, shown: 0 };
	if (!site || !entered || siteState !== 'ready') return out;
	const wc = site.webContents;
	if (wc.isDestroyed() || wc.isLoading()) return out;

	let r;
	try { r = await wc.executeJavaScript(POLL_SCRIPT); } catch (e) { return out; }
	if (!r) return out;
	out.state = r.state;

	if (r.state === 'http') {
		// Signed out, or the page's pass has expired: reload once in a while to get a fresh one.
		if (Date.now() - lastReload > 10 * 60 * 1000) {
			lastReload = Date.now();
			wc.reload();
		}
		return out;
	}
	if (r.state !== 'ok') return out;

	out.unread = r.unread;
	out.chat = r.chat;
	setBadge(r.unread + r.chat);

	const fresh = r.items.filter((x) => !seen.has(x.id));
	r.items.forEach((x) => seen.add(x.id));
	const chatUp = r.chat > lastChat;
	const wasFirst = firstPoll;
	firstPoll = false;
	lastChat = r.chat;

	if (windowInUse()) return out; // the person is looking at WorkTrail already

	if (wasFirst) {
		const total = r.unread + r.chat;
		if (total > 0) {
			out.shown++;
			toast(TITLE, 'You have ' + total + ' thing' + (total === 1 ? '' : 's') + ' waiting for you.', () => openRoute(r.chat > 0 && r.unread === 0 ? '#/messages' : '#/dashboard'));
		}
		return out;
	}
	if (fresh.length === 1) {
		out.shown++;
		const x = fresh[0];
		toast('New in WorkTrail', x.message, () => openRoute(x.task_id ? '#/tasks/' + parseInt(x.task_id, 10) : '#/dashboard'));
	} else if (fresh.length > 1) {
		out.shown++;
		toast('New in WorkTrail', fresh.length + ' new notifications.', () => openRoute('#/dashboard'));
	}
	if (chatUp) {
		out.shown++;
		toast('New message', 'You have ' + r.chat + ' unread message' + (r.chat === 1 ? '' : 's') + '.', () => openRoute('#/messages'));
	}
	return out;
}

/* ---------- menu ---------- */

function showAbout() {
	dialog.showMessageBox(win && win.isVisible() ? win : undefined, {
		type: 'info',
		title: TITLE,
		buttons: ['OK'],
		message: TITLE,
		detail: 'Version ' + app.getVersion() + '\nDeveloped by JustNew for Rockmines Geo-Environmental Services Limited.',
	});
}

function buildMenu() {
	return Menu.buildFromTemplate([
		{
			label: 'File',
			submenu: [
				{ id: 'home', label: 'WorkTrail home', accelerator: 'CmdOrCtrl+H', click: () => { if (site && entered) site.webContents.loadURL(SITE_URL); } },
				{ id: 'logout', label: 'Log out…', click: () => logOut(true) },
				{ type: 'separator' },
				{ id: 'autostart', label: 'Start with Windows', type: 'checkbox', checked: autoStartOn(), click: (item) => setAutoStart(item.checked) },
				{ id: 'welcomesound', label: 'Welcome sound', type: 'checkbox', checked: welcomeSoundOn(), click: (item) => setWelcomeSound(item.checked) },
				{ type: 'separator' },
				{ id: 'quit', label: 'Quit', accelerator: 'CmdOrCtrl+Q', click: () => { quitting = true; app.quit(); } },
			],
		},
		{
			label: 'View',
			submenu: [
				{ id: 'reload', label: 'Reload', accelerator: 'F5', registerAccelerator: false, click: () => { if (site && entered) site.webContents.reload(); } },
				{ id: 'fullscreen', label: 'Full screen', accelerator: 'F11', registerAccelerator: false, click: () => { if (win) win.setFullScreen(!win.isFullScreen()); } },
			],
		},
		{
			label: 'Help',
			submenu: [
				{ id: 'updates', label: 'Check for updates…', click: () => updates && updates.check(true) },
				{ id: 'about', label: 'About Rockmines WorkTrail', click: showAbout },
			],
		},
	]);
}

/* ---------- main window ---------- */

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
		autoHideMenuBar: false,
		webPreferences: {
			preload: path.join(__dirname, 'preload.js'),
			contextIsolation: true,
			sandbox: true,
			nodeIntegration: false,
			autoplayPolicy: 'no-user-gesture-required', // lets the welcome animation play its soft sound
		},
	});
	win.setMenuBarVisibility(false);
	if (st.maximized) win.maximize();

	win.on('page-title-updated', (e) => e.preventDefault());
	win.once('ready-to-show', () => { if (!START_HIDDEN) win.show(); });
	win.on('resize', layoutSite);
	win.on('maximize', layoutSite);
	win.on('unmaximize', layoutSite);
	win.on('enter-full-screen', layoutSite);
	win.on('leave-full-screen', layoutSite);
	win.on('show', layoutSite);
	win.on('session-end', () => { quitting = true; }); // Windows is shutting down
	win.on('close', (e) => {
		saveState();
		if (!quitting) {
			// The X button tucks the program away near the clock instead of stopping it.
			e.preventDefault();
			hiddenAt = Date.now();
			win.hide();
			if (tray && !trayHintShown) {
				trayHintShown = true;
				toast(TITLE + ' is still running', 'Click its icon near the clock to open it again. Use the icon\'s menu to quit.', showMainWindow);
			} else if (!tray) {
				quitting = true;
				app.quit();
			}
		}
	});
	win.on('closed', () => { win = null; });

	if (START_HIDDEN) hiddenAt = Date.now(); // opened later from the icon after a long time: the animation plays then
	win.loadFile(path.join(__dirname, 'splash', 'splash.html'), START_HIDDEN ? { query: { quick: '1' } } : splashOptions());
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
	setChrome(false);
	loadSite();
	if (win && !win.isDestroyed()) {
		win.loadFile(path.join(__dirname, 'splash', 'splash.html'), { query: { quick: '1' } });
	}
});

/* ---------- start-up ---------- */

app.on('second-instance', () => {
	reopenWindow();
});

app.on('before-quit', () => { quitting = true; });

app.whenReady().then(() => {
	const ses = session.fromPartition(PARTITION);
	// The website never needs the camera, microphone, location and so on.
	ses.setPermissionRequestHandler((_wc, permission, callback) => {
		callback(['notifications', 'clipboard-sanitized-write', 'fullscreen'].includes(permission));
	});
	Menu.setApplicationMenu(buildMenu());
	createWindow();
	createTray();

	updates = require('./updates')({
		app,
		dialog,
		getWin: () => win,
		beforeQuit: () => { quitting = true; },
		toast: (t, b) => toast(t, b, showMainWindow),
	});
	if (!process.env.WORKTRAIL_SMOKE) updates.start();

	if (process.env.WORKTRAIL_SMOKE) {
		// Automated self-check used by the GitHub build (never set on staff PCs).
		require('./smoke')({
			app,
			getWin: () => win,
			getSite: () => site,
			getState: () => siteState,
			showOffline,
			reopenWindow,
			setHiddenAt: (t) => { hiddenAt = t; },
			siteUrl: SITE_URL,
			pollNotifications,
			logOut,
			updates,
			hasTray: () => !!tray,
			getMenu: () => Menu.getApplicationMenu(),
		});
	}
	app.on('activate', () => {
		if (BrowserWindow.getAllWindows().length === 0) createWindow();
		else showMainWindow();
	});
});

app.on('window-all-closed', () => {
	if (quitting) app.quit();
});
