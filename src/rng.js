// seeded deterministic PRNG - every run of the sim must be reproducible from a seed
(function (root) {
	'use strict';

	function mulberry32(seed) {
		let a = seed >>> 0;
		return function () {
			a = (a + 0x6D2B79F5) | 0;
			let t = Math.imul(a ^ (a >>> 15), 1 | a);
			t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
			return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
		};
	}

	function createRng(seed) {
		const next = mulberry32(seed);
		return {
			next,
			range: (a, b) => a + (b - a) * next(),
			int: (a, b) => a + Math.floor(next() * (b - a + 1)),
			gauss() {
				let u = 0;
				let v = 0;
				while (u === 0) u = next();
				while (v === 0) v = next();
				return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
			},
			pick: arr => arr[Math.floor(next() * arr.length)]
		};
	}

	const HSG = root.HSG || (root.HSG = {});
	HSG.createRng = createRng;
	HSG.mulberry32 = mulberry32;

	if (typeof module !== 'undefined' && module.exports) {
		module.exports = { createRng, mulberry32 };
	}
})(typeof globalThis !== 'undefined' ? globalThis : this);
