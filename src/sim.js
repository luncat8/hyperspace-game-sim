// world state: ship, gates, tracer particles, resource mechanics, metrics
(function (root) {
	'use strict';

	const HSG = root.HSG || (root.HSG = {});
	if (typeof module !== 'undefined' && module.exports) {
		Object.assign(HSG, require('./rng.js'), require('./noise.js'), require('./field.js'), require('./flow.js'));
	}

	// internal gains: they convert the raw field units into world units / s^2
	const NOISE_GAIN = 11000;  // mean |grad height| ~ 0.008 -> ~90 u/s^2
	const CURL_GAIN = 6500;    // mean |curl| ~ 0.012 -> ~80 u/s^2
	const GUIDE_GAIN = 1.6;    // force per unit of distance from the guide curve
	const RAMP_GAIN = 240;     // downhill pull of the channel floor towards the exit
	const TURB_BOOST = 2.2;    // extra turbulence outside the calm channel
	const AMB_VEL = 0.12;      // how much of the environment drags the gas along
	const STRAIN_REF = 190;    // turbulence that counts as normal for hull and mind

	const DEFAULT_TUNE = {
		turbulence: 1.0,      // multiplier of noise + curl strength
		guideStrength: 1.0,   // multiplier of the valley force
		rampStrength: 0.5,    // multiplier of the channel floor slope
		channelCalm: 0.8,    // turbulence multiplier inside the channel
		beaconStrength: 1.0,
		gatePull: 1.0,
		thrust: 85,
		drag: 0.62,
		gasCoupling: 1.35,
		flowSpeed: 150
	};

	function defaultGates(worldW, worldH) {
		return [
			{
				id: 'entry', type: 'entry',
				x: 200, y: worldH * 0.5, face: 0,
				radius: 34, coneAngle: 0.62, coneRange: 430,
				beacon: true, beaconPower: 300, tractor: false,
				well: true, wellSign: 1, wellAmp: 40000, wellSigma: 210
			},
			{
				id: 'exit', type: 'exit',
				x: worldW - 200, y: worldH * 0.5, face: Math.PI,
				radius: 38, coneAngle: 0.30, coneRange: 310,
				beacon: true, beaconPower: 430, tractor: true,
				well: true, wellSign: -1, wellAmp: 38000, wellSigma: 250
			}
		];
	}

	function createSim(cfg) {
		const worldW = cfg.worldW || 2200;
		const worldH = cfg.worldH || 1300;
		// hyperspace is a shortcut: x units inside are k*x units in the far universe
		const scale = cfg.scale || 7;
		const modes = Object.assign({
			noise: true, curl: true, guide: true, beacons: true, gas: false, tracers: true
		}, cfg.modes);
		const tune = Object.assign({}, DEFAULT_TUNE, cfg.tune);

		let seed = cfg.seed || 1337;
		let gates = (cfg.gates || defaultGates(worldW, worldH)).map(g => Object.assign({
			built: true, open: true, openProgress: 1
		}, g));

		let field = null;
		let flow = null;
		let rng = HSG.createRng(seed);

		const tracerCount = cfg.tracerCount || 2200;
		const tX = new Float32Array(tracerCount);
		const tY = new Float32Array(tracerCount);
		const tVX = new Float32Array(tracerCount);
		const tVY = new Float32Array(tracerCount);
		const tLife = new Float32Array(tracerCount);

		const ship = {
			x: 0, y: 0, vx: 0, vy: 0, heading: 0,
			hull: 100, hullMax: 100,
			energy: 100, energyMax: 100,
			psy: 0, psyMax: 100,
			status: 'flying'
		};
		const metrics = {
			time: 0, pathLength: 0, maxDeviation: 0, deviation: 0,
			reentries: 0, damage: 0, energyUsed: 0, credits: 900, captured: false
		};
		const tracerStats = { spawned: 0, arrived: 0 };

		const scratchA = { x: 0, y: 0 };
		const scratchB = { x: 0, y: 0 };
		const scratchC = { x: 0, y: 0 };

		// the channel is calm inside, brutal outside - without a guide there is no
		// channel, so the medium is uniformly rough
		const chanScratch = { chan: 0, turb: 1 };
		function channelTurb(dist) {
			if (!modes.guide) {
				chanScratch.chan = 0;
				chanScratch.turb = 1;
				return chanScratch;
			}
			const chan = field.channelFactor(dist);
			chanScratch.chan = chan;
			chanScratch.turb = tune.channelCalm * chan + (1 + TURB_BOOST) * (1 - chan);
			return chanScratch;
		}

		function buildGuide() {
			const entry = gates[0];
			const exit = gates[1];
			const c = Math.cos(entry.face);
			const s = Math.sin(entry.face);
			const ex = entry.x + c * entry.radius;
			const ey = entry.y + s * entry.radius;
			const xc = Math.cos(exit.face);
			const ys = Math.sin(exit.face);
			const gx = exit.x + xc * exit.radius;
			const gy = exit.y + ys * exit.radius;
			const dx = gx - ex;
			const dy = gy - ey;
			const len = Math.hypot(dx, dy) || 1;
			const px = -dy / len;
			const py = dx / len;
			const bend = rng.range(-0.11, 0.11) * len;
			return field.setGuide([
				{ x: ex, y: ey },
				{ x: ex + dx * 0.35 + px * bend, y: ey + dy * 0.35 + py * bend },
				{ x: ex + dx * 0.7 + px * bend * 0.45, y: ey + dy * 0.7 + py * bend * 0.45 },
				{ x: gx, y: gy }
			]);
		}

		// environmental acceleration for any body in the corridor
		function envForce(x, y, out) {
			let fx = 0;
			let fy = 0;
			const dist = modes.guide ? field.sampleDist(x, y) : 1e9;
			const ch = channelTurb(dist);
			const turb = ch.turb;
			if (modes.noise) {
				field.heightGrad(x, y, scratchC);
				fx -= scratchC.x * NOISE_GAIN * tune.turbulence * turb;
				fy -= scratchC.y * NOISE_GAIN * tune.turbulence * turb;
			}
			if (modes.curl) {
				field.curlAt(x, y, scratchC);
				fx += scratchC.x * CURL_GAIN * tune.turbulence * turb;
				fy += scratchC.y * CURL_GAIN * tune.turbulence * turb;
			}
			if (modes.guide) {
				// valley: the further from the curve, the harder the environment pushes back
				field.guideGrad(x, y, scratchC);
				const mag = GUIDE_GAIN * tune.guideStrength * (dist < 700 ? dist : 700);
				fx -= scratchC.x * mag;
				fy -= scratchC.y * mag;
				// channel floor slopes down towards the exit, bodies slide along the curve
				field.guideTangent(x, y, scratchC);
				fx += scratchC.x * RAMP_GAIN * tune.rampStrength * ch.chan;
				fy += scratchC.y * RAMP_GAIN * tune.rampStrength * ch.chan;
			}
			if (modes.beacons) {
				field.beaconForce(x, y, scratchC);
				fx += scratchC.x * tune.beaconStrength;
				fy += scratchC.y * tune.beaconStrength;
			}
			if (!modes.gas) {
				field.gateForce(x, y, scratchC);
				fx += scratchC.x * tune.gatePull;
				fy += scratchC.y * tune.gatePull;
			}
			out.x = fx;
			out.y = fy;
		}

		// how rough the medium is here, without the beacons and the channel floor
		function turbulenceIntensity(x, y) {
			const dist = modes.guide ? field.sampleDist(x, y) : 1e9;
			const turb = channelTurb(dist).turb;
			let mag = 0;
			if (modes.noise) {
				field.heightGrad(x, y, scratchC);
				mag += Math.hypot(scratchC.x, scratchC.y) * NOISE_GAIN;
			}
			if (modes.curl) {
				field.curlAt(x, y, scratchC);
				mag += Math.hypot(scratchC.x, scratchC.y) * CURL_GAIN;
			}
			return mag * turb * tune.turbulence / STRAIN_REF;
		}

		// debug helper: contribution of every environment layer at one point
		function envBreakdown(x, y) {
			const dist = modes.guide ? field.sampleDist(x, y) : 1e9;
			const ch = channelTurb(dist);
			const parts = { dist, chan: ch.chan, turb: ch.turb, noise: 0, curl: 0, valley: 0, ramp: 0, beacon: 0, well: 0 };
			if (modes.noise) {
				field.heightGrad(x, y, scratchC);
				parts.noise = -scratchC.x * NOISE_GAIN * tune.turbulence * ch.turb;
			}
			if (modes.curl) {
				field.curlAt(x, y, scratchC);
				parts.curl = scratchC.x * CURL_GAIN * tune.turbulence * ch.turb;
			}
			if (modes.guide) {
				field.guideGrad(x, y, scratchC);
				const mag = GUIDE_GAIN * tune.guideStrength * (dist < 700 ? dist : 700);
				parts.valley = -scratchC.x * mag;
				field.guideTangent(x, y, scratchC);
				parts.ramp = scratchC.x * RAMP_GAIN * tune.rampStrength * ch.chan;
			}
			if (modes.beacons) {
				field.beaconForce(x, y, scratchC);
				parts.beacon = scratchC.x * tune.beaconStrength;
			}
			if (!modes.gas) {
				field.gateForce(x, y, scratchC);
				parts.well = scratchC.x * tune.gatePull;
			}
			return parts;
		}

		// the gas feels the environment as a drift, the stream stays readable
		function fillAmbientGrid() {
			if (!flow) return;
			const gx = flow.gw;
			const gh = flow.gh;
			for (let y = 0; y < gh; y++) {
				for (let x = 0; x < gx; x++) {
					const wx = (x + 0.5) * flow.hx;
					const wy = (y + 0.5) * flow.hy;
					envForce(wx, wy, scratchC);
					flow.ambX[y * gx + x] = scratchC.x * AMB_VEL;
					flow.ambY[y * gx + x] = scratchC.y * AMB_VEL;
				}
			}
		}

		function respawnTracer(i) {
			const entry = gates[0];
			const c = Math.cos(entry.face);
			const s = Math.sin(entry.face);
			const a = rng.range(0, Math.PI * 2);
			const r = rng.range(0, entry.radius * 0.8);
			tX[i] = entry.x + c * entry.radius * 0.7 + Math.cos(a) * r;
			tY[i] = entry.y + s * entry.radius * 0.7 + Math.sin(a) * r;
			tVX[i] = c * 40 + rng.gauss() * 25;
			tVY[i] = s * 40 + rng.gauss() * 25;
			tLife[i] = 40;
			tracerStats.spawned++;
		}

		let portKey = '';
		let probeMode = false;

		function updatePorts() {
			if (!flow) return;
			const entry = gates[0];
			const exit = gates[1];
			const entryOn = entry.built && entry.open && entry.openProgress >= 1;
			const exitOn = exit.built && exit.open && exit.openProgress >= 1;
			const key = entryOn + ':' + exitOn;
			if (key === portKey) return;
			portKey = key;
			flow.setPorts(
				entryOn ? { x: entry.x + Math.cos(entry.face) * entry.radius, y: entry.y + Math.sin(entry.face) * entry.radius, r: 150, rate: 1 } : null,
				exitOn ? [{ x: exit.x + Math.cos(exit.face) * exit.radius, y: exit.y + Math.sin(exit.face) * exit.radius, r: 150, rate: 1 }] : []
			);
		}

		function stepTracers(dt) {
			const exit = gates[1];
			const er = exit.radius + 16;
			if (modes.gas) flow.clearDensity();
			for (let i = 0; i < tracerCount; i++) {
				let x = tX[i];
				let y = tY[i];
				let vx = tVX[i];
				let vy = tVY[i];
				if (modes.gas) {
					// the gas carries the tracer: drag towards the local flow velocity
					flow.sampleVelocity(x, y, scratchB);
					vx += (scratchB.x - vx) * tune.gasCoupling * dt;
					vy += (scratchB.y - vy) * tune.gasCoupling * dt;
				} else {
					envForce(x, y, scratchB);
					vx += scratchB.x * dt;
					vy += scratchB.y * dt;
					vx -= vx * 0.5 * dt;
					vy -= vy * 0.5 * dt;
				}
				x += vx * dt;
				y += vy * dt;
				tLife[i] -= dt;
				const ddx = x - exit.x;
				const ddy = y - exit.y;
				if (ddx * ddx + ddy * ddy < er * er) {
					tracerStats.arrived++;
					respawnTracer(i);
					continue;
				}
				if (tLife[i] <= 0 || x < 0 || y < 0 || x > worldW || y > worldH) {
					respawnTracer(i);
					continue;
				}
				tX[i] = x;
				tY[i] = y;
				tVX[i] = vx;
				tVY[i] = vy;
				if (modes.gas) flow.splat(x, y);
			}
		}

		function damage(amount) {
			if (amount <= 0) return;
			ship.hull -= amount;
			metrics.damage += amount;
			if (ship.hull <= 0) {
				ship.hull = 0;
				ship.status = 'destroyed';
			}
		}

		function gateEvents() {
			for (let i = 0; i < gates.length; i++) {
				const g = gates[i];
				const dx = ship.x - g.x;
				const dy = ship.y - g.y;
				const r = Math.hypot(dx, dy);
				const c = Math.cos(g.face);
				const s = Math.sin(g.face);
				const front = r > 1e-4 ? (dx * c + dy * s) / r : 0;
				if (g.type === 'exit') {
					if (r > g.radius + 26) continue;
					if (!g.built || !g.open || g.openProgress < 1) continue;
					const speed = Math.hypot(ship.vx, ship.vy);
					const aligned = front > 0.25 && Math.acos(Math.max(-1, Math.min(1, front))) < 0.62;
					if (aligned && speed < 280) {
						ship.energy = Math.max(0, ship.energy - 35);
						metrics.energyUsed += 35;
						ship.status = 'captured';
						metrics.captured = true;
						return;
					}
					// too fast or badly aligned: the gate deflects the ship
					const nx = r > 1e-4 ? dx / r : c;
					const ny = r > 1e-4 ? dy / r : s;
					const dot = ship.vx * nx + ship.vy * ny;
					if (dot < 0) {
						ship.vx -= 1.35 * dot * nx;
						ship.vy -= 1.35 * dot * ny;
					}
					ship.vx += nx * 4;
					ship.vy += ny * 4;
					ship.x = g.x + nx * (g.radius + 28);
					ship.y = g.y + ny * (g.radius + 28);
					damage(Math.max(0, speed - 220) * 0.09);
				} else {
					if (r > g.radius + 6) continue;
					if (!g.built || !g.open || g.openProgress < 1) continue;
					if (front < 0.1) continue;
					// re-entered hyperspace: pushed back to the launch point
					metrics.reentries++;
					damage(9);
					const px = g.x + c * (g.radius + 48);
					const py = g.y + s * (g.radius + 48);
					ship.x = px;
					ship.y = py;
					ship.vx = c * 110;
					ship.vy = s * 110;
					ship.energy = Math.max(0, ship.energy - 12);
				}
			}
		}

		function stepShip(dt, thrustX, thrustY) {
			envForce(ship.x, ship.y, scratchA);
			const thrustLen = Math.hypot(thrustX, thrustY);
			let ax = scratchA.x;
			let ay = scratchA.y;
			if (thrustLen > 0.0001 && ship.energy > 0) {
				const t = Math.min(1, thrustLen);
				ax += (thrustX / thrustLen) * tune.thrust * t;
				ay += (thrustY / thrustLen) * tune.thrust * t;
				const cost = 0.6 * (tune.thrust / 85) * t * dt;
				ship.energy -= cost;
				metrics.energyUsed += cost;
			}
			if (modes.gas) {
				flow.sampleStream(ship.x, ship.y, scratchB);
				ax += (scratchB.x - ship.vx) * tune.gasCoupling;
				ay += (scratchB.y - ship.vy) * tune.gasCoupling;
			} else {
				ax -= ship.vx * tune.drag;
				ay -= ship.vy * tune.drag;
			}
			// disorientation: the ship drifts on its own when the mind suffers
			if (ship.psy > 35) {
				const k = (ship.psy - 35) / 100;
				ax += rng.gauss() * 26 * k;
				ay += rng.gauss() * 26 * k;
			}
			ship.vx += ax * dt;
			ship.vy += ay * dt;
			const sp = Math.hypot(ship.vx, ship.vy);
			if (sp > 540) {
				ship.vx = (ship.vx / sp) * 540;
				ship.vy = (ship.vy / sp) * 540;
			}
			const px = ship.x;
			const py = ship.y;
			ship.x += ship.vx * dt;
			ship.y += ship.vy * dt;
			// containment field of the corridor
			let hit = 0;
			if (ship.x < 12) { ship.x = 12; hit = 1; }
			else if (ship.x > worldW - 12) { ship.x = worldW - 12; hit = 1; }
			if (ship.y < 12) { ship.y = 12; hit = 1; }
			else if (ship.y > worldH - 12) { ship.y = worldH - 12; hit = 1; }
			if (hit) {
				ship.vx *= -0.35;
				ship.vy *= -0.35;
				damage(sp * 0.02);
			}
			metrics.pathLength += Math.hypot(ship.x - px, ship.y - py);
		}

		function stepResources(dt) {
			ship.energy = Math.min(ship.energyMax, ship.energy + 2.5 * dt);
			let upkeep = 0;
			for (const g of gates) {
				if (!g.built || !g.open) continue;
				if (g.openProgress < 1) g.openProgress = Math.min(1, g.openProgress + dt / 2);
				upkeep += 0.8;
			}
			ship.energy -= upkeep * dt;
			metrics.credits -= upkeep * 0.35 * dt;
			if (ship.energy < 0) ship.energy = 0;

			// strain of hyperspace: rough fields wear the hull and the mind
			const turbIntensity = turbulenceIntensity(ship.x, ship.y);
			const strain = Math.max(0, turbIntensity - 0.8);
			damage(strain * 2.2 * dt);
			let psyRate = 1.0 + strain * 5;
			const entry = gates[0];
			const nearEntry = Math.hypot(ship.x - entry.x, ship.y - entry.y) < 220;
			if (nearEntry) psyRate = -6;
			ship.psy = Math.max(0, Math.min(ship.psyMax, ship.psy + psyRate * dt));
		}

		function step(dt, thrustX, thrustY) {
			if (probeMode) {
				// probe: only the medium and the tracer particles are simulated
				if (modes.gas) {
					updatePorts();
					flow.step(dt);
				}
				stepTracers(dt);
				return;
			}
			if (ship.status !== 'flying') return;
			metrics.time += dt;
			if (modes.gas) {
				updatePorts();
				flow.step(dt);
			}
			stepTracers(dt);
			stepShip(dt, thrustX, thrustY);
			gateEvents();
			stepResources(dt);
			if (modes.guide) {
				metrics.deviation = field.sampleDist(ship.x, ship.y);
				if (metrics.deviation > metrics.maxDeviation) metrics.maxDeviation = metrics.deviation;
			}
		}

		function reset(newSeed) {
			seed = newSeed === undefined ? seed : newSeed;
			rng = HSG.createRng(seed);
			field = HSG.createField({
				worldW, worldH, seed,
				noiseScale: 1 / 480, curlScale: 1 / 300,
				octaves: 3, curlOctaves: 2,
				guideCell: 10, channelWidth: 80,
				gates
			});
			buildGuide();
			flow = HSG.createFlow({
				worldW, worldH, gw: 48, gh: 30,
				flowSpeed: tune.flowSpeed
			});
			flow.setTargetSpeed(tune.flowSpeed);
			portKey = '';
			fillAmbientGrid();
			const entry = gates[0];
			ship.x = entry.x + Math.cos(entry.face) * (entry.radius + 48);
			ship.y = entry.y + Math.sin(entry.face) * (entry.radius + 48);
			ship.vx = Math.cos(entry.face) * 120;
			ship.vy = Math.sin(entry.face) * 120;
			ship.heading = entry.face;
			ship.hull = ship.hullMax;
			ship.energy = ship.energyMax;
			ship.psy = 0;
			ship.status = 'flying';
			metrics.time = 0;
			metrics.pathLength = 0;
			metrics.maxDeviation = 0;
			metrics.deviation = 0;
			metrics.reentries = 0;
			metrics.damage = 0;
			metrics.energyUsed = 0;
			metrics.credits = 900;
			metrics.captured = false;
			tracerStats.spawned = 0;
			tracerStats.arrived = 0;
			for (let i = 0; i < tracerCount; i++) respawnTracer(i);
			if (modes.gas) {
				updatePorts();
				flow.settle(2.5);
			}
		}

		function setModes(patch) {
			Object.assign(modes, patch);
		}

		function setTune(patch) {
			const oldFlow = tune.flowSpeed;
			Object.assign(tune, patch);
			if (flow && tune.flowSpeed !== oldFlow) flow.setTargetSpeed(tune.flowSpeed);
		}

		function gateById(id) {
			for (const g of gates) if (g.id === id) return g;
			return null;
		}

		function buildGate(id) {
			const g = gateById(id);
			if (!g || g.built) return false;
			if (metrics.credits < 350) return false;
			metrics.credits -= 350;
			g.built = true;
			return true;
		}

		function toggleGate(id) {
			const g = gateById(id);
			if (!g || !g.built) return false;
			if (g.open) {
				g.open = false;
				return true;
			}
			if (metrics.credits < 45) return false;
			metrics.credits -= 45;
			ship.energy = Math.max(0, ship.energy - 30);
			g.open = true;
			g.openProgress = 0;
			return true;
		}

		reset(seed);

		return {
			worldW, worldH, scale, modes, tune, ship, metrics, tracerStats, gates, field, flow,
			tracers: { x: tX, y: tY, vx: tVX, vy: tVY, life: tLife, count: tracerCount },
			get guide() { return field.guide; },
			reset, step, setModes, setTune, envForce, envBreakdown, turbulenceIntensity,
			setProbe(v) { probeMode = v; },
			buildGate, toggleGate, gateById,
			tracerCount
		};
	}

	HSG.createSim = createSim;
	HSG.DEFAULT_TUNE = DEFAULT_TUNE;

	if (typeof module !== 'undefined' && module.exports) {
		module.exports = { createSim, defaultGates, DEFAULT_TUNE };
	}
})(typeof globalThis !== 'undefined' ? globalThis : this);
