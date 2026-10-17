// parameter sweep: how hard is it to find the exit in each transport configuration?
// usage: node experiments/sweep.js [runs] [seed]
'use strict';

const fs = require('fs');
const path = require('path');
const { runTrials, probePath } = require(path.join(__dirname, '..', 'src', 'stats.js'));

const RUNS = parseInt(process.argv[2] || '16', 10);
const SEED = parseInt(process.argv[3] || '1000', 10);

const BASE_MODES = { noise: true, curl: true, guide: true, beacons: true, gas: false, tracers: true };

const CONFIGS = [
	{ name: 'analytic + guide', modes: { ...BASE_MODES } },
	{ name: 'analytic no guide', modes: { ...BASE_MODES, guide: false } },
	{ name: 'analytic no beacons', modes: { ...BASE_MODES, beacons: false } },
	{ name: 'analytic no noise', modes: { ...BASE_MODES, noise: false } },
	{ name: 'analytic no curl', modes: { ...BASE_MODES, curl: false } },
	{ name: 'gas + guide', modes: { ...BASE_MODES, gas: true } },
	{ name: 'gas no guide', modes: { ...BASE_MODES, gas: true, guide: false } }
];

const rows = [];
console.log(`runs per config: ${RUNS}, seed base ${SEED}\n`);
console.log('config               success  avgTime  avgHull  detour  maxDev  reentry  tracerHit');
for (const c of CONFIGS) {
	const params = {
		worldW: 2200, worldH: 1300,
		seed: SEED, modes: c.modes,
		tracerCount: 400,
		maxTime: 90
	};
	const t0 = Date.now();
	const { summary } = runTrials(params, RUNS, SEED);
	// the natural path is measured on the medium alone, independent of the ship
	const probe = probePath(Object.assign({}, params, { tracerCount: 300 }), 40);
	const ms = Date.now() - t0;
	console.log(
		c.name.padEnd(20),
		(summary.successRate * 100).toFixed(0).padStart(5) + '%',
		summary.meanTime.toFixed(1).padStart(8),
		summary.meanHull.toFixed(0).padStart(8),
		summary.meanDetour.toFixed(2).padStart(7),
		summary.meanDeviation.toFixed(0).padStart(7),
		summary.meanReentries.toFixed(2).padStart(8),
		(probe.rate * 100).toFixed(0).padStart(8) + '%',
		`(${ms}ms)`
	);
	rows.push({
		config: c.name,
		runs: RUNS,
		seed: SEED,
		successRate: +summary.successRate.toFixed(3),
		meanTime: +summary.meanTime.toFixed(2),
		meanHull: +summary.meanHull.toFixed(1),
		meanDetour: +summary.meanDetour.toFixed(3),
		meanDeviation: +summary.meanDeviation.toFixed(1),
		meanReentries: +summary.meanReentries.toFixed(2),
		tracerRate: +probe.rate.toFixed(3),
		destroyed: summary.destroyed
	});
}

const logDir = path.join(__dirname, 'logs');
if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
const logFile = path.join(logDir, 'sweep.csv');
const header = 'config,runs,seed,successRate,meanTime,meanHull,meanDetour,meanDeviation,meanReentries,tracerRate,destroyed';
const lines = rows.map(r => [r.config, r.runs, r.seed, r.successRate, r.meanTime, r.meanHull,
	r.meanDetour, r.meanDeviation, r.meanReentries, r.tracerRate, r.destroyed].join(','));
const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
fs.appendFileSync(logFile, `# ${stamp}\n${header}\n${lines.join('\n')}\n`);
console.log(`\nappended to ${path.relative(process.cwd(), logFile)}`);

// difficulty curve: how strong must the medium be before the trip fails
console.log('\ndifficulty curve (success rate vs turbulence strength):');
console.log('turb   analytic+guide  gas+guide   tracerHit(analytic)');
const curve = [];
for (const turb of [0.5, 1, 1.5, 2, 2.5, 3, 4]) {
	const tune = { turbulence: turb };
	const a = runTrials({ worldW: 2200, worldH: 1300, seed: SEED, modes: { ...BASE_MODES }, tune, tracerCount: 300, maxTime: 90 }, RUNS, SEED).summary;
	const b = runTrials({ worldW: 2200, worldH: 1300, seed: SEED, modes: { ...BASE_MODES, gas: true }, tune, tracerCount: 300, maxTime: 90 }, RUNS, SEED).summary;
	const pa = probePath({ worldW: 2200, worldH: 1300, seed: SEED, modes: { ...BASE_MODES }, tune, tracerCount: 300 }, 40);
	console.log(String(turb).padStart(4), (a.successRate * 100).toFixed(0).padStart(12) + '%', (b.successRate * 100).toFixed(0).padStart(9) + '%', (pa.rate * 100).toFixed(0).padStart(18) + '%');
	curve.push({ turbulence: turb, analytic: +a.successRate.toFixed(3), gas: +b.successRate.toFixed(3), tracerRate: +pa.rate.toFixed(3), meanTime: +a.meanTime.toFixed(2) });
}
const curveFile = path.join(logDir, 'difficulty-curve.csv');
fs.appendFileSync(curveFile, `# ${stamp}\nturbulence,analyticSuccess,gasSuccess,tracerRate,meanTime\n${curve.map(c => [c.turbulence, c.analytic, c.gas, c.tracerRate, c.meanTime].join(',')).join('\n')}\n`);
console.log(`appended to ${path.relative(process.cwd(), curveFile)}`);
