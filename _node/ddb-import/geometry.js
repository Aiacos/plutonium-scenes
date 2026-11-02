/**
 * Wall-based registration of a DDB scene onto a Plutonium scene.
 *
 * Both datasets wall the same printed map, but on differently-sized images with
 * different padding/offsets. Their walls act as shared control points: we fit a
 * similarity transform without rotation (`P = s * D + t`) so lights, walls and
 * tokens authored for the DDB image can be dropped onto the 5etools image.
 */

/** Points sampled along every wall, so curves split into different segments still overlap. */
export const densify = (walls, step, cap = 6000) => {
	const total = walls.reduce((a, w) => a + Math.hypot(w.c[2] - w.c[0], w.c[3] - w.c[1]), 0);
	step = Math.max(step, total / cap);
	const pts = [];
	for (const {c: [x0, y0, x1, y1]} of walls) {
		const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / step));
		for (let i = 0; i <= n; i++) pts.push([x0 + (x1 - x0) * i / n, y0 + (y1 - y0) * i / n]);
	}
	return pts;
};

export const endpoints = walls => {
	const seen = new Set();
	const pts = [];
	for (const {c} of walls) {
		for (const [x, y] of [[c[0], c[1]], [c[2], c[3]]]) {
			const k = `${Math.round(x)}_${Math.round(y)}`;
			if (seen.has(k)) continue;
			seen.add(k);
			pts.push([x, y]);
		}
	}
	return pts;
};

export const bbox = pts => pts.reduce(
	(b, [x, y]) => [Math.min(b[0], x), Math.min(b[1], y), Math.max(b[2], x), Math.max(b[3], y)],
	[Infinity, Infinity, -Infinity, -Infinity],
);

/** Uniform-grid spatial hash; nearest-neighbour queries only look at the 3x3 surrounding cells. */
class SpatialHash {
	constructor (pts, cell) {
		this._cell = cell;
		this._map = new Map();
		for (const p of pts) {
			const k = this._key(p[0], p[1]);
			if (!this._map.has(k)) this._map.set(k, []);
			this._map.get(k).push(p);
		}
	}

	_key (x, y) { return `${Math.floor(x / this._cell)}_${Math.floor(y / this._cell)}`; }

	nearest (x, y) {
		const cx = Math.floor(x / this._cell);
		const cy = Math.floor(y / this._cell);
		let best = null;
		let bestD2 = Infinity;
		for (let i = -1; i <= 1; i++) {
			for (let j = -1; j <= 1; j++) {
				for (const p of this._map.get(`${cx + i}_${cy + j}`) || []) {
					const d2 = (p[0] - x) ** 2 + (p[1] - y) ** 2;
					if (d2 < bestD2) { bestD2 = d2; best = p; }
				}
			}
		}
		return best ? {p: best, d: Math.sqrt(bestD2)} : null;
	}
}

const subsample = (arr, max) => arr.length <= max ? arr : arr.filter((_, i) => i % Math.ceil(arr.length / max) === 0);

/** Translation voting at a fixed scale: each (d, p) endpoint pair votes for `t = p - s*d`. */
const houghInit = (D, P, s, tol) => {
	const Ds = subsample(D, 500);
	const Ps = subsample(P, 500);
	const bin = tol * 2;
	const votes = new Map();
	let best = null;
	let bestN = 0;
	for (const [dx, dy] of Ds) {
		for (const [px, py] of Ps) {
			const k = `${Math.round((px - s * dx) / bin)}_${Math.round((py - s * dy) / bin)}`;
			const n = (votes.get(k) || 0) + 1;
			votes.set(k, n);
			if (n > bestN) { bestN = n; best = k; }
		}
	}
	const [bx, by] = best.split("_").map(Number);
	return {s, tx: bx * bin, ty: by * bin};
};

