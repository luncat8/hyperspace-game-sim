#!/usr/bin/env node
// difficulty.js — measure path-finding difficulty per mode with a naive autopilot
'use strict';

const SIM = require('../sim.js');

const DT = 1 / 60;
const SEEDS = 24;
const LOOKAHEAD = 5;	// guide points ahead of nearest to aim at
const VMAX = 220;

const CONFIGS = [
	['raw', { beacons: false, guide: false, buoys: false }],
	['beacons', { beacons: true, guide: false, buoys: false }],
	['guide', { beacons: false, guide: true, buoys: false }],
	['buoys', { beacons: false, guide: false, buoys: true }],
	['all', { beacons: true, guide: true, buoys: true }],
];

function drive(state, input) {
	const sh = state.ship;
	let tx = state.exit.x, ty = state.exit.y;
	const exd = state.exit.x - sh.x, eyd = state.exit.y - sh.y;
	const exitDist = Math.hypot(exd, eyd);
	if (state.modes.guide && exitDist > 220) {
		SIM.guideNearest(state, sh.x, sh.y);
		const i = Math.min(state.gnI + LOOKAHEAD, SIM.GUIDE_PTS - 1);
		tx = state.guide[i * 2]; ty = state.guide[i * 2 + 1];
	}
	// steer toward (desired velocity - current velocity)
	const dx = tx - sh.x, dy = ty - sh.y;
	const d = Math.hypot(dx, dy) || 1;
	const want = Math.atan2(dy / d * VMAX - sh.vy, dx / d * VMAX - sh.vx);
	const diff = SIM.wrapAngle(want - sh.angle);
	input.turn = Math.max(-1, Math.min(1, diff * 2.5));
	input.thrust = Math.abs(diff) < 0.9 ? 1 : 0;
	input.retro = 0;
	// buoys: drop when hammered by undamped turbulence (fresh buoy calms the spot = natural cooldown)
	input.drop = state.modes.buoys && state.appliedTurb > 90 && state.turbScale > 0.5;
}

function runOne(seed, modes) {
	const state = SIM.makeState(seed, modes);
	const input = { turn: 0, thrust: 0, retro: 0, drop: false };
	while (state.result === SIM.RES_RUNNING) {
		drive(state, input);
		SIM.simStep(state, input, DT);
	}
	return state;
}

function pct(n, total) { return (100 * n / total).toFixed(0).padStart(3) + '%'; }

console.log('mode     | win  hull energy gate time | avg t(win) avg wear avg exposure');
for (const [name, modes] of CONFIGS) {
	const byResult = { 1: 0, '-1': 0, '-2': 0, '-3': 0, '-4': 0 };
	let winTime = 0, wear = 0, exposure = 0;
	for (let seed = 1; seed <= SEEDS; seed++) {
		const s = runOne(seed, modes);
		byResult[s.result]++;
		wear += s.stats.wear;
		exposure += s.stats.exposure;
		if (s.result === SIM.RES_ARRIVED) winTime += s.stats.time;
	}
	const wins = byResult[1];
	console.log(name.padEnd(8) + ' |' + pct(wins, SEEDS) + ' ' + pct(byResult['-1'], SEEDS)
		+ '  ' + pct(byResult['-2'], SEEDS) + '  ' + pct(byResult['-4'], SEEDS) + ' ' + pct(byResult['-3'], SEEDS)
		+ ' |     ' + (wins ? (winTime / wins).toFixed(1) : '  — ').padStart(5)
		+ '   ' + (wear / SEEDS).toFixed(1).padStart(6)
		+ '      ' + (exposure / SEEDS).toFixed(0).padStart(6));
}
