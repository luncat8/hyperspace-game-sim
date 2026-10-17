// render.js — canvas drawing: field, mode overlays, gates, ship, HUD
'use strict';

const FIELD_GRID = 64;		// world units between field preview streaks
const FIELD_STREAK = 34;	// streak length per unit force
const BEAM_LEN = 1500;

const view = { scale: 1, ox: 0, oy: 0, w: 0, h: 0 };
const renderF = { x: 0, y: 0 }; // field sample scratch

function viewFit(canvas) {
	view.w = canvas.width; view.h = canvas.height;
	view.scale = Math.min(view.w / WORLD_W, view.h / WORLD_H) * 0.97;
	view.ox = (view.w - WORLD_W * view.scale) / 2;
	view.oy = (view.h - WORLD_H * view.scale) / 2;
}

function vx(x) { return view.ox + x * view.scale; }
function vy(y) { return view.oy + y * view.scale; }

function drawFieldStreaks(ctx, state) {
	ctx.strokeStyle = '#7fb4ff';
	ctx.lineWidth = 1;
	const tt = state.t * TUNE.turbTimeScale;
	for (let gy = FIELD_GRID / 2; gy < WORLD_H; gy += FIELD_GRID) {
		for (let gx = FIELD_GRID / 2; gx < WORLD_W; gx += FIELD_GRID) {
			turbForce(gx, gy, tt, TUNE.turbFreq, renderF);
			const s = turbScaleAt(state, gx, gy);
			const fx = renderF.x * s, fy = renderF.y * s;
			const mag = Math.sqrt(fx * fx + fy * fy);
			ctx.globalAlpha = Math.min(0.55, 0.06 + mag * 0.35);
			ctx.beginPath();
			ctx.moveTo(vx(gx), vy(gy));
			ctx.lineTo(vx(gx + fx * FIELD_STREAK), vy(gy + fy * FIELD_STREAK));
			ctx.stroke();
		}
	}
	ctx.globalAlpha = 1;
}

function drawBeam(ctx, gx, gy, axis) {
	const a1 = axis - TUNE.coneHalfAngle, a2 = axis + TUNE.coneHalfAngle;
	ctx.beginPath();
	ctx.moveTo(vx(gx), vy(gy));
	ctx.lineTo(vx(gx + Math.cos(a1) * BEAM_LEN), vy(gy + Math.sin(a1) * BEAM_LEN));
	ctx.lineTo(vx(gx + Math.cos(a2) * BEAM_LEN), vy(gy + Math.sin(a2) * BEAM_LEN));
	ctx.closePath();
	ctx.fill();
}

function drawBeacons(ctx, state) {
	ctx.fillStyle = 'rgba(120, 230, 255, 0.10)';
	drawBeam(ctx, state.entry.x, state.entry.y, state.entryBeam);
	drawBeam(ctx, state.exit.x, state.exit.y, state.exitBeam);
}

function drawGuide(ctx, state) {
	ctx.lineCap = 'round';
	ctx.lineJoin = 'round';
	guidePath(ctx, state);
	ctx.strokeStyle = 'rgba(140, 255, 170, 0.07)';
	ctx.lineWidth = TUNE.guideFalloff * 2 * view.scale;
	ctx.stroke();
	guidePath(ctx, state);
	ctx.strokeStyle = 'rgba(140, 255, 170, 0.5)';
	ctx.lineWidth = 1.5;
	ctx.stroke();
}

function guidePath(ctx, state) {
	ctx.beginPath();
	ctx.moveTo(vx(state.guide[0]), vy(state.guide[1]));
	for (let i = 1; i < GUIDE_PTS; i++) ctx.lineTo(vx(state.guide[i * 2]), vy(state.guide[i * 2 + 1]));
}

function drawBuoys(ctx, state) {
	for (let i = 0; i < state.buoyCount; i++) {
		const x = vx(state.buoyX[i]), y = vy(state.buoyY[i]);
		ctx.fillStyle = 'rgba(255, 210, 110, 0.08)';
		ctx.beginPath();
		ctx.arc(x, y, TUNE.buoyRadius * view.scale, 0, 2 * Math.PI);
		ctx.fill();
		ctx.fillStyle = '#ffd26e';
		ctx.beginPath();
		ctx.arc(x, y, 3.5, 0, 2 * Math.PI);
		ctx.fill();
	}
}

function drawGate(ctx, x, y, color, label) {
	ctx.strokeStyle = color;
	ctx.lineWidth = 2.5;
	ctx.beginPath();
	ctx.arc(vx(x), vy(y), TUNE.gateRadius * view.scale, 0, 2 * Math.PI);
	ctx.stroke();
	ctx.lineWidth = 1;
	ctx.beginPath();
	ctx.arc(vx(x), vy(y), TUNE.gateRadius * 0.55 * view.scale, 0, 2 * Math.PI);
	ctx.stroke();
	ctx.fillStyle = color;
	ctx.font = '12px monospace';
	ctx.textAlign = 'center';
	ctx.fillText(label, vx(x), vy(y - TUNE.gateRadius - 12));
}