/** Iterative closest point, solving for (s, tx, ty) by least squares on matched pairs. */
const icp = (D, P, hashP, init, tol) => {
	let {s, tx, ty} = init;
	const Dfit = subsample(D, 1500);
	for (let it = 0; it < 25; it++) {
		const radius = it < 8 ? tol * 4 : tol * 1.5;
		const pairs = [];
		for (const [x, y] of Dfit) {
			const n = hashP.nearest(s * x + tx, s * y + ty);
			if (n && n.d < radius) pairs.push([x, y, n.p[0], n.p[1]]);
		}
		if (pairs.length < 6) return null;

		let mdx = 0; let mdy = 0; let mpx = 0; let mpy = 0;
		for (const [dx, dy, px, py] of pairs) { mdx += dx; mdy += dy; mpx += px; mpy += py; }
		mdx /= pairs.length; mdy /= pairs.length; mpx /= pairs.length; mpy /= pairs.length;
		let num = 0; let den = 0;
		for (const [dx, dy, px, py] of pairs) {
			num += (dx - mdx) * (px - mpx) + (dy - mdy) * (py - mpy);
			den += (dx - mdx) ** 2 + (dy - mdy) ** 2;
		}
		if (!den || num <= 0) return null;
		const sNext = num / den;
		const txNext = mpx - sNext * mdx;
		const tyNext = mpy - sNext * mdy;
		const converged = Math.abs(sNext - s) < 1e-5 && Math.abs(txNext - tx) < 0.05 && Math.abs(tyNext - ty) < 0.05;
		s = sNext; tx = txNext; ty = tyNext;
		if (converged) break;
	}
	return {s, tx, ty};
};

/** Share of each point set lying within `tol` of the other, after transforming D. */
const coverage = (D, P, hashP, {s, tx, ty}, tol) => {
	let inD = 0;
	for (const [x, y] of D) { const n = hashP.nearest(s * x + tx, s * y + ty); if (n && n.d < tol) inD++; }
	const hashD = new SpatialHash(D.map(([x, y]) => [s * x + tx, s * y + ty]), tol * 4);
	let inP = 0;
	for (const [x, y] of P) { const n = hashD.nearest(x, y); if (n && n.d < tol) inP++; }
	return {coverageDdb: inD / D.length, coveragePlut: inP / P.length};
};

/**
 * How well DDB walls land on Plutonium walls under a given transform, without fitting one.
 * @return {?{coverageDdb, coveragePlut, score}}
 */
export const scoreTransform = ({wallsDdb, wallsPlut, xf, gridPlut = 100}) => {
	if (wallsDdb.length < 3 || wallsPlut.length < 3) return null;
	const tol = Math.max(gridPlut * 0.2, 6);
	const D = densify(wallsDdb, tol / (2 * xf.s));
	const P = densify(wallsPlut, tol / 2);
	const cov = coverage(D, P, new SpatialHash(P, tol * 4), xf, tol);
	return {...cov, score: Math.min(cov.coverageDdb, cov.coveragePlut)};
};

/**
 * @param wallsDdb walls of the DDB scene
 * @param wallsPlut walls of the Plutonium scene
 * @param scaleHints candidate scales (e.g. from image dimensions)
 * @param gridPlut grid size (px) of the Plutonium scene, which sets the matching tolerance
 * @return {?{s, tx, ty, coverageDdb, coveragePlut, score}}
 */
export const registerWalls = ({wallsDdb, wallsPlut, scaleHints = [], gridPlut = 100}) => {
	if (wallsDdb.length < 3 || wallsPlut.length < 3) return null;

	const tol = Math.max(gridPlut * 0.2, 6);
	const Dend = endpoints(wallsDdb);
	const Pend = endpoints(wallsPlut);
	const bd = bbox(Dend);
	const bp = bbox(Pend);
	const sBbox = ((bp[2] - bp[0]) / (bd[2] - bd[0] || 1) + (bp[3] - bp[1]) / (bd[3] - bd[1] || 1)) / 2;

	const D = densify(wallsDdb, tol / (2 * sBbox));
	const P = densify(wallsPlut, tol / 2);
	const hashP = new SpatialHash(P, tol * 4);

	const inits = [];
	for (const s0 of [sBbox, ...scaleHints].filter(s => Number.isFinite(s) && s > 0)) {
		inits.push({s: s0, tx: bp[0] - s0 * bd[0], ty: bp[1] - s0 * bd[1]});
		inits.push(houghInit(Dend, Pend, s0, tol));
	}

	let best = null;
	for (const init of inits) {
		const fit = icp(D, P, hashP, init, tol);
		if (!fit) continue;
		const cov = coverage(D, P, hashP, fit, tol);
		const score = Math.min(cov.coverageDdb, cov.coveragePlut);
		if (!best || score > best.score) best = {...fit, ...cov, score};
		// Good enough: further initialisations cannot meaningfully improve on this
		if (score > 0.9) break;
	}
	return best;
};
