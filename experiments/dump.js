// debug dump of tracer behaviour (node)
'use strict';

const path = require('path');
const { createSim } = require(path.join(__dirname, '..', 'src', 'sim.js'));

const sim = createSim({
	worldW: 2200, worldH: 1300, seed: 20261017,
	modes: { noise: true, curl: true, guide: true, beacons: true, gas: false, tracers: true },
	tracerCount: 300
});
sim.reset(20261017);
const dt = 1 / 60;
for (let step = 0; step < 600; step++) sim.step(dt, 0, 0);

const t = sim.tracers;
let alive = 0;
let sumX = 0;
for (let i = 0; i < t.count; i++) {
	sumX += t.x[i];
	if (t.x[i] > 1200) alive++;
}
console.log('mean tracer x', (sumX / t.count).toFixed(0), 'tracers past x=1200:', alive);
console.log('tracerStats', sim.tracerStats);
const poly = sim.guide.poly;
console.log('guide start', poly[0].toFixed(0), poly[1].toFixed(0), 'end', poly[poly.length - 2].toFixed(0), poly[poly.length - 1].toFixed(0));
console.log('exit', sim.gates[1].x, sim.gates[1].y);
console.log('dist guide end to exit', Math.hypot(poly[poly.length - 2] - sim.gates[1].x, poly[poly.length - 1] - sim.gates[1].y).toFixed(1));
for (let i = 0; i < 6; i++) {
	console.log(` t${i} pos=${t.x[i].toFixed(0)},${t.y[i].toFixed(0)} v=${Math.hypot(t.vx[i], t.vy[i]).toFixed(0)} life=${t.life[i].toFixed(1)}`);
}
