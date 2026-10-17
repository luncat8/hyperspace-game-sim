# findings, pitfalls, skills

- classic-script + node sharing pattern: in `sim.js` use
  `if (typeof module !== 'undefined') { var { fn } = require('./field.js'); }`.
  The hoisted `var` does not clobber the browser global that `field.js` already defined
  (global var redeclaration without running the initializer keeps the existing value).
- divergence-free turbulence (curl of scalar noise) is much better for gameplay than raw
  noise vectors: no sinks the ship gets stuck in, motion reads as "weather".
- balance tuning needs the headless experiment, not play-feel: at turbStrength 230 the modes
  were indistinguishable (0 wear everywhere); the autopilot table exposed it in seconds.
- per-cell canvas alpha: set `ctx.globalAlpha` instead of building `rgba(...)` strings in the
  frame loop — avoids ~400 string allocations per frame in the field preview.
- autopilot bias pitfall: a "fly straight to exit" bot sits exactly on the beacon axis, so it
  overrates beacon mode; note such coupling when reading experiment tables.
