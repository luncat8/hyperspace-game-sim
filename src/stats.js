// headless trial runs and their aggregation - the measurement side of the project
(function (root) {
	'use strict';

	const HSG = root.HSG || (root.HSG = {});
	if (typeof module !== 'undefined' && module.exports) {
		Object.assign(HSG, require('./sim.js'), require('./autopilot.js'));
	}

	function runTrial(params, seed) {
		const sim = HSG.createSim(params);
		sim.reset(seed);
		const pilot = HSG.createAutopilot({ seed: seed ^ 0x5f3759df });
		const dt = params.dt || 1 / 60;
		const maxTime = params.maxTime || 90;
		let t = 0;
		while (t < maxTime && sim.ship.status === 'flying') {
			pilot.update(sim, dt);
			sim.step(dt, pilot.out.x, pilot.out.y);
			t += dt;
		}
		const entry = sim.gates[0];
		const exit = sim.gates[1];
		const straight = Math.hypot(exit.x - entry.x, exit.y - entry.y);
		const spawned = Math.max(1, sim.tracerStats.spawned);
		return {
			seed,
			success: sim.ship.status === 'captured',
			status: sim.ship.status,
			time: sim.metrics.time,
			hull: sim.ship.hull,
			energy: sim.metrics.energyUsed,
			psy: sim.ship.psy,
			pathLength: sim.metrics.pathLength,
			straight,
			detour: sim.metrics.pathLength / straight,
			deviation: sim.metrics.maxDeviation,
			reentries: sim.metrics.reentries,
			tracerRate: sim.tracerStats.arrived / spawned
		};
	}

	// does a natural path exist? run the medium alone and watch the tracers
	function probePath(params, seconds) {
		const sim = HSG.createSim(params);
		sim.reset(params.seed);
		sim.setProbe(true);
		const dt = 1 / 60;
		const steps = Math.round(seconds / dt);
		for (let i = 0; i < steps; i++) sim.step(dt, 0, 0);
		const spawned = Math.max(1, sim.tracerStats.spawned);
		return {
			rate: sim.tracerStats.arrived / spawned,
			arrived: sim.tracerStats.arrived,
			spawned: sim.tracerStats.spawned
		};
	}

	function mean(values) {
		if (!values.length) return 0;
		let s = 0;
		for (const v of values) s += v;
		return s / values.length;
	}

	function summarize(results) {
		const wins = results.filter(r => r.success);
		const times = wins.map(r => r.time);
		return {
			runs: results.length,
			successRate: results.length ? wins.length / results.length : 0,
			meanTime: mean(times),
			medianTime: times.length ? times.slice().sort((a, b) => a - b)[times.length >> 1] : 0,
			meanHull: mean(results.map(r => r.hull)),
			meanEnergy: mean(results.map(r => r.energy)),
			meanDetour: mean(results.map(r => r.detour)),
			meanDeviation: mean(results.map(r => r.deviation)),
			meanReentries: mean(results.map(r => r.reentries)),
			tracerRate: mean(results.map(r => r.tracerRate)),
			destroyed: results.filter(r => r.status === 'destroyed').length
		};
	}

	function runTrials(params, count, seedBase) {
		const results = [];
		for (let i = 0; i < count; i++) {
			results.push(runTrial(params, (seedBase || 1000) + i * 7919));
		}
		return { results, summary: summarize(results) };
	}

	HSG.runTrial = runTrial;
	HSG.runTrials = runTrials;
	HSG.summarize = summarize;
	HSG.probePath = probePath;

	if (typeof module !== 'undefined' && module.exports) {
		module.exports = { runTrial, runTrials, summarize, probePath };
	}
})(typeof globalThis !== 'undefined' ? globalThis : this);
