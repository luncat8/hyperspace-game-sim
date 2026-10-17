// sim.js — headless hyperspace crossing simulation (no DOM; browser + node)
'use strict';

if (typeof module !== 'undefined') {
	// under node pull field helpers in; in browser they are globals from field.js
	var { mulberry32, fieldInit, turbForce } = require('./field.js');
}

const WORLD_W = 1600;
const WORLD_H = 1000;
const GUIDE_PTS = 64;
const REAL_SCALE_K = 1000; // 1 hyper unit covers this many real-space units

const TUNE = {
	turbStrength: 300,	// peak turbulence acceleration
	turbFreq: 1 / 170,
	turbTimeScale: 0.22,
	shipThrust: 110,
	shipRetro: 70,
	shipTurn: 3.2,
	shipDrag: 0.55,
	hullMax: 100,
	hullSafeAccel: 60,	// turbulence accel absorbed for free
	hullWearRate: 0.05,	// damage per (accel unit * s) above safe
	energyMax: 130,
	energyIdleDrain: 0.9,	// hyperspace drains the ship just for existing
	energyThrustDrain: 2.4,
	gateOpenCost: 15,	// must arrive with at least this much energy
	gateRadius: 46,
	coneHalfAngle: 0.105,	// radians; narrow beam
	coneDamp: 0.18,
	beamCenterK: 1.1,	// beam pressure toward axis, per unit lateral offset
	beamCenterMax: 42,
	guideFalloff: 130,	// distance where turbulence is back to full force
	guideDampFloor: 0.06,
	guidePull: 0.9,		// valley slope accel per unit distance off the curve
	guidePullMax: 55,
	buoyMax: 6,
	buoyCost: 9,
	buoyRadius: 125,
	buoyDamp: 0.1,
	timeLimit: 150,
};

// result codes
const RES_RUNNING = 0, RES_ARRIVED = 1, RES_HULL = -1, RES_ENERGY = -2, RES_TIME = -3, RES_GATE_BROKE = -4;

const scratchF = { x: 0, y: 0 }; // turbulence sample, reused every step

function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }

function wrapAngle(a) {
	while (a > Math.PI) a -= 2 * Math.PI;
	while (a < -Math.PI) a += 2 * Math.PI;
	return a;
}

function makeState(seed, modes) {
	fieldInit(seed);
	const rnd = mulberry32((seed ^ 0x9E3779B9) >>> 0);
	const entry = { x: 140, y: 280 + rnd() * 440 };
	const exit = { x: WORLD_W - 140, y: 280 + rnd() * 440 };
	const state = {
		seed, modes, t: 0,
		ship: {
			x: entry.x, y: entry.y, vx: 0, vy: 0,
			angle: Math.atan2(exit.y - entry.y, exit.x - entry.x),
		},
		entry, exit,
		entryBeam: Math.atan2(exit.y - entry.y, exit.x - entry.x),
		exitBeam: Math.atan2(entry.y - exit.y, entry.x - exit.x),
		guide: new Float64Array(GUIDE_PTS * 2),
		buoyX: new Float64Array(TUNE.buoyMax),
		buoyY: new Float64Array(TUNE.buoyMax),
		buoyCount: 0,
		hull: TUNE.hullMax,
		energy: TUNE.energyMax,
		stats: { time: 0, wear: 0, energyUsed: 0, exposure: 0, hyperDist: 0 },
		result: RES_RUNNING,
		// per-step readouts for HUD / render / autopilot
		turbScale: 1, appliedTurb: 0,
		gnX: 0, gnY: 0, gnD: 0, gnI: 0, // nearest guide point cache
	};
	buildGuide(state, rnd);
	return state;
}

// seeded cubic bezier between gates: the "stable valley" of mode 2
function buildGuide(state, rnd) {
	const e = state.entry, x = state.exit;
	const dx = x.x - e.x, dy = x.y - e.y;
	const len = Math.sqrt(dx * dx + dy * dy);
	const px = -dy / len, py = dx / len;
	const o1 = (rnd() - 0.5) * 520, o2 = (rnd() - 0.5) * 520;
	const c1x = e.x + dx / 3 + px * o1, c1y = e.y + dy / 3 + py * o1;
	const c2x = e.x + dx * 2 / 3 + px * o2, c2y = e.y + dy * 2 / 3 + py * o2;
	for (let i = 0; i < GUIDE_PTS; i++) {
		const t = i / (GUIDE_PTS - 1), u = 1 - t;
		const a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
		state.guide[i * 2] = a * e.x + b * c1x + c * c2x + d * x.x;
		state.guide[i * 2 + 1] = a * e.y + b * c1y + c * c2y + d * x.y;
	}
}

