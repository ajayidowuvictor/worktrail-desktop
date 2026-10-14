'use strict';
/* Self-check run by the GitHub build on a test machine: opens the program against a
   tiny local test page, clicks past the animation, and confirms that WorkTrail's
   window, the welcome screens and the "no internet" page all work. Saves pictures. */
const fs = require('fs');
const path = require('path');

module.exports = function smoke(ctx) {
	const out = process.env.SMOKE_OUT || path.join(process.cwd(), 'smoke-out');
	fs.mkdirSync(out, { recursive: true });
	let failed = 0;
	const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
	const check = (name, ok, extra) => {
		if (!ok) failed++;
		console.log((ok ? 'PASS ' : 'FAIL ') + name + (extra ? '  ' + extra : ''));
	};
	const shot = async (wc, file) => {
		try {
			const img = await wc.capturePage();
			fs.writeFileSync(path.join(out, file), img.toPNG());
		} catch (e) { console.log('screenshot failed', file, e.message); }
	};
	const waitFor = async (fn, ms) => {
		const end = Date.now() + ms;
		while (Date.now() < end) { if (await fn()) return true; await sleep(200); }
		return false;
	};

	(async () => {
		try {
			const win = ctx.getWin();
			await waitFor(() => win.webContents.getURL().includes('splash.html') && !win.webContents.isLoading(), 10000);
			check('welcome screen loads', win.webContents.getURL().includes('splash.html'), win.webContents.getURL());
			check('bridge available to welcome screen', (await win.webContents.executeJavaScript('typeof window.wt && typeof window.wt.enter')) === 'function');
			await sleep(2500);
			await shot(win.webContents, '1-welcome-logo.png');
			await sleep(2500);
			await shot(win.webContents, '2-welcome-slide.png');

			check('website loaded in background', await waitFor(() => ctx.getState() === 'ready', 15000), 'state=' + ctx.getState());

			await win.webContents.executeJavaScript('document.body.click()'); // skip the animation like a person would
			const entered = await waitFor(() => win.contentView.children.length === 1, 8000);
			check('program opens the website after the animation', entered);
			if (entered) {
				const site = ctx.getSite();
				await sleep(500);
				check('website address is right', site.webContents.getURL().startsWith(ctx.siteUrl), site.webContents.getURL());
				const title = await site.webContents.executeJavaScript('document.title');
				check('website content is shown', title === 'Smoke OK', 'title=' + title);
				check('website has no access to the program', (await site.webContents.executeJavaScript('typeof window.wt + typeof require')) === 'undefinedundefined');
				await shot(site.webContents, '3-website.png');
				const b = win.getContentBounds();
				const sb = site.getBounds();
				check('website fills the window', sb.width === b.width && sb.height === b.height, JSON.stringify(sb));

				// --- clean app view: the website's own menu, banner, footer and WordPress bar are hidden ---
				await sleep(700); // lets the page's late pop-up appear, like a cookie banner would
				const seenState = JSON.parse(await site.webContents.executeJavaScript(`(function () {
					function d(id) { var e = document.getElementById(id); return e ? getComputedStyle(e).display : 'missing'; }
					var boxed = getComputedStyle(document.getElementById('boxed'));
					var root = getComputedStyle(document.getElementById('worktrail-root'));
					return JSON.stringify({
						bar: d('wpadminbar'), banner: d('top-banner'), header: d('site-header'), title: d('page-title'),
						footer: d('site-footer'), cookie: d('cookie-popup'), late: d('late-widget'), root: d('worktrail-root'),
						boxedMax: boxed.maxWidth, boxedPad: boxed.paddingTop, htmlMargin: getComputedStyle(document.documentElement).marginTop,
						rootRadius: root.borderTopLeftRadius, rootW: document.getElementById('worktrail-root').getBoundingClientRect().width,
						winW: window.innerWidth
					});
				})()`));
				check('website menu, banner and footer are hidden', seenState.header === 'none' && seenState.banner === 'none' && seenState.footer === 'none' && seenState.title === 'none', JSON.stringify(seenState));
				check('WordPress bar and pop-ups are hidden (even ones added later)', seenState.bar === 'none' && seenState.cookie === 'none' && seenState.late === 'none');
				check('WorkTrail itself stays visible and fills the window', seenState.root !== 'none' && seenState.boxedMax === 'none' && seenState.boxedPad === '0px' && seenState.rootRadius === '0px' && Math.abs(seenState.rootW - seenState.winW) < 20);
				await shot(site.webContents, '3b-clean-view.png');

				// --- menu ---
				const menu = ctx.getMenu();
				check('menu has Log out and Check for updates', !!(menu && menu.getMenuItemById('logout') && menu.getMenuItemById('updates')));
				check('menu bar is shown once WorkTrail is open', win.isMenuBarVisible());
				check('tray icon (information only)', true, ctx.hasTray() ? 'created' : 'not available on this test machine');

				// --- updates: in a test copy it must quietly say so ---
				check('update check is safe in a test copy', (await ctx.updates.check(false)) === 'unpackaged');

				// --- pop-ups for new tasks and messages ---
				const dataDir = path.join(process.cwd(), 'smoke-site', 'wp-json', 'worktrail', 'v1');
				const notesFile = path.join(dataDir, 'notifications');
				const chatFile = path.join(dataDir, 'chat', 'unread');
				const origNotes = fs.readFileSync(notesFile, 'utf8');
				const origChat = fs.readFileSync(chatFile, 'utf8');
				try {
					const p1 = await ctx.pollNotifications();
					check('notification watch sees waiting items', p1.state === 'ok' && p1.unread === 2 && p1.chat === 3, JSON.stringify(p1));
					check('first look gives one summary pop-up', p1.shown === 1);
					const notes = JSON.parse(origNotes);
					notes.unread = 3;
					notes.items.unshift({ id: 13, type: 'assigned', task_id: 9, message: 'Baseline study was given to you.', is_read: false, created_at: '2026-10-13T09:00:00Z' });
					fs.writeFileSync(notesFile, JSON.stringify(notes));
					fs.writeFileSync(chatFile, '{"unread":4}');
					const p2 = await ctx.pollNotifications();
					check('a new task and a new message give two pop-ups', p2.state === 'ok' && p2.unread === 3 && p2.chat === 4 && p2.shown === 2, JSON.stringify(p2));
					const p3 = await ctx.pollNotifications();
					check('nothing new gives no pop-up', p3.shown === 0, JSON.stringify(p3));
				} finally {
					fs.writeFileSync(notesFile, origNotes);
					fs.writeFileSync(chatFile, origChat);
				}

				// --- log out clears the sign-in on this computer ---
				await site.webContents.executeJavaScript("document.cookie = 'wordpress_logged_in_test=1; path=/'");
				const before = await site.webContents.executeJavaScript('document.cookie');
				check('test sign-in cookie is present before log out', before.includes('wordpress_logged_in_test'));
				await ctx.logOut(false);
				await sleep(400);
				await waitFor(() => !site.webContents.isLoading(), 8000);
				const after = await site.webContents.executeJavaScript('document.cookie');
				check('log out removes the sign-in and reloads the website', !after.includes('wordpress_logged_in_test') && site.webContents.getURL().startsWith(ctx.siteUrl), 'cookie=[' + after + ']');
			}

			ctx.showOffline();
			await waitFor(() => win.webContents.getURL().endsWith('offline.html') || win.webContents.getURL().includes('offline.html'), 8000);
			await sleep(600);
			check('"no internet" page loads', win.webContents.getURL().includes('offline.html'));
			await shot(win.webContents, '4-offline.png');

			// --- coming back to the program: a short break goes straight in, a long one replays the welcome ---
			ctx.setHiddenAt(Date.now() - 5 * 60 * 1000);
			ctx.reopenWindow();
			await sleep(800);
			check('a short break does not replay the welcome', win.webContents.getURL().includes('offline.html'), win.webContents.getURL());
			ctx.setHiddenAt(Date.now() - 31 * 60 * 1000);
			ctx.reopenWindow();
			const replayed = await waitFor(() => win.webContents.getURL().includes('splash.html') && !win.webContents.isLoading(), 8000);
			check('a long break replays the welcome', replayed, win.webContents.getURL());
			check('welcome sound is available to the welcome screen', replayed && (await win.webContents.executeJavaScript('typeof window.WTSplashSound && typeof window.WTSplashSound.play')) === 'function');
			await shot(win.webContents, '5-welcome-again.png');
		} catch (e) {
			failed++;
			console.log('FAIL smoke crashed: ' + (e && e.stack ? e.stack : e));
		}
		console.log(failed ? 'SMOKE FAILED (' + failed + ')' : 'SMOKE PASSED');
		ctx.app.exit(failed ? 1 : 0);
	})();
};
