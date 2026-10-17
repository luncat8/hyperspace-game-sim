// bootstrap: build the world, wire the loop
(function (root) {
	'use strict';

	const HSG = root.HSG;
	const FIXED = 1 / 60;

	function boot() {
		const sim = HSG.createSim({
			worldW: 2200,
			worldH: 1300,
			seed: 20261017,
			tracerCount: 2200
		});
		const canvas = document.getElementById('c');
		const renderer = HSG.createRenderer(canvas);
		const ui = HSG.createUi(sim, renderer);

		window.addEventListener('resize', () => renderer.resize());
		renderer.resize();

		let last = performance.now();
		let acc = 0;
		function frame(now) {
			const dt = Math.min(0.25, (now - last) / 1000);
			last = now;
			acc += dt;
			let steps = 0;
			while (acc >= FIXED && steps < 5) {
				ui.updateInput(FIXED);
				const thrust = ui.getThrust();
				sim.step(FIXED, thrust.x, thrust.y);
				acc -= FIXED;
				steps++;
			}
			if (steps === 5) acc = 0;
			renderer.draw(sim, ui.thrustMagnitude());
			ui.updateHud();
			requestAnimationFrame(frame);
		}
		requestAnimationFrame(frame);
	}

	if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
	else boot();
})(typeof globalThis !== 'undefined' ? globalThis : this);