function drawShip(ctx, state, thrusting) {
	const sh = state.ship;
	const x = vx(sh.x), y = vy(sh.y);
	ctx.save();
	ctx.translate(x, y);
	ctx.rotate(sh.angle);
	if (thrusting) {
		ctx.fillStyle = '#ff9a3c';
		ctx.beginPath();
		ctx.moveTo(-9, 0); ctx.lineTo(-17, 3.5); ctx.lineTo(-17, -3.5);
		ctx.closePath();
		ctx.fill();
	}
	ctx.fillStyle = state.appliedTurb > TUNE.hullSafeAccel ? '#ff6e6e' : '#eaf2ff';
	ctx.beginPath();
	ctx.moveTo(12, 0); ctx.lineTo(-9, 7); ctx.lineTo(-5, 0); ctx.lineTo(-9, -7);
	ctx.closePath();
	ctx.fill();
	ctx.restore();
}

function drawBar(ctx, x, y, w, frac, color, label) {
	ctx.fillStyle = 'rgba(255,255,255,0.12)';
	ctx.fillRect(x, y, w, 10);
	ctx.fillStyle = color;
	ctx.fillRect(x, y, w * Math.max(0, Math.min(1, frac)), 10);
	ctx.font = '11px monospace';
	ctx.textAlign = 'left';
	ctx.fillStyle = '#cfd8ea';
	ctx.fillText(label, x + w + 8, y + 9);
}

const RESULT_TEXT = {
	1: 'ARRIVED — gate opened',
	'-1': 'HULL BREACH',
	'-2': 'ENERGY DEPLETED — adrift',
	'-3': 'LOST IN HYPERSPACE — time out',
	'-4': 'AT GATE — not enough energy to open it',
};

function drawHud(ctx, state) {
	const x = view.w - 290, y = 18;
	drawBar(ctx, x, y, 160, state.hull / TUNE.hullMax, '#6ee07a', 'hull ' + state.hull.toFixed(0));
	drawBar(ctx, x, y + 16, 160, state.energy / TUNE.energyMax, '#5db2ff', 'energy ' + state.energy.toFixed(0));
	drawBar(ctx, x, y + 32, 160, state.appliedTurb / TUNE.turbStrength, '#ff9a3c', 'turb ' + state.appliedTurb.toFixed(0));
	ctx.fillStyle = '#8fa0bd';
	ctx.fillText('t ' + state.stats.time.toFixed(1) + 's / ' + TUNE.timeLimit + 's   gate cost ' + TUNE.gateOpenCost, x, y + 58);
	ctx.fillText('hyper ' + state.stats.hyperDist.toFixed(0) + ' u  =  real ' + (state.stats.hyperDist * REAL_SCALE_K / 1e6).toFixed(2) + ' Mu', x, y + 72);
	if (state.modes.buoys)
		ctx.fillText('buoys ' + (TUNE.buoyMax - state.buoyCount) + '/' + TUNE.buoyMax + ' (Space, ' + TUNE.buoyCost + ' en)', x, y + 86);
	if (state.result === RES_RUNNING) return;
	ctx.fillStyle = 'rgba(8, 10, 18, 0.75)';
	ctx.fillRect(view.w / 2 - 230, view.h / 2 - 72, 460, 144);
	ctx.textAlign = 'center';
	ctx.fillStyle = state.result === RES_ARRIVED ? '#6ee07a' : '#ff6e6e';
	ctx.font = '20px monospace';
	ctx.fillText(RESULT_TEXT[state.result], view.w / 2, view.h / 2 - 36);
	ctx.fillStyle = '#cfd8ea';
	ctx.font = '13px monospace';
	ctx.fillText('time ' + state.stats.time.toFixed(1) + 's   hull wear ' + state.stats.wear.toFixed(1)
		+ '   energy used ' + state.stats.energyUsed.toFixed(1), view.w / 2, view.h / 2 - 4);
	ctx.fillText('turbulence exposure ' + state.stats.exposure.toFixed(0), view.w / 2, view.h / 2 + 18);
	ctx.fillText('R — new run', view.w / 2, view.h / 2 + 48);
}

function drawWorld(ctx, canvas, state, thrusting) {
	viewFit(canvas);
	ctx.fillStyle = '#070a12';
	ctx.fillRect(0, 0, view.w, view.h);
	ctx.strokeStyle = 'rgba(127, 180, 255, 0.25)';
	ctx.lineWidth = 1;
	ctx.strokeRect(vx(0), vy(0), WORLD_W * view.scale, WORLD_H * view.scale);
	if (state.modes.guide) drawGuide(ctx, state);
	if (state.modes.beacons) drawBeacons(ctx, state);
	drawFieldStreaks(ctx, state);
	if (state.modes.buoys) drawBuoys(ctx, state);
	drawGate(ctx, state.entry.x, state.entry.y, '#7fb4ff', 'IN');
	drawGate(ctx, state.exit.x, state.exit.y, '#6ee07a', 'OUT');
	drawShip(ctx, state, thrusting);
	drawHud(ctx, state);
}

if (typeof module !== 'undefined') module.exports = { drawWorld };
