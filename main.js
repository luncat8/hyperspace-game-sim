// main.js — DOM wiring, input, frame loop
'use strict';

const $ = id => document.getElementById(id);

const canvas = $('c');
const ctx = canvas.getContext('2d');

const MODES = { beacons: true, guide: false, buoys: false };
const input = { turn: 0, thrust: 0, retro: 0, drop: false };
const keys = Object.create(null);

let state = null;

function resize() {
	canvas.width = window.innerWidth * devicePixelRatio;
	canvas.height = window.innerHeight * devicePixelRatio;
	canvas.style.width = window.innerWidth + 'px';
	canvas.style.height = window.innerHeight + 'px';
}

function restart() {
	const seed = ($('seed').valueAsNumber || 1) >>> 0;
	state = makeState(seed, MODES);
}

function readUi() {
	MODES.beacons = $('modeBeacons').checked;
	MODES.guide = $('modeGuide').checked;
	MODES.buoys = $('modeBuoys').checked;
	TUNE.turbStrength = $('turb').valueAsNumber;
	TUNE.coneHalfAngle = $('cone').valueAsNumber * Math.PI / 360; // slider is full cone in degrees
	TUNE.guideFalloff = $('falloff').valueAsNumber;
}

function readKeys() {
	input.turn = (keys.ArrowRight || keys.KeyD ? 1 : 0) - (keys.ArrowLeft || keys.KeyA ? 1 : 0);
	input.thrust = keys.ArrowUp || keys.KeyW ? 1 : 0;
	input.retro = keys.ArrowDown || keys.KeyS ? 1 : 0;
}

function onKey(e, down) {
	if (e.repeat) return;
	keys[e.code] = down;
	if (!down) return;
	if (e.code === 'Space') { input.drop = true; e.preventDefault(); }
	if (e.code === 'KeyR') { $('seed').value = ((Math.random() * 1e6) | 0) + 1; restart(); }
}

let last = performance.now();

function frame(now) {
	let dt = (now - last) / 1000;
	last = now;
	if (dt > 0.05) dt = 0.05;
	readKeys();
	simStep(state, input, dt);
	drawWorld(ctx, canvas, state, input.thrust && state.energy > 0 && state.result === RES_RUNNING);
	requestAnimationFrame(frame);
}

window.addEventListener('resize', resize);
window.addEventListener('keydown', e => onKey(e, true));
window.addEventListener('keyup', e => onKey(e, false));
['modeBeacons', 'modeGuide', 'modeBuoys', 'turb', 'cone', 'falloff'].forEach(id => $(id).addEventListener('input', readUi));
$('restart').addEventListener('click', restart);
$('seed').addEventListener('change', restart);

resize();
readUi();
restart();
requestAnimationFrame(frame);
