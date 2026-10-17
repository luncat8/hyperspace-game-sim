// heuristic pilot: repeats the same flight for many seeds so the difficulty of a
// configuration can be measured instead of guessed
(function (root) {
	'use strict';

	const HSG = root.HSG || (root.HSG = {});
	if (typeof module !== 'undefined' && module.exports) {
		Object.assign(HSG, require('./rng.js'));
	}

	function createAutopilot(cfg) {
		const p = Object.assign({
			lookAhead: 320,
			cruise: 120,
			gain: 0.8,
			approachRange: 600,
			aimNoiseRate: 1.6
		}, cfg);
		const rng = HSG.createRng((cfg && cfg.seed) || 4242);
		const target = { x: 0, y: 0 };
		const out = { x: 0, y: 0 };
		let aimNoise = 0;

		function update(sim, dt) {
			const ship = sim.ship;
			const exit = sim.gates[1];
			const field = sim.field;
			const ex = exit.x - ship.x;
			const ey = exit.y - ship.y;
			const dist = Math.hypot(ex, ey);
			let desiredSpeed = p.cruise;
			if (dist < p.approachRange) {
				target.x = exit.x;
				target.y = exit.y;
				// slow down on approach, the gate only captures a calm ship
				desiredSpeed = Math.max(25, Math.min(p.cruise, dist * 0.55));
			} else {
				field.guidePointAhead(ship.x, ship.y, p.lookAhead, target);
			}
			aimNoise += (rng.gauss() * 0.02 - aimNoise) * Math.min(1, dt * p.aimNoiseRate);
			const err = aimNoise * (ship.psy / 100) * 1.4;
			const ca = Math.cos(err);
			const sa = Math.sin(err);
			const rx = target.x - ship.x;
			const ry = target.y - ship.y;
			const ax = rx * ca - ry * sa;
			const ay = rx * sa + ry * ca;
			const len = Math.hypot(ax, ay) || 1;
			const evx = (ax / len) * desiredSpeed - ship.vx;
			const evy = (ay / len) * desiredSpeed - ship.vy;
			const elen = Math.hypot(evx, evy);
			if (elen < 1e-4) {
				out.x = 0;
				out.y = 0;
				return out;
			}
			const mag = Math.min(1, elen * p.gain);
			out.x = (evx / elen) * mag;
			out.y = (evy / elen) * mag;
			return out;
		}

		return { update, out };
	}

	HSG.createAutopilot = createAutopilot;

	if (typeof module !== 'undefined' && module.exports) {
		module.exports = { createAutopilot };
	}
})(typeof globalThis !== 'undefined' ? globalThis : this);
