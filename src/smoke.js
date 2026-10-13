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
			await waitFor(() => win.webContents.getURL().endsWith('splash.html') && !win.webContents.isLoading(), 10000);
			check('welcome screen loads', win.webContents.getURL().endsWith('splash.html'), win.webContents.getURL());
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
			}

			ctx.showOffline();
			await waitFor(() => win.webContents.getURL().endsWith('offline.html') || win.webContents.getURL().includes('offline.html'), 8000);
			await sleep(600);
			check('"no internet" page loads', win.webContents.getURL().includes('offline.html'));
			await shot(win.webContents, '4-offline.png');
		} catch (e) {
			failed++;
			console.log('FAIL smoke crashed: ' + (e && e.stack ? e.stack : e));
		}
		console.log(failed ? 'SMOKE FAILED (' + failed + ')' : 'SMOKE PASSED');
		ctx.app.exit(failed ? 1 : 0);
	})();
};
