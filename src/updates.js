'use strict';
/* Automatic updates. Looks for a newer Rockmines WorkTrail on the project's GitHub
   Releases page, downloads it quietly, and asks the person before restarting. */
const { autoUpdater } = require('electron-updater');

module.exports = function setupUpdates({ app, dialog, getWin, beforeQuit, toast }) {
	let manual = false;
	let checking = false;
	let readyVersion = '';

	autoUpdater.autoDownload = true;
	autoUpdater.autoInstallOnAppQuit = true;
	autoUpdater.logger = null;

	function box(options) {
		const w = getWin();
		const parent = w && !w.isDestroyed() && w.isVisible() ? w : undefined;
		return dialog.showMessageBox(parent, Object.assign({ type: 'info', title: 'Rockmines WorkTrail', buttons: ['OK'] }, options));
	}

	function promptRestart() {
		if (!readyVersion) return;
		const w = getWin();
		if (!w || w.isDestroyed() || !w.isVisible()) {
			toast('Update ready', 'Open Rockmines WorkTrail from the icon near the clock to finish updating.');
			return;
		}
		box({
			buttons: ['Restart now', 'Later'],
			defaultId: 0,
			cancelId: 1,
			message: 'Version ' + readyVersion + ' is ready.',
			detail: 'WorkTrail will close and open again in a few seconds.',
		}).then((r) => {
			if (r.response === 0) {
				beforeQuit();
				autoUpdater.quitAndInstall(true, true);
			}
		});
	}

	autoUpdater.on('update-available', (info) => {
		if (manual) {
			box({ message: 'A new version (' + info.version + ') is available.', detail: 'It is downloading now. You will be asked to restart when it is ready.' });
		}
	});
	autoUpdater.on('update-not-available', () => {
		checking = false;
		if (manual) box({ message: 'You have the latest version.', detail: 'Version ' + app.getVersion() });
		manual = false;
	});
	autoUpdater.on('error', () => {
		checking = false;
		if (manual) {
			box({ type: 'warning', message: 'Could not check for updates.', detail: 'Please check your internet connection and try again.' });
		}
		manual = false;
	});
	autoUpdater.on('update-downloaded', (info) => {
		checking = false;
		manual = false;
		readyVersion = info.version;
		promptRestart();
	});

	async function check(isManual) {
		if (!app.isPackaged) {
			if (isManual) box({ message: 'Updates work in the installed program.', detail: 'This copy is a test copy.' });
			return 'unpackaged';
		}
		if (readyVersion) {
			if (isManual) promptRestart();
			return 'ready';
		}
		if (checking) {
			if (isManual) box({ message: 'Already checking for updates. One moment.' });
			return 'busy';
		}
		manual = !!isManual;
		checking = true;
		try {
			await autoUpdater.checkForUpdates();
			return 'checked';
		} catch (e) {
			checking = false; // the 'error' event shows the message when the person asked
			return 'failed';
		}
	}

	function start() {
		setTimeout(() => check(false), 20 * 1000);
		setInterval(() => check(false), 4 * 60 * 60 * 1000);
	}

	return { check, start, promptRestart, hasReady: () => !!readyVersion };
};