// nearest point on the guide polyline; caches result on state, returns distance
function guideNearest(state, x, y) {
	const g = state.guide;
	let bestD2 = Infinity, bx = 0, by = 0, bi = 0;
	for (let i = 0; i < GUIDE_PTS - 1; i++) {
		const ax = g[i * 2], ay = g[i * 2 + 1];
		const ex = g[i * 2 + 2] - ax, ey = g[i * 2 + 3] - ay;
		const t = clamp01(((x - ax) * ex + (y - ay) * ey) / (ex * ex + ey * ey));
		const qx = ax + ex * t, qy = ay + ey * t;
		const dx = x - qx, dy = y - qy;
		const d2 = dx * dx + dy * dy;
		if (d2 >= bestD2) continue;
		bestD2 = d2; bx = qx; by = qy; bi = i;
	}
	state.gnX = bx; state.gnY = by; state.gnI = bi;
	state.gnD = Math.sqrt(bestD2);
	return state.gnD;
}

function beamContains(gx, gy, axis, x, y) {
	const dx = x - gx, dy = y - gy;
	if (dx * dx + dy * dy < 4) return true;
	return Math.abs(wrapAngle(Math.atan2(dy, dx) - axis)) < TUNE.coneHalfAngle;
}

// how much the active modes damp turbulence at (x,y); 1 = full force
function turbScaleAt(state, x, y) {
	let scale = 1;
	const m = state.modes;
	if (m.beacons &&
		(beamContains(state.entry.x, state.entry.y, state.entryBeam, x, y) ||
		 beamContains(state.exit.x, state.exit.y, state.exitBeam, x, y)))
		scale = TUNE.coneDamp;
	if (m.guide) {
		const d = guideNearest(state, x, y);
		const s = TUNE.guideDampFloor + (1 - TUNE.guideDampFloor) * clamp01(d / TUNE.guideFalloff);
		if (s < scale) scale = s;
	}
	if (m.buoys && state.buoyCount > 0) {
		let best = Infinity;
		for (let i = 0; i < state.buoyCount; i++) {
			const dx = x - state.buoyX[i], dy = y - state.buoyY[i];
			const d2 = dx * dx + dy * dy;
			if (d2 < best) best = d2;
		}
		const s = TUNE.buoyDamp + (1 - TUNE.buoyDamp) * clamp01(Math.sqrt(best) / TUNE.buoyRadius);
		if (s < scale) scale = s;
	}
	return scale;
}

// mild lateral pressure toward the axis of whichever beam holds the ship
function beamCenteringAccel(state, sh) {
	let gx, gy, axis;
	if (beamContains(state.entry.x, state.entry.y, state.entryBeam, sh.x, sh.y)) {
		gx = state.entry.x; gy = state.entry.y; axis = state.entryBeam;
	} else if (beamContains(state.exit.x, state.exit.y, state.exitBeam, sh.x, sh.y)) {
		gx = state.exit.x; gy = state.exit.y; axis = state.exitBeam;
	} else return 0;
	const px = -Math.sin(axis), py = Math.cos(axis);
	const lateral = (sh.x - gx) * px + (sh.y - gy) * py;
	const a = clamp(-lateral * TUNE.beamCenterK, -TUNE.beamCenterMax, TUNE.beamCenterMax);
	scratchF.x += px * a; scratchF.y += py * a; // reuses turbulence scratch after it is consumed
	return a;
}

function tryDropBuoy(state) {
	if (!state.modes.buoys) return;
	if (state.buoyCount >= TUNE.buoyMax || state.energy < TUNE.buoyCost) return;
	state.buoyX[state.buoyCount] = state.ship.x;
	state.buoyY[state.buoyCount] = state.ship.y;
	state.buoyCount++;
	state.energy -= TUNE.buoyCost;
	state.stats.energyUsed += TUNE.buoyCost;
}

