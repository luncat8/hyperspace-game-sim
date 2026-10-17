// debug: force components along the corridor (node)
'use strict';

const path = require('path');
const { createSim } = require(path.join(__dirname, '..', 'src', 'sim.js'));

const sim = createSim({
	worldW: 2200, worldH: 1300, seed: 20261017,
	modes: { noise: true, curl: true, guide: true, beacons: true, gas: false, tracers: false }
});
sim.reset(20261017);
const f = sim.field;
const out = { x: 0, y: 0 };
const grad = { x: 0, y: 0 };

let sumGrad = 0;
let sumCurl = 0;
let n = 0;
let maxGrad = 0;
for (let x = 40; x < 1560; x += 20) {
	for (let y = 40; y < 960; y += 20) {
		f.heightGrad(x, y, grad);
		const g = Math.hypot(grad.x, grad.y);
		sumGrad += g;
		if (g > maxGrad) maxGrad = g;
		f.curlAt(x, y, grad);
		sumCurl += Math.hypot(grad.x, grad.y);
		n++;
	}
}
console.log('mean |grad h|', (sumGrad / n).toFixed(4), 'max', maxGrad.toFixed(4));
console.log('mean |curl|  ', (sumCurl / n).toFixed(4));
console.log('=> NOISE_GAIN for 90 u/s^2:', (90 / (sumGrad / n)).toFixed(0));
console.log('=> CURL_GAIN  for 80 u/s^2:', (80 / (sumCurl / n)).toFixed(0));

const poly = sim.guide.poly;
console.log('guide points (every 8th):');
for (let i = 0; i < poly.length / 2; i += 8) {
	console.log(`  ${poly[i * 2].toFixed(0)},${poly[i * 2 + 1].toFixed(0)}`);
}
console.log('pos            dist  along  tangent        envForce');
for (let x = 200; x <= 1400; x += 150) {
	const d = f.sampleDist(x, 500);
	const a = f.sampleAlong(x, 500);
	f.guideTangent(x, 500, grad);
	sim.envForce(x, 500, out);
	console.log(`  ${x},500  d=${d.toFixed(0).padStart(4)}  a=${a.toFixed(0).padStart(5)}  t=(${grad.x.toFixed(2)},${grad.y.toFixed(2)})  F=(${out.x.toFixed(0)},${out.y.toFixed(0)})`);
}
