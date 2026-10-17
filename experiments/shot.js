// render a frame of the corridor to a png so the visuals can be checked offline
// usage: node experiments/shot.js [out.png] [gas] [seconds]
// needs a canvas implementation (dev only, e.g. @napi-rs/canvas)
'use strict';

const fs = require('fs');
const path = require('path');
const { createCanvas } = require('/tmp/smoke/node_modules/@napi-rs/canvas');

const W = 1280;
const H = 760;

global.window = { devicePixelRatio: 1 };
global.document = {
	createElement(tag) {
		if (tag !== 'canvas') throw new Error('unsupported ' + tag);
		return createCanvas(W, H);
	}
};

const { createSim } = require(path.join(__dirname, '..', 'src', 'sim.js'));
const { createAutopilot } = require(path.join(__dirname, '..', 'src', 'autopilot.js'));
const { createRenderer } = require(path.join(__dirname, '..', 'src', 'render.js'));

const out = process.argv[2] || path.join(__dirname, 'logs', 'shot.png');
const gas = process.argv[3] === 'gas';
const seconds = parseFloat(process.argv[4] || '6');

const sim = createSim({
	worldW: 2200, worldH: 1300, seed: 20261017,
	modes: { noise: true, curl: true, guide: true, beacons: true, gas, tracers: true },
	tracerCount: 2200
});
sim.reset(20261017);
const pilot = createAutopilot({});
const dt = 1 / 60;
for (let i = 0; i < seconds * 60; i++) {
	pilot.update(sim, dt);
	sim.step(dt, pilot.out.x, pilot.out.y);
}

const canvas = createCanvas(W, H);
canvas.getBoundingClientRect = () => ({ width: W, height: H, top: 0, left: 0, right: W, bottom: H, x: 0, y: 0 });
const renderer = createRenderer(canvas);
renderer.resize();
renderer.draw(sim, 0.6);
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, canvas.toBuffer('image/png'));
console.log('wrote', out, 'ship', sim.ship.x.toFixed(0), sim.ship.y.toFixed(0), 'status', sim.ship.status);