// input: { turn: -1..1, thrust: 0|1, retro: 0|1, drop: bool (consumed) }
function simStep(state, input, dt) {
	if (state.result !== RES_RUNNING) return;
	const sh = state.ship;
	state.t += dt;
	state.stats.time += dt;

	if (input.drop) tryDropBuoy(state);
	input.drop = false;

	sh.angle = wrapAngle(sh.angle + input.turn * TUNE.shipTurn * dt);
	let ax = 0, ay = 0, thrustDrain = 0;
	if (input.thrust && state.energy > 0) {
		ax += Math.cos(sh.angle) * TUNE.shipThrust;
		ay += Math.sin(sh.angle) * TUNE.shipThrust;
		thrustDrain = TUNE.energyThrustDrain;
	}
	if (input.retro && state.energy > 0) {
		ax -= Math.cos(sh.angle) * TUNE.shipRetro;
		ay -= Math.sin(sh.angle) * TUNE.shipRetro;
		thrustDrain += TUNE.energyThrustDrain * 0.6;
	}

	// environment: damped turbulence + mode shaping forces
	const scale = turbScaleAt(state, sh.x, sh.y);
	turbForce(sh.x, sh.y, state.t * TUNE.turbTimeScale, TUNE.turbFreq, scratchF);
	scratchF.x *= TUNE.turbStrength * scale;
	scratchF.y *= TUNE.turbStrength * scale;
	const turbMag = Math.sqrt(scratchF.x * scratchF.x + scratchF.y * scratchF.y);
	if (state.modes.beacons) beamCenteringAccel(state, sh);
	if (state.modes.guide && state.gnD > 1) {
		const pull = Math.min(TUNE.guidePullMax, state.gnD * TUNE.guidePull);
		scratchF.x += (state.gnX - sh.x) / state.gnD * pull;
		scratchF.y += (state.gnY - sh.y) / state.gnD * pull;
	}
	ax += scratchF.x; ay += scratchF.y;

	sh.vx += (ax - sh.vx * TUNE.shipDrag) * dt;
	sh.vy += (ay - sh.vy * TUNE.shipDrag) * dt;
	const sp = Math.sqrt(sh.vx * sh.vx + sh.vy * sh.vy);
	sh.x += sh.vx * dt;
	sh.y += sh.vy * dt;
	if (sh.x < 0) { sh.x = 0; sh.vx *= -0.5; }
	if (sh.x > WORLD_W) { sh.x = WORLD_W; sh.vx *= -0.5; }
	if (sh.y < 0) { sh.y = 0; sh.vy *= -0.5; }
	if (sh.y > WORLD_H) { sh.y = WORLD_H; sh.vy *= -0.5; }

	// wear, energy, readouts
	state.turbScale = scale;
	state.appliedTurb = turbMag;
	state.stats.exposure += turbMag * dt;
	state.stats.hyperDist += sp * dt;
	const over = turbMag - TUNE.hullSafeAccel;
	if (over > 0) {
		const dmg = over * TUNE.hullWearRate * dt;
		state.hull -= dmg;
		state.stats.wear += dmg;
	}
	const drain = (TUNE.energyIdleDrain + thrustDrain) * dt;
	state.energy -= drain;
	state.stats.energyUsed += drain;

	// outcomes
	const ex = state.exit.x - sh.x, ey = state.exit.y - sh.y;
	if (ex * ex + ey * ey < TUNE.gateRadius * TUNE.gateRadius) {
		if (state.energy >= TUNE.gateOpenCost) {
			state.energy -= TUNE.gateOpenCost;
			state.result = RES_ARRIVED;
		} else state.result = RES_GATE_BROKE;
		return;
	}
	if (state.hull <= 0) { state.hull = 0; state.result = RES_HULL; return; }
	if (state.energy <= 0) { state.energy = 0; state.result = RES_ENERGY; return; }
	if (state.stats.time > TUNE.timeLimit) state.result = RES_TIME;
}

if (typeof module !== 'undefined') module.exports = {
	WORLD_W, WORLD_H, GUIDE_PTS, REAL_SCALE_K, TUNE,
	RES_RUNNING, RES_ARRIVED, RES_HULL, RES_ENERGY, RES_TIME, RES_GATE_BROKE,
	wrapAngle, makeState, simStep, turbScaleAt, guideNearest,
};
