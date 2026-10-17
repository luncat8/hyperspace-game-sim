// analytic environment field: heightmap drift, curl turbulence, guide valley,
// gate wells (source hill / sink pit) and gate beacon cones
(function (root) {
	'use strict';

	const HSG = root.HSG || (root.HSG = {});
	if (typeof module !== 'undefined' && module.exports) {
		Object.assign(HSG, require('./noise.js'));
	}

	const smoothstep = (a, b, x) => {
		if (b <= a) return x < a ? 0 : 1;
		const t = (x - a) / (b - a);
		return t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t);
	};

	// catmull rom spline through control points, flattened to [x0,y0,x1,y1,...]
	function catmullRom(points, perSegment) {
		if (points.length < 2) return new Float32Array(0);
		const n = points.length;
		const out = [];
		for (let i = 0; i < n - 1; i++) {
			const p0 = points[Math.max(0, i - 1)];
			const p1 = points[i];
			const p2 = points[i + 1];
			const p3 = points[Math.min(n - 1, i + 2)];
			const steps = i === n - 2 ? perSegment : perSegment;
			for (let s = 0; s < steps; s++) {
				const t = s / steps;
				const t2 = t * t;
				const t3 = t2 * t;
				const x = 0.5 * ((2 * p1.x) + (-p0.x + p2.x) * t +
					(2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 +
					(-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3);
				const y = 0.5 * ((2 * p1.y) + (-p0.y + p2.y) * t +
					(2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 +
					(-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3);
				out.push(x, y);
			}
		}
		out.push(points[n - 1].x, points[n - 1].y);
		return new Float32Array(out);
	}

	// brute force distance of every grid cell to the polyline, plus the arc length and
	// the tangent of the closest point, so the channel can have a floor that slopes
	// towards the exit
	function buildDistanceField(poly, worldW, worldH, cell) {
		const gw = Math.ceil(worldW / cell) + 1;
		const gh = Math.ceil(worldH / cell) + 1;
		const dist = new Float32Array(gw * gh);
		const along = new Float32Array(gw * gh);
		const tanX = new Float32Array(gw * gh);
		const tanY = new Float32Array(gw * gh);
		const segs = poly.length / 2 - 1;
		const segLen = new Float32Array(segs);
		const cum = new Float32Array(segs + 1);
		for (let s = 0; s < segs; s++) {
			segLen[s] = Math.hypot(poly[s * 2 + 2] - poly[s * 2], poly[s * 2 + 3] - poly[s * 2 + 1]);
			cum[s + 1] = cum[s] + segLen[s];
		}
		for (let gy = 0; gy < gh; gy++) {
			const py = gy * cell;
			for (let gx = 0; gx < gw; gx++) {
				const px = gx * cell;
				let best = 1e18;
				let bestS = 0;
				let bestT = 0;
				for (let s = 0; s < segs; s++) {
					const ax = poly[s * 2];
					const ay = poly[s * 2 + 1];
					const ex = poly[s * 2 + 2] - ax;
					const ey = poly[s * 2 + 3] - ay;
					const len2 = ex * ex + ey * ey;
					let t = len2 > 0 ? ((px - ax) * ex + (py - ay) * ey) / len2 : 0;
					t = t < 0 ? 0 : t > 1 ? 1 : t;
					const qx = ax + ex * t - px;
					const qy = ay + ey * t - py;
					const d2 = qx * qx + qy * qy;
					if (d2 < best) { best = d2; bestS = s; bestT = t; }
				}
				const i = gy * gw + gx;
				dist[i] = Math.sqrt(best);
				along[i] = cum[bestS] + bestT * segLen[bestS];
				const len = segLen[bestS] || 1;
				tanX[i] = (poly[bestS * 2 + 2] - poly[bestS * 2]) / len;
				tanY[i] = (poly[bestS * 2 + 3] - poly[bestS * 2 + 1]) / len;
			}
		}
		return { poly, dist, along, tanX, tanY, cum, segLen, gw, gh, cell, total: cum[segs] };
	}

	function createField(cfg) {
		const worldW = cfg.worldW;
		const worldH = cfg.worldH;
		const noise = HSG.createNoise(cfg.seed >>> 0);
		const curlNoise = HSG.createNoise((cfg.seed ^ 0x27d4eb2f) >>> 0);
		const noiseScale = cfg.noiseScale;
		const curlScale = cfg.curlScale;
		const octaves = cfg.octaves;
		const curlOctaves = cfg.curlOctaves;
		const guideCell = cfg.guideCell || 10;
		const channelWidth = cfg.channelWidth || 80;
		const channelFalloff = cfg.channelFalloff || 2.6;

		let gates = (cfg.gates || []).slice();
		let guide = null;

		function height(x, y) {
			return noise.fbm(x * noiseScale, y * noiseScale, octaves, 2.0, 0.5);
		}

		function heightGrad(x, y, out) {
			const e = 1.5;
			out.x = (height(x + e, y) - height(x - e, y)) / (2 * e);
			out.y = (height(x, y + e) - height(x, y - e)) / (2 * e);
			// the fine octaves can spike, keep the push physical
			const len = Math.hypot(out.x, out.y);
			if (len > 0.03) { out.x = out.x / len * 0.03; out.y = out.y / len * 0.03; }
			return out;
		}

		// divergence free flow: curl of a scalar potential, slides bodies along iso lines
		function curlAt(x, y, out) {
			const e = 1.5;
			const dx = (curlNoise.fbm((x + e) * curlScale, y * curlScale, curlOctaves, 2, 0.5) -
				curlNoise.fbm((x - e) * curlScale, y * curlScale, curlOctaves, 2, 0.5)) / (2 * e);
			const dy = (curlNoise.fbm(x * curlScale, (y + e) * curlScale, curlOctaves, 2, 0.5) -
				curlNoise.fbm(x * curlScale, (y - e) * curlScale, curlOctaves, 2, 0.5)) / (2 * e);
			out.x = dy;
			out.y = -dx;
			return out;
		}

		function setGuide(points) {
			const poly = catmullRom(points, 24);
			guide = buildDistanceField(poly, worldW, worldH, guideCell);
			return guide;
		}

		// point on the guide curve, `ahead` units further along it from the projection of (x,y)
		function guidePointAhead(x, y, ahead, out) {
			if (!guide) { out.x = x; out.y = y; return out; }
			const poly = guide.poly;
			const segs = poly.length / 2 - 1;
			let bestSeg = 0;
			let bestT = 0;
			let bestD = Infinity;
			for (let s = 0; s < segs; s++) {
				const ax = poly[s * 2];
				const ay = poly[s * 2 + 1];
				const ex = poly[s * 2 + 2] - ax;
				const ey = poly[s * 2 + 3] - ay;
				const len2 = ex * ex + ey * ey;
				let t = len2 > 0 ? ((x - ax) * ex + (y - ay) * ey) / len2 : 0;
				t = t < 0 ? 0 : t > 1 ? 1 : t;
				const qx = ax + ex * t - x;
				const qy = ay + ey * t - y;
				const d2 = qx * qx + qy * qy;
				if (d2 < bestD) { bestD = d2; bestSeg = s; bestT = t; }
			}
			const segLen = Math.hypot(poly[bestSeg * 2 + 2] - poly[bestSeg * 2], poly[bestSeg * 2 + 3] - poly[bestSeg * 2 + 1]) || 1;
			let remaining = ahead - bestT * segLen;
			if (remaining <= 0) {
				out.x = poly[bestSeg * 2] + (poly[bestSeg * 2 + 2] - poly[bestSeg * 2]) * bestT;
				out.y = poly[bestSeg * 2 + 1] + (poly[bestSeg * 2 + 3] - poly[bestSeg * 2 + 1]) * bestT;
				return out;
			}
			for (let s = bestSeg; s < segs; s++) {
				const ax = poly[s * 2];
				const ay = poly[s * 2 + 1];
				const bx = poly[s * 2 + 2];
				const by = poly[s * 2 + 3];
				const len = Math.hypot(bx - ax, by - ay);
				if (remaining <= len) {
					const t = len > 0 ? remaining / len : 0;
					out.x = ax + (bx - ax) * t;
					out.y = ay + (by - ay) * t;
					return out;
				}
				remaining -= len;
			}
			out.x = poly[poly.length - 2];
			out.y = poly[poly.length - 1];
			return out;
		}

		function sampleGridValue(grid, x, y) {
			if (!guide) return 0;
			const g = guide;
			let fx = x / g.cell;
			let fy = y / g.cell;
			if (fx < 0) fx = 0;
			else if (fx > g.gw - 1.001) fx = g.gw - 1.001;
			if (fy < 0) fy = 0;
			else if (fy > g.gh - 1.001) fy = g.gh - 1.001;
			const x0 = fx | 0;
			const y0 = fy | 0;
			const tx = fx - x0;
			const ty = fy - y0;
			const w = g.gw;
			const v00 = grid[y0 * w + x0];
			const v10 = grid[y0 * w + x0 + 1];
			const v01 = grid[(y0 + 1) * w + x0];
			const v11 = grid[(y0 + 1) * w + x0 + 1];
			return (v00 * (1 - tx) + v10 * tx) * (1 - ty) + (v01 * (1 - tx) + v11 * tx) * ty;
		}

		function sampleDist(x, y) {
			return guide ? sampleGridValue(guide.dist, x, y) : 1e9;
		}

		// arc length of the closest point of the guide curve
		function sampleAlong(x, y) {
			return guide ? sampleGridValue(guide.along, x, y) : 0;
		}

		function guideGrad(x, y, out) {
			if (!guide) { out.x = 0; out.y = 0; return out; }
			const e = guide.cell;
			out.x = (sampleDist(x + e, y) - sampleDist(x - e, y)) / (2 * e);
			out.y = (sampleDist(x, y + e) - sampleDist(x, y - e)) / (2 * e);
			return out;
		}

		// unit tangent of the guide at the closest point - the downhill of the channel floor
		function guideTangent(x, y, out) {
			if (!guide) { out.x = 0; out.y = 0; return out; }
			out.x = sampleGridValue(guide.tanX, x, y);
			out.y = sampleGridValue(guide.tanY, x, y);
			const len = Math.hypot(out.x, out.y);
			if (len > 1e-5) { out.x /= len; out.y /= len; }
			return out;
		}

		// 1 inside the calm channel, 0 far outside of it
		function channelFactor(dist) {
			return 1 - smoothstep(channelWidth, channelWidth * channelFalloff, dist);
		}

		// beacon cones: exit gate tractors the ship in, entry gate pushes it out
		function beaconForce(x, y, out) {
			out.x = 0;
			out.y = 0;
			for (let i = 0; i < gates.length; i++) {
				const g = gates[i];
				if (!g.beacon || !g.open || !g.built) continue;
				const dx = x - g.x;
				const dy = y - g.y;
				const r = Math.sqrt(dx * dx + dy * dy);
				if (r > g.coneRange || r < 1e-4) continue;
				const c = Math.cos(g.face);
				const s = Math.sin(g.face);
				const proj = (dx * c + dy * s) / r;
				if (proj <= 0.05) continue;
				if (proj < Math.cos(g.coneAngle)) continue;
				const mag = g.beaconPower * (1 - 0.55 * (r / g.coneRange));
				const sgn = g.tractor ? -1 : 1;
				out.x += sgn * c * mag;
				out.y += sgn * s * mag;
			}
			return out;
		}

		// gate wells: entry is a hill (source), exit is a pit (sink)
		function gateForce(x, y, out) {
			out.x = 0;
			out.y = 0;
			for (let i = 0; i < gates.length; i++) {
				const g = gates[i];
				if (!g.well || !g.open || !g.built) continue;
				const dx = x - g.x;
				const dy = y - g.y;
				const sig2 = g.wellSigma * g.wellSigma;
				const e = Math.exp(-(dx * dx + dy * dy) / sig2);
				const k = g.wellSign * g.wellAmp * 2 * e / sig2;
				out.x += k * dx;
				out.y += k * dy;
			}
			return out;
		}

		return {
			worldW,
			worldH,
			noiseScale,
			curlScale,
			channelWidth,
			get gates() { return gates; },
			get guide() { return guide; },
			setGates(next) { gates = next.slice(); },
			setGuide,
			height,
			heightGrad,
			curlAt,
			sampleDist,
			sampleAlong,
			guideGrad,
			guideTangent,
			guidePointAhead,
			channelFactor,
			beaconForce,
			gateForce
		};
	}

	HSG.createField = createField;
	HSG.smoothstep = smoothstep;
	HSG.catmullRom = catmullRom;

	if (typeof module !== 'undefined' && module.exports) {
		module.exports = { createField, catmullRom, smoothstep };
	}
})(typeof globalThis !== 'undefined' ? globalThis : this);
