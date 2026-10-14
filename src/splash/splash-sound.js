/* Sound design for the welcome animation, like a short advert: a soft whoosh and a low
   "thud" as each slide arrives, a pop for every row, message, word and document that
   slides in, a tick-tock as the clock fills, rising dings as the timeline completes,
   and a warm chord to finish. Everything is made on the spot (no sound files).
   The times below follow the animation timings in splash.css, in seconds after the
   slide appears. Any problem (no speakers, no audio device) is ignored: the animation
   works the same without sound. */
(function () {
	'use strict';

	var ctx = null;
	var master = null;
	var bus = null; // everything for the slide now showing, so the next slide can fade it out
	var noise = null;

	function hz(m) { return 440 * Math.pow(2, (m - 69) / 12); } // MIDI note number to pitch

	function resume() {
		try {
			var r = ctx.state === 'suspended' && ctx.resume ? ctx.resume() : null;
			if (r && r.catch) r.catch(function () { /* no audio device: stay quiet */ });
		} catch (e) { /* ignore */ }
	}

	function init(audioCtx) {
		if (ctx) return true;
		try {
			ctx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
			var comp = ctx.createDynamicsCompressor(); // keeps a busy moment from ever getting loud
			comp.threshold.value = -22;
			comp.ratio.value = 5;
			master = ctx.createGain();
			master.gain.value = 0.6;
			master.connect(comp);
			comp.connect(ctx.destination);
			var len = Math.floor(ctx.sampleRate * 2);
			noise = ctx.createBuffer(1, len, ctx.sampleRate);
			var d = noise.getChannelData(0);
			for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
			resume();
			return true;
		} catch (e) {
			ctx = null;
			return false;
		}
	}

	/* ---------- the building blocks ---------- */

	function env(g, t, peak, attack, dur) {
		g.gain.setValueAtTime(0.0001, t);
		g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + attack);
		g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
	}

	function osc(type, f0, f1, t, dur, out) {
		var o = ctx.createOscillator();
		o.type = type;
		o.frequency.setValueAtTime(f0, t);
		if (f1 && f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
		o.connect(out);
		o.start(t);
		o.stop(t + dur + 0.05);
		return o;
	}

	// Air sweeping from one pitch to another: slides, transitions, risers.
	function whoosh(t, dur, f0, f1, gain, q) {
		var src = ctx.createBufferSource();
		src.buffer = noise;
		src.loop = true;
		var f = ctx.createBiquadFilter();
		f.type = 'bandpass';
		f.Q.value = q || 0.9;
		f.frequency.setValueAtTime(f0, t);
		f.frequency.exponentialRampToValueAtTime(f1, t + dur);
		var g = ctx.createGain();
		g.gain.setValueAtTime(0.0001, t);
		g.gain.exponentialRampToValueAtTime(gain, t + dur * 0.45);
		g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
		src.connect(f);
		f.connect(g);
		g.connect(bus);
		src.start(t);
		src.stop(t + dur + 0.05);
	}

	// A low soft "thud": something landing. The upper part lets small speakers hear it too.
	function thump(t, gain) {
		var g = ctx.createGain();
		env(g, t, gain, 0.008, 0.42);
		g.connect(bus);
		osc('sine', 130, 48, t, 0.4, g);
		var g2 = ctx.createGain();
		env(g2, t, gain * 0.45, 0.004, 0.14);
		g2.connect(bus);
		osc('triangle', 260, 120, t, 0.12, g2);
	}

	// A rounded "pop": a bubble of sound that rises, like a message arriving.
	function pop(t, freq, gain, dur) {
		dur = dur || 0.16;
		var g = ctx.createGain();
		env(g, t, gain, 0.006, dur);
		g.connect(bus);
		osc('sine', freq * 0.7, freq, t, dur * 0.55, g);
		var g2 = ctx.createGain();
		env(g2, t, gain * 0.25, 0.004, dur * 0.8);
		g2.connect(bus);
		osc('sine', freq * 2, freq * 2.2, t, dur * 0.6, g2);
	}

	// A tiny click: text and labels appearing, the clock ticking.
	function tick(t, gain, freq) {
		var src = ctx.createBufferSource();
		src.buffer = noise;
		var f = ctx.createBiquadFilter();
		f.type = 'highpass';
		f.frequency.value = freq || 3500;
		var g = ctx.createGain();
		env(g, t, gain, 0.002, 0.035);
		src.connect(f);
		f.connect(g);
		g.connect(bus);
		src.start(t, Math.random());
		src.stop(t + 0.06);
	}

	// A glassy "ding" with a faint octave and shimmer.
	function bell(t, freq, gain, dur) {
		var g = ctx.createGain();
		env(g, t, gain, 0.012, dur);
		g.connect(bus);
		[[1, 1], [2, 0.25], [2.76, 0.07]].forEach(function (p) {
			var pg = ctx.createGain();
			pg.gain.value = p[1];
			pg.connect(g);
			osc('sine', freq * p[0], 0, t, dur, pg);
		});
	}

	// A rising or falling "zip" line.
	function zip(t, dur, f0, f1, gain) {
		var g = ctx.createGain();
		env(g, t, gain, dur * 0.3, dur);
		g.connect(bus);
		osc('sine', f0, f1, t, dur, g);
	}

	// A warm chord underneath the slide, swelling in and out.
	function chord(t, notes, dur, gain) {
		var lp = ctx.createBiquadFilter();
		lp.type = 'lowpass';
		lp.frequency.value = 1100;
		var g = ctx.createGain();
		g.gain.setValueAtTime(0.0001, t);
		g.gain.exponentialRampToValueAtTime(gain, t + dur * 0.3);
		g.gain.setValueAtTime(gain, t + dur * 0.62);
		g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
		lp.connect(g);
		g.connect(bus);
		notes.forEach(function (n) {
			[0, 5].forEach(function (cents) {
				var o = osc('triangle', hz(n), 0, t, dur, lp);
				o.detune.value = cents;
			});
		});
	}

	function sparkle(t, notes, step, gain) {
		notes.forEach(function (n, i) { bell(t + i * step, hz(n), gain * (1 - i * 0.06), 1.4); });
	}

	/* ---------- how each slide sounds ---------- */

	// The headline, "kicker" and sub-line that slide in on slides 2 to 5.
	function caption(t) {
		whoosh(t, 0.55, 2600, 500, 0.075, 0.8); // the slide arriving
		thump(t, 0.3);
		tick(t + 0.35, 0.12); // kicker
		zip(t + 0.7, 0.45, 700, 1500, 0.035); // kicker line drawing out
		thump(t + 0.5, 0.2); // headline lands
		whoosh(t + 0.5, 0.45, 800, 2600, 0.06, 1.1);
		tick(t + 0.75, 0.1); // sub-line
		pop(t + 0.8, 880, 0.07, 0.1);
	}

	var SCENES = [
		// 0: the logo and the welcome line (C major)
		function (t) {
			chord(t + 0.1, [48, 55, 64, 67], 4.6, 0.05);
			whoosh(t + 0.1, 1.35, 300, 3600, 0.1, 0.8); // logo coming into focus
			zip(t + 0.15, 1.3, 220, 880, 0.04);
			thump(t + 1.45, 0.34); // logo lands
			bell(t + 1.45, hz(84), 0.1, 1.8);
			[[1.5, 72], [1.62, 76], [1.8, 79], [1.98, 84]].forEach(function (w) { // Welcome, to, Rockmines, WorkTrail
				pop(t + w[0], hz(w[1]), 0.2, 0.15);
				tick(t + w[0], 0.07);
			});
			zip(t + 2.3, 0.95, 500, 2600, 0.05); // the line drawing out
			whoosh(t + 2.3, 1.0, 600, 3000, 0.04, 1.2);
			bell(t + 3.3, hz(88), 0.1, 1.6);
			sparkle(t + 3.35, [79, 84, 88], 0.1, 0.07);
		},
		// 1: Who is holding what (A minor)
		function (t) {
			caption(t);
			chord(t, [45, 52, 60, 64], 3.7, 0.05);
			[[0.6, 69], [0.85, 72], [1.1, 76], [1.35, 79]].forEach(function (r, i) { // four rows slide in from the right
				whoosh(t + r[0], 0.36, 1700, 500, 0.06, 0.9);
				pop(t + r[0] + 0.34, hz(r[1]), 0.2, 0.15);
				if (i === 3) bell(t + r[0] + 0.4, hz(91), 0.07, 1.2);
			});
			pop(t + 2.05, hz(55), 0.15, 0.22); // "past deadline" pulses
			pop(t + 2.5, hz(55), 0.12, 0.22);
		},
		// 2: Every job has a clock (F)
		function (t) {
			caption(t);
			chord(t, [41, 48, 57, 65], 3.7, 0.05);
			for (var k = 0; k < 10; k++) tick(t + 0.8 + k * 0.245, 0.07 + k * 0.01, 3200 + k * 150); // the clock ring filling
			zip(t + 0.8, 2.4, 300, 1300, 0.03);
			whoosh(t + 0.9, 2.2, 500, 2400, 0.04, 1.2); // the line filling
			[[0.9, 72], [1.5, 76], [2.1, 79], [2.7, 84]].forEach(function (n, i) { // Given, Started, Handed in, Approved
				pop(t + n[0], hz(n[1] - 12), 0.18, 0.15);
				bell(t + n[0] + 0.02, hz(n[1] + 12), i === 3 ? 0.18 : 0.11, i === 3 ? 1.8 : 1.1);
			});
			sparkle(t + 2.8, [84, 88, 91], 0.08, 0.06);
		},
		// 3: Talk to your team (G)
		function (t) {
			caption(t);
			chord(t, [43, 50, 59, 67], 3.7, 0.05);
			[[0.6, 'them'], [1.15, 'me'], [1.7, 'me'], [2.25, 'them']].forEach(function (m) { // the four messages
				whoosh(m[0] + t, 0.22, 1400, 600, 0.03, 1);
				if (m[1] === 'them') { pop(t + m[0] + 0.1, hz(83), 0.17, 0.12); pop(t + m[0] + 0.2, hz(88), 0.15, 0.14); }
				else pop(t + m[0] + 0.12, hz(76), 0.19, 0.14);
			});
			for (var k = 0; k < 3; k++) pop(t + 2.8 + k * 0.17, hz(72 + k * 2), 0.06, 0.08); // typing dots
		},
		// 4: Your work, kept (D minor)
		function (t) {
			caption(t);
			chord(t, [38, 50, 57, 65], 3.7, 0.05);
			[0.6, 0.8, 1.0].forEach(function (d, i) { // three documents rise and land
				whoosh(t + d, 0.5, 500, 2200, 0.06, 1);
				thump(t + d + 0.5, 0.2);
				pop(t + d + 0.5, hz(64 + i * 3), 0.1, 0.12);
			});
			thump(t + 2.0, 0.3); // "Confirmed"
			bell(t + 2.0, hz(84), 0.17, 1.6);
			bell(t + 2.08, hz(88), 0.13, 1.6);
			bell(t + 2.16, hz(91), 0.11, 1.8);
		},
		// 5: Ready when you are (C major, resolving)
		function (t) {
			whoosh(t, 0.7, 400, 4200, 0.11, 0.8); // lift into the last slide
			chord(t + 0.1, [48, 55, 64, 74], 5, 0.07);
			thump(t + 0.3, 0.36);
			zip(t + 0.2, 0.9, 300, 1100, 0.04);
			thump(t + 0.5, 0.22); // headline
			tick(t + 0.5, 0.1);
			sparkle(t + 0.95, [84, 88, 91, 96], 0.09, 0.13);
			bell(t + 1.4, hz(72), 0.2, 3.2);
		}
	];

	function play(i, at) {
		if (!ctx && !init()) return;
		try {
			resume();
			var t = typeof at === 'number' ? at : ctx.currentTime + 0.03;
			// The previous slide's sound fades away quickly, so a skip never piles sounds on top of each other.
			if (bus) {
				bus.gain.cancelScheduledValues(t);
				bus.gain.setValueAtTime(bus.gain.value, t);
				bus.gain.linearRampToValueAtTime(0.0001, t + 0.45);
			}
			bus = ctx.createGain();
			bus.connect(master);
			var scene = SCENES[Math.max(0, Math.min(SCENES.length - 1, i))];
			scene(t);
		} catch (e) { /* sound is a bonus, never a problem */ }
	}

	window.WTSplashSound = { init: init, play: play };
})();
