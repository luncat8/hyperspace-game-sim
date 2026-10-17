// quick probe: fly one corridor and print what happens (node, not loaded by the page)
'use strict';

const path = require('path');
const { createSim } = require(path.join(__dirname, '..', 'src', 'sim.js'));
const { createAutopilot } = require(path.join(__dirname, '..', 'src', 'autopilot.js'));

const modes = { noise: true, curl: true, guide: true, beacons: true, gas: false, tracers: true };
const sim = createSim({ worldW: 2200, worldH: 1300, seed: 20261017, modes, tracerCount: 800 });
sim.reset(20261017);
const pilot = createAutopilot({});
const dt = 1 / 60;
let t = 0;
console.log('entry', sim.gates[0].x, sim.gates[0].y, 'exit', sim.gates[1].x, sim.gates[1].y);
while (t < 40 && sim.ship.status === 'flying') {
	pilot.update(sim, dt);
	sim.step(dt, pilot.out.x, pilot.out.y);
	t += dt;
	if (Math.round(t * 60) % 120 === 0) {
		console.log(
			`t=${t.toFixed(1)} pos=${sim.ship.x.toFixed(0)},${sim.ship.y.toFixed(0)}`,
			`spd=${Math.hypot(sim.ship.vx, sim.ship.vy).toFixed(0)}`,
			`dev=${sim.metrics.deviation.toFixed(0)}`,
			`hull=${sim.ship.hull.toFixed(0)} psy=${sim.ship.psy.toFixed(0)}`,
			`tracers=${sim.tracerStats.arrived}/${sim.tracerStats.spawned}`
		);
	}
}
console.log('status', sim.ship.status, 'time', sim.metrics.time.toFixed(1),
	'hull', sim.ship.hull.toFixed(0), 'reentries', sim.metrics.reentries,
	'tracerRate', (sim.tracerStats.arrived / sim.tracerStats.spawned).toFixed(3));
