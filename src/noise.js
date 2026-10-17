// 2D simplex noise (Gustavson style) with seeded permutation table
(function (root) {
	'use strict';

	// 12 gradient directions, 0.5 scaled
	const GRAD = new Float32Array([
		1, 1, -1, 1, 1, -1, -1, -1,
		1, 0, -1, 0, 1, 0, -1, 0,
		0, 1, 0, -1, 0, 1, 0, -1
	]);

	function createNoise(seed) {
		const HSG = root.HSG;
		const rng = HSG.createRng(seed >>> 0);
		const p = new Uint8Array(256);
		for (let i = 0; i < 256; i++) p[i] = i;
		for (let i = 255; i > 0; i--) {
			const j = rng.int(0, i);
			const t = p[i];
			p[i] = p[j];
			p[j] = t;
		}
		const perm = new Uint8Array(512);
		for (let i = 0; i < 512; i++) perm[i] = p[i & 255];

		const F2 = 0.5 * (Math.sqrt(3) - 1);
		const G2 = (3 - Math.sqrt(3)) / 6;

		function noise2D(xin, yin) {
			const s = (xin + yin) * F2;
			const i = Math.floor(xin + s);
			const j = Math.floor(yin + s);
			const t = (i + j) * G2;
			const x0 = xin - (i - t);
			const y0 = yin - (j - t);
			let i1;
			let j1;
			if (x0 > y0) { i1 = 1; j1 = 0; } else { i1 = 0; j1 = 1; }
			const x1 = x0 - i1 + G2;
			const y1 = y0 - j1 + G2;
			const x2 = x0 - 1 + 2 * G2;
			const y2 = y0 - 1 + 2 * G2;
			const ii = i & 255;
			const jj = j & 255;

			let n0 = 0;
			let n1 = 0;
			let n2 = 0;
			let t0 = 0.5 - x0 * x0 - y0 * y0;
			if (t0 > 0) {
				const gi = (perm[ii + perm[jj]] % 12) * 2;
				t0 *= t0;
				n0 = t0 * t0 * (GRAD[gi] * x0 + GRAD[gi + 1] * y0);
			}
			let t1 = 0.5 - x1 * x1 - y1 * y1;
			if (t1 > 0) {
				const gi = (perm[ii + 1 + perm[jj]] % 12) * 2;
				t1 *= t1;
				n1 = t1 * t1 * (GRAD[gi] * x1 + GRAD[gi + 1] * y1);
			}
			let t2 = 0.5 - x2 * x2 - y2 * y2;
			if (t2 > 0) {
				const gi = (perm[ii + 1 + perm[jj + 1]] % 12) * 2;
				t2 *= t2;
				n2 = t2 * t2 * (GRAD[gi] * x2 + GRAD[gi + 1] * y2);
			}
			return 70 * (n0 + n1 + n2);
		}

		function fbm(x, y, octaves, lacunarity, gain) {
			let amp = 1;
			let freq = 1;
			let sum = 0;
			let norm = 0;
			for (let o = 0; o < octaves; o++) {
				sum += amp * noise2D(x * freq, y * freq);
				norm += amp;
				amp *= gain;
				freq *= lacunarity;
			}
			return sum / norm;
		}

		return { noise2D, fbm };
	}

	const HSG = root.HSG || (root.HSG = {});
	if (typeof module !== 'undefined' && module.exports) {
		Object.assign(HSG, require('./rng.js'));
	}
	HSG.createNoise = createNoise;

	if (typeof module !== 'undefined' && module.exports) {
		module.exports = { createNoise };
	}
})(typeof globalThis !== 'undefined' ? globalThis : this);
