/* Lets the welcome screen talk to the Android app. */
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
