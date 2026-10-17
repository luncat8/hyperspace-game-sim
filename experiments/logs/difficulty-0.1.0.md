# difficulty-0.1.0 — naive autopilot, 24 seeds, dt=1/60

tune: turbStrength=300 coneDamp=0.18 coneHalfAngle=0.105 guideFalloff=130 buoyRadius=125 buoyMax=6
autopilot: velocity-matching steer, vmax=220; guide lookahead +5 pts; buoy drop at appliedTurb>90 && turbScale>0.5

mode     | win  hull energy gate time | avg t(win) avg wear avg exposure
raw      | 21%  79%    0%    0%   0% |       9.5     95.3        2535
beacons  |100%   0%    0%    0%   0% |       8.4      2.2         379
guide    |100%   0%    0%    0%   0% |       8.6      0.1         175
buoys    | 54%  46%    0%    0%   0% |      10.2     79.6        2254
all      |100%   0%    0%    0%   0% |       8.7      0.3         219

finding: difficulty ordering raw > buoys > beacons ~ guide ~ all. buoys give partial protection
(resource-limited, reactive coverage); beacons leak some wear (coneDamp 0.18) while guide valley
is near-perfectly safe on-path. note: autopilot flies the straight entry-exit line, which is the
beacon axis — beacon numbers are optimistic vs a human who gets shoved out of the cone.
