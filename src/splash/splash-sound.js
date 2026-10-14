/* Soft sounds for the welcome animation, made on the spot (no sound files).
   A gentle three-note rise as the logo appears, one soft bell as each slide arrives,
   and a warm chord on the last one. Everything is quiet on purpose, and any problem
   (no speakers, no audio device) is ignored: the animation works the same without it. */
(function () {
	'use strict';

	var ctx = null;
	var master = null;

	var N = { C5: 523.25, D5: 587.33, E5: 659.25, G5: 783.99, A5: 880.0, C6: 1046.5, D6: 1174.66, E6: 1318.51 };

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
			comp.threshold.value = -24;
			comp.ratio.value = 6;
			master = ctx.createGain();
			master.gain.value = 0.45;
			master.connect(comp);
			comp.connect(ctx.destination);
			resume();
			return true;
		} catch (e) {
			ctx = null;
			return false;
		}
	}

	// One soft bell: a pure tone with a faint octave and a faint shimmer, fading away.
	function bell(t, freq, gain, dur) {
		var g = ctx.createGain();
		g.connect(master);
		g.gain.setValueAtTime(0.0001, t);
		g.gain.exponentialRampToValueAtTime(gain, t + 0.015);
		g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
		[[1, 1], [2, 0.25], [2.76, 0.07]].forEach(function (p) {
			var o = ctx.createOscillator();
			var pg = ctx.createGain();
			o.type = 'sine';
			o.frequency.value = freq * p[0];
			pg.gain.value = p[1];
			o.connect(pg);
			pg.connect(g);
			o.start(t);
			o.stop(t + dur + 0.05);
		});
	}

	// A warm pad note that swells in and fades out slowly.
	function pad(t, freq, gain, dur) {
		var g = ctx.createGain();
		g.connect(master);
		g.gain.setValueAtTime(0.0001, t);
		g.gain.exponentialRampToValueAtTime(gain, t + dur * 0.35);
		g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
		[0, 4].forEach(function (cents) {
			var o = ctx.createOscillator();
			o.type = 'sine';
			o.frequency.value = freq;
			o.detune.value = cents;
			o.connect(g);
			o.start(t);
			o.stop(t + dur + 0.05);
		});
	}

	// A very soft "air" sweep between slides.
	function breath(t, dur, gain) {
		var len = Math.max(1, Math.floor(ctx.sampleRate * dur));
		var buf = ctx.createBuffer(1, len, ctx.sampleRate);
		var d = buf.getChannelData(0);
		for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
		var src = ctx.createBufferSource();
		src.buffer = buf;
		var f = ctx.createBiquadFilter();
		f.type = 'bandpass';
		f.Q.value = 0.8;
		f.frequency.setValueAtTime(500, t);
		f.frequency.exponentialRampToValueAtTime(2200, t + dur);
		var g = ctx.createGain();
		g.gain.setValueAtTime(0.0001, t);
		g.gain.exponentialRampToValueAtTime(gain, t + dur * 0.4);
		g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
		src.connect(f);
		f.connect(g);
		g.connect(master);
		src.start(t);
		src.stop(t + dur + 0.05);
	}

	// Slide 0 is the logo; 1 to 4 are the feature slides; 5 is "Ready when you are".
	function play(i, at) {
		if (!ctx && !init()) return;
		try {
			resume();
			var t = typeof at === 'number' ? at : ctx.currentTime + 0.02;
			if (i === 0) {
				bell(t + 0.25, N.C5, 0.30, 1.6);
				bell(t + 0.50, N.E5, 0.28, 1.6);
				bell(t + 0.75, N.G5, 0.28, 2.2);
				bell(t + 1.10, N.C6, 0.16, 2.6);
			} else if (i >= 1 && i <= 4) {
				var note = [N.E5, N.G5, N.A5, N.C6][i - 1];
				breath(t, 0.5, 0.05);
				bell(t + 0.12, note, 0.24, 1.8);
			} else {
				pad(t, N.C5, 0.12, 3.2);
				pad(t, N.E5, 0.10, 3.2);
				pad(t, N.G5, 0.10, 3.2);
				pad(t + 0.15, N.D6, 0.05, 3.0);
				bell(t + 0.35, N.C6, 0.18, 2.8);
			}
		} catch (e) { /* sound is a bonus, never a problem */ }
	}

	window.WTSplashSound = { init: init, play: play };
})();
