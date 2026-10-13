/* Welcome animation: plays the slides, shows progress, then opens WorkTrail.
   Click, Space, Enter or Esc skips ahead. The website loads in the background
   while this plays, so WorkTrail is usually ready the moment the animation ends. */
(function () {
	'use strict';

	var stage = document.getElementById('stage');
	var slides = Array.prototype.slice.call(document.querySelectorAll('.slide'));
	var fill = document.getElementById('fill');
	var hint = document.getElementById('hint');
	var status = document.getElementById('status');
	var leave = document.getElementById('leave');

	var quick = /[?&]quick=1/.test(location.search);
	var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
	var DURATIONS = reduce ? [1800, 1200, 1200, 1200, 1200, 1500] : [4800, 3300, 3300, 3300, 3300, 2600];

	var index = -1;
	var timer = null;
	var finished = false;
	var siteState = 'loading';
	var api = window.wt;

	function show(i) {
		index = i;
		slides.forEach(function (s, n) { s.classList.toggle('active', n === i); });
		stage.classList.toggle('light', slides[i].getAttribute('data-light') === '1');
	}

	function next() {
		if (finished) return;
		if (index + 1 >= slides.length) { done(); return; }
		show(index + 1);
		if (index === slides.length - 1) { done(); return; } // the last slide stays until WorkTrail is ready
		timer = setTimeout(next, DURATIONS[index]);
	}

	function updateStatus() {
		if (!status) return;
		status.textContent = siteState === 'ready' ? 'Opening WorkTrail…'
			: siteState === 'failed' ? 'Could not connect. One moment…'
			: 'Connecting to Rockmines WorkTrail…';
	}

	function done() {
		// Called when the last slide is showing (or the person skipped).
		if (index !== slides.length - 1) show(slides.length - 1);
		var wait = DURATIONS[DURATIONS.length - 1];
		fill.classList.add('wait');
		hint.classList.remove('show');
		clearTimeout(timer);
		timer = setTimeout(openSite, skipped ? 500 : wait);
	}

	var skipped = false;
	function skip() {
		if (finished || skipped) return;
		skipped = true;
		clearTimeout(timer);
		done();
	}

	function openSite() {
		if (finished) return;
		if (siteState === 'loading') { timer = setTimeout(openSite, 250); return; } // still connecting
		finished = true;
		leave.classList.add('on');
		setTimeout(function () { if (api) api.enter(); }, 560);
	}

	function begin() {
		if (api) {
			api.onSiteState(function (s) { siteState = s; updateStatus(); });
			api.siteState().then(function (s) { siteState = s; updateStatus(); });
		}
		if (quick) {
			skipped = true;
			show(slides.length - 1);
			fill.classList.add('wait');
			hint.classList.remove('show');
			timer = setTimeout(openSite, 400);
			return;
		}
		// Progress bar: one long fill across every slide except the last.
		var total = DURATIONS.slice(0, -1).reduce(function (a, b) { return a + b; }, 0);
		fill.style.transitionDuration = total + 'ms';
		requestAnimationFrame(function () { requestAnimationFrame(function () { fill.classList.add('run'); }); });
		setTimeout(function () { hint.classList.add('show'); }, 1500);
		next();
	}

	document.addEventListener('click', skip);
	document.addEventListener('keydown', function (e) {
		if (e.key === ' ' || e.key === 'Enter' || e.key === 'Escape') { e.preventDefault(); skip(); }
	});

	begin();
})();
