// check the gas pressure stream: does it really route from the entry to the exit?
'use strict';

const path = require('path');
const { createSim } = require(path.join(__dirname, '..', 'src', 'sim.js'));

const sim = createSim({
	worldW: 2200, worldH: 1300, seed: 20261017,
	modes: { noise: true, curl: true, guide: true, beacons: true, gas: true, tracers: false }
});
sim.reset(20261017);
const flow = sim.flow;
const out = { x: 0, y: 0 };
console.log('stream velocity along the corridor (y=650):');
console.log('   x     vx     vy   |v|');
for (let x = 150; x <= 2100; x += 150) {
	flow.sampleStream(x, 650, out);
	console.log(String(x).padStart(5), out.x.toFixed(0).padStart(6), out.y.toFixed(0).padStart(6), Math.hypot(out.x, out.y).toFixed(0).padStart(5));
}
console.log('\nstream at the guide line:');
const poly = sim.guide.poly;
for (let i = 0; i < poly.length / 2; i += 12) {
	flow.sampleStream(poly[i * 2], poly[i * 2 + 1], out);
	console.log(`  ${poly[i * 2].toFixed(0)},${poly[i * 2 + 1].toFixed(0)}  v=(${out.x.toFixed(0)},${out.y.toFixed(0)}) |v|=${Math.hypot(out.x, out.y).toFixed(0)}`);
}
let maxSpeed = 0;
for (let i = 0; i < flow.velX.length; i++) maxSpeed = Math.max(maxSpeed, Math.hypot(flow.velX[i], flow.velY[i]));
console.log('\nmax |v| in the grid', maxSpeed.toFixed(0), ' mean target', sim.tune.flowSpeed);
