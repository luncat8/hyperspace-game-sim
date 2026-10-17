/* simplex-like 2D noise (Gustavson), classic script */
function simplex2(x, y) {
  const F2 = 0.5 * (Math.sqrt(3) - 1);
  const G2 = (3 - Math.sqrt(3)) / 6;
  let s = (x + y) * F2;
  let i = Math.floor(x + s);
  let j = Math.floor(y + s);
  let t = (i + j) * G2;
  let X0 = i - t;
  let Y0 = j - t;
  let x0 = x - X0;
  let y0 = y - Y0;
  let i1, j1;
  if (x0 > y0) { i1 = 1; j1 = 0; } else { i1 = 0; j1 = 1; }
  let x1 = x0 - i1 + G2;
  let y1 = y0 - j1 + G2;
  let x2 = x0 - 1 + 2 * G2;
  let y2 = y0 - 1 + 2 * G2;
  let ii = i & 255;
  let jj = j & 255;
  // permutation
  const p = simplex2.perm;
  let gi0 = p[ii + p[jj]] % 12;
  let gi1 = p[ii + i1 + p[jj + j1]] % 12;
  let gi2 = p[ii + 1 + p[jj + 1]] % 12;
  let t0 = 0.5 - x0 * x0 - y0 * y0;
  let n0 = 0;
  if (t0 >= 0) { t0 *= t0; n0 = t0 * t0 * (simplex2.grad3[gi0 * 2] * x0 + simplex2.grad3[gi0 * 2 + 1] * y0); }
  let t1 = 0.5 - x1 * x1 - y1 * y1;
  let n1 = 0;
  if (t1 >= 0) { t1 *= t1; n1 = t1 * t1 * (simplex2.grad3[gi1 * 2] * x1 + simplex2.grad3[gi1 * 2 + 1] * y1); }
  let t2 = 0.5 - x2 * x2 - y2 * y2;
  let n2 = 0;
  if (t2 >= 0) { t2 *= t2; n2 = t2 * t2 * (simplex2.grad3[gi2 * 2] * x2 + simplex2.grad3[gi2 * 2 + 1] * y2); }
  return 70 * (n0 + n1 + n2);
}

// init permutation
(function () {
  const p = new Uint8Array(512);
  for (let i = 0; i < 256; i++) p[i] = i;
  // deterministic shuffle
  let seed = 1337;
  for (let i = 255; i > 0; i--) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    const r = seed % (i + 1);
    const t = p[i]; p[i] = p[r]; p[r] = t;
  }
  for (let i = 0; i < 256; i++) p[i + 256] = p[i];
  simplex2.perm = p;
  simplex2.grad3 = new Float32Array([
    1, 1, -1, 1, 1, -1, -1, -1,
    1, 0, -1, 0, 1, 0, -1, 0,
    0, 1, 0, -1, 0, 1, 0, -1
  ]);
})();

function fbm2(x, y, oct) {
  let v = 0, a = 0.5, f = 1, m = 0;
  for (let i = 0; i < oct; i++) {
    v += a * simplex2(x * f, y * f);
    m += a;
    a *= 0.5;
    f *= 2;
  }
  return v / m;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { simplex2, fbm2 };
}
