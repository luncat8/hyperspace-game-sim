## hyperspace-game-sim design

in many games far travel goes through some special short path, called hyperspace. best explanation that there are at least 2 different scale universes are parallel and fly through one in x km lead to output point in x*k in another universe.

useful game features to make it interesting:

- build, open and/or operate need some hi-tech, costly doors, costly to open, costly to keep open

- need (special or big) energy and engine to travel inside such space

- be danger in some other way: wearing hull, mentality, etc.

In thin project we investigate difficulty by path-finding


implement modes (checkboxes):
- gates are beacons (narrow angle light rays cones). some forces push ship while fly on map.
- guide line or curve between gates. this is stable path (like valley on heightmap) more distance from line = more environment force apply to ship
- other (think about good game mechanics).



2d
generate simplex-like noise - gradient of this map push ship, like heightmap

apply curl - this is second force that pull ship along same potential (curl) level.


hyper gate enter and exit add source and sink (high and low on heightmap).

ensure particles launched from enter gate will reach to exit - so there is natural path defined by gradient of noise + slope to exit sink gate.
Alternate way - you can simulate it as pressure of gas  - this looks more robust because automatically ensure particle reach sink despite of heightmap just because pressure finally push it here

enter gate (source) spawn such particles - this is in game the beacons that lead space ship between gates.



## this repo

https://github.com/luncat8/hyperspace-game-sim.git


---

## implementation (0.1.0)

open `index.html` in a browser (file:// is enough, no build, no server). fly the
ship from the ENTRY gate to the EXIT gate with `W`/`S` (engines), `A`/`D` (turn),
`space` (brake). the panel switches the transport modes, tunes the medium, opens
and closes the gates and runs the measurement trials.

what the draft asked for and where it lives:

| draft | implementation |
| --- | --- |
| gradient of a simplex map pushes the ship | `src/field.js` height field, `src/sim.js` noise layer |
| curl pulls the ship along iso potential lines | curl of a second noise field, divergence free |
| gates are beacons, cones push the ship | entry launch wave, exit tractor cone, `src/field.js` beaconForce |
| guide curve, more distance = more force | distance field, valley force grows with the distance, the channel floor slopes to the exit |
| gates are source and sink (high and low) | entry is a hill, exit is a pit, plus the beacon cones |
| particles from the entry reach the exit | tracer particles released at the entry, the share that reaches the sink is the "natural path" metric |
| alternative: pressure of gas | `src/flow.js`, poisson pressure potential from a source/sink pair, the flow always routes to the drain |
| costly doors, costly to keep open | build 350 cr, open 45 cr + 30 energy, upkeep 3 cr/s + 0.8 energy/s |
| special energy and engine | reactor 2.5 energy/s, engines burn 0.6/s, the jump itself 35 energy |
| hull wear and mentality | turbulence wears the hull, the mind degrades the aim and the hud |

measurements (24 flights per configuration, reference pilot, seed base 4242):

| configuration | arrived | avg time | hull left | natural path |
| --- | --- | --- | --- | --- |
| analytic + guide | 79% | 9.6 s | 81 | 88% |
| analytic, no guide | 46% | 16.8 s | 84 | 5% |
| analytic, no beacons | 100% | 11.3 s | 98 | 83% |
| analytic, no noise | 96% | 9.9 s | 83 | 88% |
| analytic, no curl | 79% | 9.6 s | 85 | 88% |
| gas + guide | 75% | 8.5 s | 83 | 75% |
| gas, no guide | 79% | 11.5 s | 85 | 72% |

the headline: the guide curve is what turns the corridor into a route (88% of the
released tracers reach the sink, without it 5% - the heightmap traps them), while
the gas pressure transport guarantees a route by construction (72% without any
guide). the beacons are a tax on the pilot, the curl is the expensive layer.

docs: `archive/0.1.0-plan.md` (the design as built), `archive/0.1.0-worklog.md`
(what was done and how it was validated), `0.1.1-plan.md` (next step),
`findings-pitfalls-skills.md` (pitfalls), `experiments/` (measurement scripts,
logs in `experiments/logs/`).
