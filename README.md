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
