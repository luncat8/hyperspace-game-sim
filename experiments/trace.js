// trace one flight: where does the ship go and why does it fail?
// usage: node experiments/trace.js [gas] [seed]
'use strict';

const path = require('path');
const { createSim } = require(path.join(__dirname, '..', 'src', 'sim.js'));
const { createAutopilot } = require(path.join(__dirname, '..', 'src', 'autopilot.js'));

const gas = process.argv[2] === 'gas';
const seed = parseInt(process.argv[3] || '1000', 10);
const sim = createSim({
	worldW: 2200, worldH: 1300, seed,
	modes: { noise: true, curl: true, guide: true, beacons: true, gas, tracers: true },
	tracerCount: 200
});
sim.reset(seed);
const pilot = createAutopilot({});
const dt = 1 / 60;
const exit = sim.gates[1];
let t = 0;
let lastStatus = '';
console.log(`gas=${gas} seed=${seed} exit=(${exit.x},${exit.y})`);
while (t < 60 && sim.ship.status === 'flying') {
	pilot.update(sim, dt);
	sim.step(dt, pilot.out.x, pilot.out.y);
	t += dt;
	if (Math.round(t * 60) % 60 === 0) {
		const d = Math.hypot(sim.ship.x - exit.x, sim.ship.y - exit.y);
		console.log(
			`t=${t.toFixed(0).padStart(2)}`,
			`p=(${sim.ship.x.toFixed(0)},${sim.ship.y.toFixed(0)})`,
			`v=${Math.hypot(sim.ship.vx, sim.ship.vy).toFixed(0).padStart(3)}`,
			`dir=${(Math.atan2(sim.ship.vy, sim.ship.vx) * 180 / Math.PI).toFixed(0).padStart(4)}`,
			`dExit=${d.toFixed(0).padStart(4)}`,
			`dev=${sim.metrics.deviation.toFixed(0).padStart(3)}`,
			`hull=${sim.ship.hull.toFixed(0).padStart(3)}`,
			`psy=${sim.ship.psy.toFixed(0).padStart(3)}`
		);
	}
}
console.log('status', sim.ship.status, 'time', sim.metrics.time.toFixed(1),
	'reentries', sim.metrics.reentries, 'tracerRate', (sim.tracerStats.arrived / sim.tracerStats.spawned).toFixed(2));
void lastStatus;
