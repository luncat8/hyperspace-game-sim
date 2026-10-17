// control panel, hud and keyboard input
(function (root) {
	'use strict';

	const HSG = root.HSG || (root.HSG = {});

	const SLIDERS = [
		{ id: 'turbulence', label: 'turbulence', min: 0, max: 3, step: 0.05, fmt: v => v.toFixed(2) },
		{ id: 'channelCalm', label: 'channel calm', min: 0, max: 1.5, step: 0.05, fmt: v => v.toFixed(2) },
		{ id: 'rampStrength', label: 'channel slope', min: 0, max: 2, step: 0.05, fmt: v => v.toFixed(2) },
		{ id: 'guideStrength', label: 'valley force', min: 0, max: 3, step: 0.05, fmt: v => v.toFixed(2) },
		{ id: 'beaconStrength', label: 'beacon power', min: 0, max: 3, step: 0.05, fmt: v => v.toFixed(2) },
		{ id: 'gatePull', label: 'gate attraction', min: 0, max: 3, step: 0.05, fmt: v => v.toFixed(2) },
		{ id: 'thrust', label: 'engine', min: 0, max: 260, step: 5, fmt: v => v.toFixed(0) },
		{ id: 'flowSpeed', label: 'gas flow speed', min: 40, max: 320, step: 10, fmt: v => v.toFixed(0) }
	];

	const MODES = ['noise', 'curl', 'guide', 'beacons', 'gas', 'tracers'];

	function createUi(sim, renderer) {
		const $ = id => document.getElementById(id);
		const keys = new Set();
		const thrust = { x: 0, y: 0 };
		let thrustMag = 0;
		let turn = 0;
		let trialTimer = 0;

		for (const mode of MODES) {
			const box = $('m-' + mode);
			box.addEventListener('change', () => {
				sim.setModes({ [mode]: box.checked });
				renderer.markFieldDirty();
			});
		}

		const sliderHost = $('sliders');
		for (const s of SLIDERS) {
			const wrap = document.createElement('div');
			wrap.className = 'slider';
			wrap.innerHTML = `<div class="head"><span>${s.label}</span><b id="v-${s.id}"></b></div>`;
			const input = document.createElement('input');
			input.type = 'range';
			input.id = 'sl-' + s.id;
			input.min = s.min;
			input.max = s.max;
			input.step = s.step;
			input.value = sim.tune[s.id];
			input.addEventListener('input', () => {
				const v = parseFloat(input.value);
				sim.setTune({ [s.id]: v });
				$('v-' + s.id).textContent = s.fmt(v);
				renderer.markFieldDirty();
			});
			wrap.appendChild(input);
			sliderHost.appendChild(wrap);
			$('v-' + s.id).textContent = s.fmt(sim.tune[s.id]);
		}

		// gate cards
		const gateHost = $('gates');
		const gateCards = [];
		for (const g of sim.gates) {
			const card = document.createElement('div');
			card.className = 'gate';
			card.innerHTML = `<div class="t"><span>${g.id.toUpperCase()} GATE</span><span id="gs-${g.id}"></span></div>
				<div class="s" id="gd-${g.id}"></div>
				<div class="btnrow"><button id="gb-${g.id}">build</button><button id="go-${g.id}">close</button></div>`;
			gateHost.appendChild(card);
			gateCards.push(g);
			$('gb-' + g.id).addEventListener('click', () => {
				sim.buildGate(g.id);
				renderer.markFieldDirty();
			});
			$('go-' + g.id).addEventListener('click', () => {
				sim.toggleGate(g.id);
			});
		}

		$('b-reset').addEventListener('click', () => {
			sim.reset();
			restart();
		});
		$('b-seed').addEventListener('click', () => {
			sim.reset(Math.floor(Math.random() * 1e9));
			restart();
		});
		$('b-trials').addEventListener('click', runTrials);

		function restart() {
			renderer.resetTrail();
			renderer.markFieldDirty();
			$('status').style.display = 'none';
		}

		// keyboard
		window.addEventListener('keydown', e => {
			keys.add(e.key.toLowerCase());
			if ([' ', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(e.key.toLowerCase())) e.preventDefault();
		});
		window.addEventListener('keyup', e => keys.delete(e.key.toLowerCase()));
		window.addEventListener('blur', () => keys.clear());

		function updateInput(dt) {
			const up = keys.has('w') || keys.has('arrowup');
			const down = keys.has('s') || keys.has('arrowdown');
			const left = keys.has('a') || keys.has('arrowleft');
			const right = keys.has('d') || keys.has('arrowright');
			const brake = keys.has(' ');
			const boost = keys.has('shift');
			turn = ((right ? 1 : 0) - (left ? 1 : 0)) * 1.9;
			sim.ship.heading += turn * dt;
			// without steering input the hull follows its own velocity
			if (turn === 0) {
				const sp = Math.hypot(sim.ship.vx, sim.ship.vy);
				if (sp > 12) {
					const want = Math.atan2(sim.ship.vy, sim.ship.vx);
					let diff = want - sim.ship.heading;
					while (diff > Math.PI) diff -= Math.PI * 2;
					while (diff < -Math.PI) diff += Math.PI * 2;
					sim.ship.heading += diff * Math.min(1, 1.6 * dt);
				}
			}
			const dir = up ? 1 : down ? -0.6 : 0;
			const c = Math.cos(sim.ship.heading);
			const s = Math.sin(sim.ship.heading);
			let mag = dir * (boost ? 1 : 0.75);
			if (brake) {
				mag = 0;
				sim.ship.vx *= 1 - Math.min(1, 2.2 * dt);
				sim.ship.vy *= 1 - Math.min(1, 2.2 * dt);
			}
			thrust.x = c * mag;
			thrust.y = s * mag;
			thrustMag = Math.abs(mag);
		}

		function updateHud() {
			const s = sim.ship;
			$('g-hull').style.width = s.hull + '%';
			$('g-energy').style.width = s.energy + '%';
			$('g-psy').style.width = (s.psy / s.psyMax * 100) + '%';
			$('v-hull').textContent = s.hull.toFixed(0);
			$('v-energy').textContent = s.energy.toFixed(0);
			$('v-psy').textContent = s.psy.toFixed(0);
			const exit = sim.gates[1];
			const dist = Math.hypot(exit.x - s.x, exit.y - s.y);
			const dev = sim.metrics.deviation;
			const far = (sim.worldW - 400) * sim.scale;
			$('readout').textContent =
				`time ${sim.metrics.time.toFixed(1)}s   speed ${Math.hypot(s.vx, s.vy).toFixed(0)}\n` +
				`to exit ${dist.toFixed(0)}   off guide ${dev > 900 ? '---' : dev.toFixed(0)}\n` +
				`credits ${sim.metrics.credits.toFixed(0)}   tracers ${sim.tracerStats.arrived}/${sim.tracerStats.spawned}\n` +
				`jump ${(sim.worldW - 400)} u -> ${(far / 1000).toFixed(1)} km (x${sim.scale})`;
			const status = $('status');
			if (s.status !== 'flying') {
				status.style.display = 'block';
				status.textContent = s.status === 'captured' ? 'JUMP COMPLETE' : s.status === 'destroyed' ? 'HULL BREACH' : 'FLIGHT ENDED';
			}
			for (const g of gateCards) {
				$('gs-' + g.id).textContent = g.built ? (g.open ? 'OPEN' : 'CLOSED') : 'NOT BUILT';
				$('gd-' + g.id).textContent = g.built
					? `upkeep 3 cr/s + 0.8 energy/s${g.type === 'exit' ? ' - captures only under 280 speed' : ' - launch wave'}`
					: 'build cost 350 cr';
				$('gb-' + g.id).disabled = g.built;
				$('go-' + g.id).textContent = g.open ? 'close' : 'open (45 cr)';
			}
		}

		function runTrials() {
			const button = $('b-trials');
			const out = $('trial-out');
			button.disabled = true;
			out.innerHTML = '<p class="note">running...</p>';
			const params = {
				worldW: sim.worldW, worldH: sim.worldH,
				seed: 1000,
				modes: Object.assign({}, sim.modes),
				tune: Object.assign({}, sim.tune),
				tracerCount: 300,
				maxTime: 90
			};
			const count = 24;
			const results = [];
			let i = 0;
			const t0 = performance.now();
			function chunk() {
				const until = performance.now() + 20;
				while (i < count && performance.now() < until) {
					results.push(HSG.runTrial(params, 1000 + i * 7919));
					i++;
				}
				out.innerHTML = `<p class="note">running ${i}/${count}...</p>`;
				if (i < count) {
					trialTimer = requestAnimationFrame(chunk);
					return;
				}
				const summary = HSG.summarize(results);
				const probe = HSG.probePath(Object.assign({}, params, { tracerCount: 300 }), 40);
				out.innerHTML = table(summary, probe, count, performance.now() - t0);
				button.disabled = false;
			}
			chunk();
		}

		function table(summary, probe, count, ms) {
			const row = (k, v, sep) => `<tr class="${sep ? 'sep' : ''}"><td>${k}</td><td class="v">${v}</td></tr>`;
			return `<table>
				${row('flights', count)}
				${row('arrived', (summary.successRate * 100).toFixed(0) + '%')}
				${row('avg time', summary.meanTime.toFixed(1) + ' s')}
				${row('avg hull left', summary.meanHull.toFixed(0) + '%')}
				${row('avg detour', summary.meanDetour.toFixed(2) + ' x')}
				${row('worst off guide', summary.meanDeviation.toFixed(0) + ' u')}
				${row('re-entries', summary.meanReentries.toFixed(2))}
				${row('hull losses', summary.destroyed)}
				${row('natural path', (probe.rate * 100).toFixed(0) + '%', true)}
				${row('probe time', (ms / 1000).toFixed(1) + ' s')}
			</table>`;
		}

		return { updateInput, updateHud, getThrust: () => thrust, thrustMagnitude: () => thrustMag };
	}

	HSG.createUi = createUi;

	if (typeof module !== 'undefined' && module.exports) {
		module.exports = { createUi };
	}
})(typeof globalThis !== 'undefined' ? globalThis : this);
