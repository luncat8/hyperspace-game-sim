// field.js — seeded value noise and divergence-free turbulence force field
'use strict';

const FIELD_EPS = 0.35; // derivative step in noise space; also smooths the field

function mulberry32(seed) {
	let a = seed >>> 0;
	return function () {
		a |= 0; a = a + 0x6D2B79F5 | 0;
		let t = Math.imul(a ^ a >>> 15, 1 | a);
		t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
		return ((t ^ t >>> 14) >>> 0) / 4294967296;
	};
}

const fieldPerm = new Uint8Array(512);

function fieldInit(seed) {
	const rnd = mulberry32(seed);
	const p = new Uint8Array(256);
	for (let i = 0; i < 256; i++) p[i] = i;
	for (let i = 255; i > 0; i--) {
		const j = (rnd() * (i + 1)) | 0;
		const tmp = p[i]; p[i] = p[j]; p[j] = tmp;
	}
	for (let i = 0; i < 512; i++) fieldPerm[i] = p[i & 255];
}

function latticeVal(xi, yi, zi) {
	return fieldPerm[(fieldPerm[(fieldPerm[xi & 255] + yi) & 255] + zi) & 255] / 127.5 - 1;
}

function fade(t) { return t * t * (3 - 2 * t); }

function noise3(x, y, z) {
	const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
	const fx = fade(x - xi), fy = fade(y - yi), fz = fade(z - zi);
	const v000 = latticeVal(xi, yi, zi), v100 = latticeVal(xi + 1, yi, zi);
	const v010 = latticeVal(xi, yi + 1, zi), v110 = latticeVal(xi + 1, yi + 1, zi);
	const v001 = latticeVal(xi, yi, zi + 1), v101 = latticeVal(xi + 1, yi, zi + 1);
	const v011 = latticeVal(xi, yi + 1, zi + 1), v111 = latticeVal(xi + 1, yi + 1, zi + 1);
	const x00 = v000 + (v100 - v000) * fx;
	const x10 = v010 + (v110 - v010) * fx;
	const x01 = v001 + (v101 - v001) * fx;
	const x11 = v011 + (v111 - v011) * fx;
	const y0 = x00 + (x10 - x00) * fy;
	const y1 = x01 + (x11 - x01) * fy;
	return y0 + (y1 - y0) * fz;
}

function noisePotential(x, y, t) {
	return noise3(x, y, t) + 0.5 * noise3(x * 2.17 + 31.4, y * 2.17 + 47.2, t * 1.7);
}

// swirl force = curl of scalar potential (fx = dP/dy, fy = -dP/dx), so it never piles up
function turbForce(x, y, t, freq, out) {
	const sx = x * freq, sy = y * freq;
	const dPdx = (noisePotential(sx + FIELD_EPS, sy, t) - noisePotential(sx - FIELD_EPS, sy, t)) / (2 * FIELD_EPS);
	const dPdy = (noisePotential(sx, sy + FIELD_EPS, t) - noisePotential(sx, sy - FIELD_EPS, t)) / (2 * FIELD_EPS);
	out.x = dPdy;
	out.y = -dPdx;
}

if (typeof module !== 'undefined') module.exports = { mulberry32, fieldInit, noise3, turbForce };
