# pitfalls and skills found while building the hyperspace corridor sim

## debugging the field (the expensive part of every session)

- **measure the field before trusting it.** print mean and max of |grad h| and |curl|
  over the map, then set the gains from the target acceleration
  (`gain = wanted_accel / mean_derivative`). guessing gains blind costs hours.
- **finite differences of fbm have heavy tails.** the max gradient was 60x the mean,
  which produced 4000 u/s^2 spikes that flung bodies away. clamp the derivative, not
  the noise.
- **a distance field is continuous, an arc-length field is not.** the medial axis of
  the guide curve makes `along` jump, so its gradient explodes and traps bodies in the
  middle of the corridor. use the polyline tangent instead of the gradient of the
  arc length for anything that pushes along the curve.
- **sign of a potential flow:** with `laplace(phi) = -s` a source has a *high*
  potential, so the velocity is `-grad phi`. getting this backwards makes the gas
  stream run from the exit to the entry and it still looks plausible in a screenshot.
- **normalise a source field by the sum of absolute values, never by the net sum.**
  source and sink nearly cancel, so dividing by the net sum flips the whole field.
- **gauss-seidel needs ~n^2 iterations** for the long wavelength modes. 400 iterations
  on a 48x30 grid is not a solution, it is a local smoothing of the source field.
- **port state must be reset when the flow object is recreated.** a cached "ports
  unchanged" flag made every trial after the first run with a dead flow field, and the
  results looked plausible. the gas mode silently fell back to behaving like the
  analytic mode.
- **a velocity field is not an acceleration.** the first gas implementation added the
  flow velocity to the tracer velocity every step, so the tracers accelerated without
  bound instead of drifting with the current.

## measurement

- **separate the metric from the subject.** the "did a natural path exist" question was
  first measured on the tracer particles of a flight, which ends when the ship is
  captured - so the number depended on the ship's luck. run the medium alone
  (`probePath`) for the path metric and the ship trials for the pilot metric.
- **a reference pilot makes configurations comparable.** the same heuristic pilot
  flies every seed, so a difference in the success rate is a property of the
  configuration, not of luck. it is a *reference* pilot, not a player model.
- **watch the failure mode, not only the rate.** a success rate of 0% can mean "no
  route exists" or "the ship died on the way". the hull column separates them.
- **the capture rule is part of the difficulty.** the gas current accelerates into the
  sink, so a ship that arrives fast is deflected. the limit has to be above the
  current speed or the transport model looks broken.

## rendering

- **render frames to a png from node** (`@napi-rs/canvas` has prebuilt binaries,
  `canvas` needs a compiler) to check the visuals without a browser. a headless
  `jsdom` run with a stubbed 2d context catches the wiring errors.
- **an eulerian density field smears.** a semi lagrangian scalar spreads over the
  whole corridor within seconds, the visual becomes a blob at the source. drawing the
  cloud from the lagrangian particles keeps the stream sharp.
- **a log colour scale** is the only way to show a source that is 100x denser than the
  tail of the stream.
