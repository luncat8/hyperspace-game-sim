// smoke test: load index.html in a headless DOM and run a few frames
// usage: node experiments/smoke.js   (needs jsdom, dev only)
'use strict';

const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('/tmp/smoke/node_modules/jsdom');

const root = path.join(__dirname, '..');
const errors = [];

function mockContext() {
	const noop = () => {};
	const ctx = {
		canvas: null,
		fillStyle: '#000',
		strokeStyle: '#000',
		lineWidth: 1,
		font: '10px sans',
		textAlign: 'left',
		globalAlpha: 1,
		lineCap: 'butt',
		lineDashOffset: 0,
		imageSmoothingEnabled: true,
		createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }),
		putImageData: noop,
		getImageData: (x, y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }),
		drawImage: noop,
		createLinearGradient: () => ({ addColorStop: noop }),
		createRadialGradient: () => ({ addColorStop: noop }),
		measureText: () => ({ width: 10 }),
		fillText: noop, strokeText: noop, fillStrokeText: noop,
		beginPath: noop, closePath: noop, moveTo: noop, lineTo: noop, arc: noop,
		stroke: noop, fill: noop, save: noop, restore: noop, translate: noop,
		rotate: noop, scale: noop, setTransform: noop, transform: noop, resetTransform: noop,
		clearRect: noop, fillRect: noop, strokeRect: noop, rect: noop,
		setLineDash: noop, getLineDash: () => []
	};
	return ctx;
}

const virtualConsole = new VirtualConsole();
virtualConsole.on('jsdomError', e => errors.push('jsdomError: ' + e.message));
virtualConsole.on('error', (...a) => errors.push('console.error: ' + a.join(' ')));
virtualConsole.on('warn', (...a) => errors.push('console.warn: ' + a.join(' ')));

const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const dom = new JSDOM(html, {
	runScripts: 'dangerously',
	resources: 'usable',
	pretendToBeVisual: true,
	url: 'file://' + root + '/index.html',
	virtualConsole
});
const { window } = dom;

window.HTMLCanvasElement.prototype.getContext = function () {
	const ctx = mockContext();
	ctx.canvas = this;
	return ctx;
};
window.HTMLCanvasElement.prototype.getBoundingClientRect = function () {
	return { width: 1200, height: 800, top: 0, left: 0, right: 1200, bottom: 800, x: 0, y: 0 };
};

window.addEventListener('error', e => errors.push('window error: ' + (e.error ? e.error.stack : e.message)));

setTimeout(() => {
	const doc = window.document;
	const readout = doc.getElementById('readout');
	const status = doc.getElementById('status');
	const sliderCount = doc.querySelectorAll('#sliders input').length;
	const gateButtons = doc.querySelectorAll('#gates button').length;
	console.log('sliders rendered :', sliderCount);
	console.log('gate buttons     :', gateButtons);
	console.log('hud readout      :', JSON.stringify(readout.textContent));
	console.log('hull width       :', doc.getElementById('g-hull').style.width);

	// exercise the panel: flip a mode, move a slider, run trials
	doc.getElementById('m-gas').checked = true;
	doc.getElementById('m-gas').dispatchEvent(new window.Event('change'));
	const slider = doc.getElementById('sl-turbulence');
	slider.value = '2';
	slider.dispatchEvent(new window.Event('input'));
	doc.getElementById('b-trials').dispatchEvent(new window.Event('click'));

	setTimeout(() => {
		const out = doc.getElementById('trial-out');
		console.log('trial output     :', out.textContent.replace(/\s+/g, ' ').trim().slice(0, 220));
		console.log('errors           :', errors.length ? errors : 'none');
		process.exit(errors.length ? 1 : 0);
	}, 8000);
}, 1500);
