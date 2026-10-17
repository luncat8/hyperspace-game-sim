// canvas rendering: field heatmap, gas density, guide channel, gates, tracers, ship
(function (root) {
	'use strict';

	const HSG = root.HSG || (root.HSG = {});

	const HEAT_CELL = 10;      // world units per heatmap cell
	const TRAIL_MAX = 180;

	// dark blue -> teal -> violet ramp for the potential field
	function ramp(t, out) {
		const u = t < 0 ? 0 : t > 1 ? 1 : t;
		let r;
		let g;
		let b;
		if (u < 0.5) {
			const k = u * 2;
			r = 8 + k * 20;
			g = 16 + k * 90;
			b = 46 + k * 120;
		} else {
			const k = (u - 0.5) * 2;
			r = 28 + k * 150;
			g = 106 - k * 40;
			b = 166 + k * 60;
		}
		out[0] = r;
		out[1] = g;
		out[2] = b;
	}

	function createRenderer(canvas) {
		const ctx = canvas.getContext('2d', { alpha: false });
		const heat = document.createElement('canvas');
		const heatCtx = heat.getContext('2d');
		const gas = document.createElement('canvas');
		const gasCtx = gas.getContext('2d');
		const color = new Uint8Array(3);

		let dpr = 1;
		let cssW = 0;
		let cssH = 0;
		let heatW = 0;
		let heatH = 0;
		let heatDirty = true;
		let gasW = 0;
		let gasH = 0;
		const trailX = new Float32Array(TRAIL_MAX);
		const trailY = new Float32Array(TRAIL_MAX);
		let trailHead = 0;
		let trailFill = 0;
		let time = 0;

		function resize() {
			const rect = canvas.getBoundingClientRect();
			dpr = Math.min(2, window.devicePixelRatio || 1);
			cssW = Math.max(320, Math.floor(rect.width));
			cssH = Math.max(240, Math.floor(rect.height));
			canvas.width = Math.floor(cssW * dpr);
			canvas.height = Math.floor(cssH * dpr);
		}

		function buildHeat(sim) {
			heatW = Math.ceil(sim.worldW / HEAT_CELL);
			heatH = Math.ceil(sim.worldH / HEAT_CELL);
			heat.width = heatW;
			heat.height = heatH;
			const img = heatCtx.createImageData(heatW, heatH);
			const data = img.data;
			const field = sim.field;
			for (let j = 0; j < heatH; j++) {
				const y = (j + 0.5) * HEAT_CELL;
				for (let i = 0; i < heatW; i++) {
					const x = (i + 0.5) * HEAT_CELL;
					const h = field.height(x, y);
					ramp(h * 0.5 + 0.5, color);
					const o = (j * heatW + i) * 4;
					data[o] = color[0];
					data[o + 1] = color[1];
					data[o + 2] = color[2];
					data[o + 3] = 255;
				}
			}
			heatCtx.putImageData(img, 0, 0);
			heatDirty = false;
		}

		function buildGas(sim) {
			const flow = sim.flow;
			gasW = flow.gw;
			gasH = flow.gh;
			gas.width = gasW;
			gas.height = gasH;
			const img = gasCtx.createImageData(gasW, gasH);
			const data = img.data;
			for (let j = 0; j < gasH; j++) {
				for (let i = 0; i < gasW; i++) {
					const d = flow.dens[j * gasW + i];
					// log scale: the source is orders of magnitude denser than the tail
					const u = Math.min(1, Math.log(1 + d * 1.6) / Math.log(3.6));
					const o = (j * gasW + i) * 4;
					data[o] = 10 + u * 120;
					data[o + 1] = 20 + u * 200;
					data[o + 2] = 40 + u * 190;
					data[o + 3] = 255;
				}
			}
			gasCtx.putImageData(img, 0, 0);
		}

		function worldTransform(sim) {
			const scale = Math.min(cssW / sim.worldW, cssH / sim.worldH);
			return {
				scale,
				ox: (cssW - sim.worldW * scale) * 0.5,
				oy: (cssH - sim.worldH * scale) * 0.5
			};
		}

		function drawGate(g, t, isEntry) {
			const c = Math.cos(g.face);
			const s = Math.sin(g.face);
			ctx.save();
			ctx.translate(g.x, g.y);
			ctx.rotate(g.face);
			// beacon cone
			const range = g.coneRange;
			const half = g.coneAngle;
			const grad = ctx.createLinearGradient(0, 0, range, 0);
			const pulse = 0.5 + 0.5 * Math.sin(t * 2.2 + (isEntry ? 0 : 1.7));
			if (g.tractor) {
				grad.addColorStop(0, `rgba(120,255,230,${0.30 + pulse * 0.12})`);
				grad.addColorStop(1, 'rgba(120,255,230,0)');
			} else {
				grad.addColorStop(0, `rgba(255,170,90,${0.26 + pulse * 0.12})`);
				grad.addColorStop(1, 'rgba(255,170,90,0)');
			}
			ctx.fillStyle = grad;
			ctx.beginPath();
			ctx.moveTo(0, 0);
			ctx.lineTo(range * Math.cos(-half), range * Math.sin(-half));
			ctx.lineTo(range * Math.cos(half), range * Math.sin(half));
			ctx.closePath();
			ctx.fill();
			// rays
			ctx.strokeStyle = g.tractor ? 'rgba(140,255,235,0.35)' : 'rgba(255,190,120,0.30)';
			ctx.lineWidth = 1.2;
			for (let i = 0; i <= 6; i++) {
				const a = -half + (2 * half * i) / 6;
				const flick = 0.75 + 0.25 * Math.sin(t * 6 + i * 1.7);
				ctx.beginPath();
				ctx.moveTo(0, 0);
				ctx.lineTo(range * flick * Math.cos(a), range * flick * Math.sin(a));
				ctx.stroke();
			}
			// frame
			ctx.strokeStyle = g.tractor ? '#7ff5d8' : '#ffb765';
			ctx.lineWidth = 3;
			ctx.beginPath();
			ctx.arc(0, 0, g.radius, -1.15, 1.15);
			ctx.stroke();
			ctx.strokeStyle = 'rgba(255,255,255,0.35)';
			ctx.lineWidth = 1;
			ctx.beginPath();
			ctx.arc(0, 0, g.radius * 0.45, 0, Math.PI * 2);
			ctx.stroke();
			ctx.restore();
			// label
			ctx.fillStyle = g.tractor ? '#9dfbe4' : '#ffd0a0';
			ctx.font = '600 13px ui-monospace, monospace';
			ctx.textAlign = 'center';
			ctx.fillText(isEntry ? 'ENTRY GATE' : 'EXIT GATE', g.x, g.y - g.radius - 12);
		}

		function drawGuide(sim) {
			const guide = sim.guide;
			if (!guide) return;
			const poly = guide.poly;
			const band = sim.field.channelWidth * 1.5;
			ctx.lineCap = 'round';
			ctx.strokeStyle = 'rgba(120,220,255,0.055)';
			ctx.lineWidth = band;
			ctx.beginPath();
			ctx.moveTo(poly[0], poly[1]);
			for (let i = 1; i < poly.length / 2; i++) ctx.lineTo(poly[i * 2], poly[i * 2 + 1]);
			ctx.stroke();
			ctx.strokeStyle = 'rgba(150,235,255,0.55)';
			ctx.lineWidth = 1.6;
			ctx.setLineDash([12, 9]);
			ctx.lineDashOffset = -time * 26;
			ctx.beginPath();
			ctx.moveTo(poly[0], poly[1]);
			for (let i = 1; i < poly.length / 2; i++) ctx.lineTo(poly[i * 2], poly[i * 2 + 1]);
			ctx.stroke();
			ctx.setLineDash([]);
		}

		function drawTracers(sim) {
			const t = sim.tracers;
			if (!t.count) return;
			ctx.lineWidth = 1.6;
			for (let bucket = 0; bucket < 3; bucket++) {
				ctx.beginPath();
				let any = false;
				for (let i = 0; i < t.count; i++) {
					const sp = Math.hypot(t.vx[i], t.vy[i]);
					const b = sp > 220 ? 0 : sp > 110 ? 1 : 2;
					if (b !== bucket) continue;
					const x = t.x[i];
					const y = t.y[i];
					ctx.moveTo(x, y);
					ctx.lineTo(x + 0.01, y);
					any = true;
				}
				if (!any) continue;
				ctx.strokeStyle = bucket === 0 ? 'rgba(255,240,200,0.85)' : bucket === 1 ? 'rgba(160,235,255,0.6)' : 'rgba(120,170,230,0.4)';
				ctx.stroke();
			}
		}

		function drawShip(sim, thrust) {
			const s = sim.ship;
			trailX[trailHead] = s.x;
			trailY[trailHead] = s.y;
			trailHead = (trailHead + 1) % TRAIL_MAX;
			if (trailFill < TRAIL_MAX) trailFill++;
			ctx.strokeStyle = 'rgba(120,230,255,0.45)';
			ctx.lineWidth = 1.4;
			ctx.beginPath();
			for (let i = 0; i < trailFill; i++) {
				const idx = (trailHead - 1 - i + TRAIL_MAX * 2) % TRAIL_MAX;
				if (i === 0) ctx.moveTo(trailX[idx], trailY[idx]);
				else ctx.lineTo(trailX[idx], trailY[idx]);
			}
			ctx.stroke();
			ctx.save();
			ctx.translate(s.x, s.y);
			ctx.rotate(s.heading);
			// engine flame
			if (thrust > 0.05) {
				const len = 10 + thrust * 22;
				const grad = ctx.createLinearGradient(-12, 0, -12 - len, 0);
				grad.addColorStop(0, 'rgba(255,240,180,0.95)');
				grad.addColorStop(1, 'rgba(255,120,40,0)');
				ctx.fillStyle = grad;
				ctx.beginPath();
				ctx.moveTo(-12, -5);
				ctx.lineTo(-12 - len, 0);
				ctx.lineTo(-12, 5);
				ctx.closePath();
				ctx.fill();
			}
			ctx.fillStyle = '#eafcff';
			ctx.strokeStyle = '#4de3ff';
			ctx.lineWidth = 1.5;
			ctx.beginPath();
			ctx.moveTo(16, 0);
			ctx.lineTo(-11, 8);
			ctx.lineTo(-6, 0);
			ctx.lineTo(-11, -8);
			ctx.closePath();
			ctx.fill();
			ctx.stroke();
			ctx.restore();
		}

		function draw(sim, thrust) {
			time += 1 / 60;
			if (heatDirty) buildHeat(sim);
			if (sim.modes.gas) buildGas(sim);
			const v = worldTransform(sim);
			ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
			ctx.fillStyle = '#04060c';
			ctx.fillRect(0, 0, cssW, cssH);
			ctx.setTransform(dpr * v.scale, 0, 0, dpr * v.scale, dpr * v.ox, dpr * v.oy);
			// background field
			ctx.imageSmoothingEnabled = true;
			ctx.globalAlpha = sim.modes.gas ? 0.3 : 0.5;
			ctx.drawImage(heat, 0, 0, sim.worldW, sim.worldH);
			if (sim.modes.gas) {
				ctx.globalAlpha = 0.8;
				ctx.drawImage(gas, 0, 0, sim.worldW, sim.worldH);
			}
			ctx.globalAlpha = 1;
			// frame
			ctx.strokeStyle = 'rgba(120,200,255,0.22)';
			ctx.lineWidth = 2;
			ctx.strokeRect(0, 0, sim.worldW, sim.worldH);
			if (sim.modes.guide) drawGuide(sim);
			if (sim.modes.tracers) drawTracers(sim);
			for (const g of sim.gates) drawGate(g, time, g.type === 'entry');
			drawShip(sim, thrust);
			// strain vignette
			const psy = sim.ship.psy / sim.ship.psyMax;
			if (psy > 0.35) {
				ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
				const a = (psy - 0.35) * 0.5;
				const grad = ctx.createRadialGradient(cssW / 2, cssH / 2, Math.min(cssW, cssH) * 0.25,
					cssW / 2, cssH / 2, Math.max(cssW, cssH) * 0.62);
				grad.addColorStop(0, 'rgba(255,0,40,0)');
				grad.addColorStop(1, `rgba(255,20,50,${a})`);
				ctx.fillStyle = grad;
				ctx.fillRect(0, 0, cssW, cssH);
			}
		}

		return {
			resize,
			draw,
			markFieldDirty() { heatDirty = true; },
			resetTrail() { trailHead = 0; trailFill = 0; }
		};
	}

	HSG.createRenderer = createRenderer;

	if (typeof module !== 'undefined' && module.exports) {
		module.exports = { createRenderer };
	}
})(typeof globalThis !== 'undefined' ? globalThis : this);
