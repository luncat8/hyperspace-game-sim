// gas pressure transport: a source at the entry and a sink at the exit generate a
// pressure potential (poisson solve). the resulting flow always routes to the sink,
// so a natural path exists no matter what the heightmap does.
(function (root) {
	'use strict';

	const HSG = root.HSG || (root.HSG = {});

	function createFlow(cfg) {
		const gw = cfg.gw || 48;
		const gh = cfg.gh || 30;
		const worldW = cfg.worldW;
		const worldH = cfg.worldH;
		const hx = worldW / gw;
		const hy = worldH / gh;

		const phi = new Float32Array(gw * gh);
		const velX = new Float32Array(gw * gh);
		const velY = new Float32Array(gw * gh);
		const ambX = new Float32Array(gw * gh);
		const ambY = new Float32Array(gw * gh);
		const dens = new Float32Array(gw * gh);
		const densTmp = new Float32Array(gw * gh);
		const src = new Float32Array(gw * gh);
		const speeds = [];

		let source = null;
		let sinks = [];
		let targetSpeed = cfg.flowSpeed || 210;
		let potentialDirty = true;
		let particleDensity = false;

		function setPorts(nextSource, nextSinks) {
			source = nextSource;
			sinks = nextSinks;
			potentialDirty = true;
		}

		function buildSourceField() {
			src.fill(0);
			let sum = 0;
			let sumAbs = 0;
			const add = (p, sign) => {
				if (!p || p.rate <= 0) return;
				const gx = p.x / hx;
				const gy = p.y / hy;
				const rx = Math.max(1, p.r / hx);
				const ry = Math.max(1, p.r / hy);
				const x0 = Math.max(0, Math.floor(gx - rx));
				const x1 = Math.min(gw - 1, Math.ceil(gx + rx));
				const y0 = Math.max(0, Math.floor(gy - ry));
				const y1 = Math.min(gh - 1, Math.ceil(gy + ry));
				for (let y = y0; y <= y1; y++) {
					for (let x = x0; x <= x1; x++) {
						const dx = (x - gx) * hx;
						const dy = (y - gy) * hy;
						const w = Math.exp(-(dx * dx + dy * dy) / (2 * p.r * p.r));
						const v = sign * p.rate * w;
						src[y * gw + x] += v;
						sum += v;
						sumAbs += Math.abs(v);
					}
				}
			};
			add(source, 1);
			for (const s of sinks) add(s, -1);
			// normalise by the total magnitude, never by the net sum: the source and
			// the sink almost cancel out, dividing by that would flip the whole field
			const norm = sumAbs > 1e-9 ? 1000 / sumAbs : 0;
			for (let i = 0; i < src.length; i++) src[i] *= norm;
			void sum;
		}

		// gauss-seidel sweep of laplace(phi) = -src
		function solvePotential(iterations) {
			const ax = 1 / (hx * hx);
			const ay = 1 / (hy * hy);
			const den = 2 * ax + 2 * ay;
			for (let it = 0; it < iterations; it++) {
				for (let y = 0; y < gh; y++) {
					const row = y * gw;
					const up = y > 0 ? row - gw : row;
					const dn = y < gh - 1 ? row + gw : row;
					for (let x = 0; x < gw; x++) {
						const l = x > 0 ? row + x - 1 : row + x;
						const r = x < gw - 1 ? row + x + 1 : row + x;
						phi[row + x] = ((phi[l] + phi[r]) * ax + (phi[up + x] + phi[dn + x]) * ay + src[row + x]) / den;
					}
				}
			}
		}

		// gradient of the potential, rescaled to a stable stream speed
		function updateVelocity() {
			let mean = 0;
			for (let y = 0; y < gh; y++) {
				const row = y * gw;
				const up = y > 0 ? row - gw : row;
				const dn = y < gh - 1 ? row + gw : row;
				for (let x = 0; x < gw; x++) {
					const l = x > 0 ? row + x - 1 : row + x;
					const r = x < gw - 1 ? row + x + 1 : row + x;
					// a source has a high potential, the medium flows from high to low
					const vx = -(phi[r] - phi[l]) / (2 * hx);
					const vy = -(phi[dn + x] - phi[up + x]) / (2 * hy);
					velX[row + x] = vx;
					velY[row + x] = vy;
					mean += Math.sqrt(vx * vx + vy * vy);
				}
			}
			mean /= gw * gh;
			speeds.length = 0;
			for (let i = 0; i < velX.length; i++) speeds.push(Math.hypot(velX[i], velY[i]));
			speeds.sort((a, b) => a - b);
			const p90 = speeds[Math.floor(speeds.length * 0.9)] || mean;
			const k = p90 > 1e-9 ? targetSpeed / p90 : 0;
			const cap = targetSpeed * 1.45;
			for (let i = 0; i < velX.length; i++) {
				velX[i] *= k;
				velY[i] *= k;
				const m = Math.hypot(velX[i], velY[i]);
				if (m > cap) {
					velX[i] = velX[i] / m * cap;
					velY[i] = velY[i] / m * cap;
				}
			}
		}

		function sampleGrid(grid, x, y) {
			let fx = x / hx - 0.5;
			let fy = y / hy - 0.5;
			if (fx < 0) fx = 0;
			else if (fx > gw - 1.001) fx = gw - 1.001;
			if (fy < 0) fy = 0;
			else if (fy > gh - 1.001) fy = gh - 1.001;
			const x0 = fx | 0;
			const y0 = fy | 0;
			const tx = fx - x0;
			const ty = fy - y0;
			const w = gw;
			const v00 = grid[y0 * w + x0];
			const v10 = grid[y0 * w + x0 + 1];
			const v01 = grid[(y0 + 1) * w + x0];
			const v11 = grid[(y0 + 1) * w + x0 + 1];
			return (v00 * (1 - tx) + v10 * tx) * (1 - ty) + (v01 * (1 - tx) + v11 * tx) * ty;
		}

		function sampleVelocity(x, y, out) {
			out.x = sampleGrid(velX, x, y) + sampleGrid(ambX, x, y);
			out.y = sampleGrid(velY, x, y) + sampleGrid(ambY, x, y);
			return out;
		}

		// the pressure stream alone, without the environment drift
		function sampleStream(x, y, out) {
			out.x = sampleGrid(velX, x, y);
			out.y = sampleGrid(velY, x, y);
			return out;
		}

		function sampleDensity(x, y) {
			return sampleGrid(dens, x, y);
		}

		// gas is injected at the source, pushed along the flow, drained at the sinks
		function stepDensity(dt) {
			// injection and drain are balanced: the gas must not pile up at the source
			const rate = 0.35;
			if (source && source.rate > 0) {
				const gx = source.x / hx;
				const gy = source.y / hy;
				const rx = Math.max(1, source.r / hx);
				const ry = Math.max(1, source.r / hy);
				const x0 = Math.max(0, Math.floor(gx - rx));
				const x1 = Math.min(gw - 1, Math.ceil(gx + rx));
				const y0 = Math.max(0, Math.floor(gy - ry));
				const y1 = Math.min(gh - 1, Math.ceil(gy + ry));
				for (let y = y0; y <= y1; y++) {
					for (let x = x0; x <= x1; x++) {
						const dx = (x - gx) * hx;
						const dy = (y - gy) * hy;
						const w = Math.exp(-(dx * dx + dy * dy) / (2 * source.r * source.r));
						dens[y * gw + x] += source.rate * rate * w * dt;
					}
				}
			}
			for (const s of sinks) {
				if (!s || s.rate <= 0) continue;
				const gx = s.x / hx;
				const gy = s.y / hy;
				const rx = Math.max(1, s.r / hx);
				const ry = Math.max(1, s.r / hy);
				const x0 = Math.max(0, Math.floor(gx - rx));
				const x1 = Math.min(gw - 1, Math.ceil(gx + rx));
				const y0 = Math.max(0, Math.floor(gy - ry));
				const y1 = Math.min(gh - 1, Math.ceil(gy + ry));
				for (let y = y0; y <= y1; y++) {
					for (let x = x0; x <= x1; x++) {
						const dx = (x - gx) * hx;
						const dy = (y - gy) * hy;
						const w = Math.exp(-(dx * dx + dy * dy) / (2 * s.r * s.r));
						const i = y * gw + x;
						dens[i] -= s.rate * rate * w * dt * 1.9;
						if (dens[i] < 0) dens[i] = 0;
					}
				}
			}
			// semi lagrangian advection with the total flow
			for (let y = 0; y < gh; y++) {
				const row = y * gw;
				for (let x = 0; x < gw; x++) {
					const i = row + x;
					const sx = x * hx + hx * 0.5 - (velX[i] + ambX[i]) * dt;
					const sy = y * hy + hy * 0.5 - (velY[i] + ambY[i]) * dt;
					densTmp[i] = sampleGrid(dens, sx, sy);
				}
			}
			for (let i = 0; i < dens.length; i++) {
				const v = densTmp[i];
				dens[i] = v > 3 ? 3 : v;
			}
		}

		// the gas cloud is drawn from the tracer particles: a lagrangian cloud does
		// not smear like an advected scalar field
		function clearDensity() {
			dens.fill(0);
		}

		function splat(x, y) {
			let fx = x / hx - 0.5;
			let fy = y / hy - 0.5;
			if (fx < 0) fx = 0;
			else if (fx > gw - 1.001) fx = gw - 1.001;
			if (fy < 0) fy = 0;
			else if (fy > gh - 1.001) fy = gh - 1.001;
			const x0 = fx | 0;
			const y0 = fy | 0;
			const tx = fx - x0;
			const ty = fy - y0;
			const w = gw;
			dens[y0 * w + x0] += (1 - tx) * (1 - ty);
			dens[y0 * w + x0 + 1] += tx * (1 - ty);
			dens[(y0 + 1) * w + x0] += (1 - tx) * ty;
			dens[(y0 + 1) * w + x0 + 1] += tx * ty;
		}

		function step(dt) {
			if (potentialDirty) {
				buildSourceField();
				solvePotential(2500);
				updateVelocity();
				potentialDirty = false;
			}
			if (!particleDensity) stepDensity(dt);
		}

		// fast forward the gas so a run does not start with an empty medium
		function settle(seconds) {
			const dt = 1 / 30;
			const steps = Math.min(600, Math.round(seconds * 30));
			for (let i = 0; i < steps; i++) step(dt);
		}

		function setTargetSpeed(v) {
			targetSpeed = v;
			potentialDirty = true;
		}

		return {
			gw,
			gh,
			hx,
			hy,
			dens,
			ambX,
			ambY,
			velX,
			velY,
			clearDensity,
			splat,
			setParticleDensity(v) { particleDensity = v; },
			setPorts,
			setTargetSpeed,
			sampleVelocity,
			sampleStream,
			sampleDensity,
			step,
			settle
		};
	}

	HSG.createFlow = createFlow;

	if (typeof module !== 'undefined' && module.exports) {
		module.exports = { createFlow };
	}
})(typeof globalThis !== 'undefined' ? globalThis : this);
