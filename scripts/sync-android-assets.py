#!/usr/bin/env python3
"""Copies the welcome animation, the "no internet" page and the clean-view style sheet
from the Windows program's folders into the Android app, so both programs always match.
Run from the repository root: python3 scripts/sync-android-assets.py"""
import os, re, shutil, sys

root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
out = os.path.join(root, 'android', 'app', 'src', 'main', 'assets')
shutil.rmtree(out, ignore_errors=True)
os.makedirs(os.path.join(out, 'splash'))
os.makedirs(os.path.join(out, 'offline'))

BRIDGE = """/* Lets the welcome screen talk to the Android app. */
(function () {
	'use strict';
	var n = window.wtNative;
	var listeners = [];
	window.__wtSiteState = function (s) { listeners.forEach(function (f) { f(s); }); };
	window.wt = {
		siteState: function () { return Promise.resolve(n ? n.siteState() : 'loading'); },
		onSiteState: function (cb) { listeners.push(cb); },
		enter: function () { if (n) n.enter(); },
		retry: function () { if (n) n.retry(); },
		version: function () { return Promise.resolve(n ? n.version() : ''); }
	};
})();
"""

for name in os.listdir(os.path.join(root, 'src', 'splash')):
    src = os.path.join(root, 'src', 'splash', name)
    dst = os.path.join(out, 'splash', name)
    if name == 'splash.html':
        html = open(src, encoding='utf-8').read()
        assert '<script src="splash.js"></script>' in html
        html = html.replace('<script src="splash.js"></script>', '<script src="android-bridge.js"></script>\n<script src="splash.js"></script>')
        open(dst, 'w', encoding='utf-8').write(html)
    else:
        shutil.copy(src, dst)
open(os.path.join(out, 'splash', 'android-bridge.js'), 'w', encoding='utf-8').write(BRIDGE)

# The "no internet" page needs the bridge too, and says "phone" instead of "computer".
off = open(os.path.join(root, 'src', 'offline', 'offline.html'), encoding='utf-8').read()
assert '<script>' in off
off = off.replace('<script>', '<script src="../splash/android-bridge.js"></script>\n<script>', 1)
off = off.replace('this computer', 'this phone')
open(os.path.join(out, 'offline', 'offline.html'), 'w', encoding='utf-8').write(off)

# The clean-view style sheet is written once, in src/site-preload.js; reuse it.
pre = open(os.path.join(root, 'src', 'site-preload.js'), encoding='utf-8').read()
m = re.search(r'const CSS = `(.*?)`;', pre, re.S)
assert m, 'CSS block not found in site-preload.js'
css = m.group(1)
js = """(function () {
	'use strict';
	var CSS = `%s`;
	function add() {
		if (document.getElementById('wt-desktop-css')) return true;
		var parent = document.head || document.documentElement;
		if (!parent) return false;
		var style = document.createElement('style');
		style.id = 'wt-desktop-css';
		style.textContent = CSS;
		parent.appendChild(style);
		return true;
	}
	if (!add()) {
		document.addEventListener('readystatechange', add);
		document.addEventListener('DOMContentLoaded', add);
	}
})();
""" % css
open(os.path.join(out, 'clean-view.js'), 'w', encoding='utf-8').write(js)
print('Android assets synced:', sorted(os.listdir(out)))
