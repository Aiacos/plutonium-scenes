/** Matching a Plutonium scene repository entry to a DDB scene. */
import {registerWalls, scoreTransform} from "./geometry.js";
import {nameSimilarity, normName} from "./loaders.js";
import {getPlutFrame} from "./convert.js";

/** Below this, the walls of the two scenes do not describe the same map closely enough. */
const MIN_REGISTRATION_SCORE = 0.5;
/** Image bounds matching needs the same image aspect ratio, within this ratio. */
const MAX_ASPECT_DELTA = 0.02;
/**
 * When wall registration fails on a same-shape map, the image-bounds transform is still
 * accepted if one side's walls land on the other's: either side may have walls the other lacks,
 * so this is a one-sided coverage, on enough walls not to be a coincidence.
 */
const MIN_BOUNDS_COVERAGE = 0.8;
const MIN_BOUNDS_WALLS = 10;
/** Name similarity for bounds matching: "Ruins of Berez" in "The Ruins of Berez (Area U)" is 0.8. */
const MIN_BOUNDS_SIM = 0.75;
/** Without walls to confirm it, bounds matching needs one name to contain the other. */
const MIN_BOUNDS_SIM_UNCONFIRMED = 0.8;
/** Wall registration "agrees" with the image-bounds transform within this scale ratio... */
const MAX_AGREE_SCALE_DELTA = 0.01;
/** ...and this many grid cells of offset. */
const MAX_AGREE_OFFSET_CELLS = 1;

/**
 * Without walls on the Plutonium side, map the DDB image onto the 5etools image by its bounds.
 * DDB coordinates include Foundry's padding minus the background offset; Plutonium shifts the
 * image by the 5etools grid offset. Calibrated against wall registration on 80 maps: median error
 * 0.1 grid cells, 71/80 within half a cell.
 */
export const getAnalyticTransform = ({frameDdb, framePlut}) => {
	const s = framePlut.width / frameDdb.width;
	return {
		s,
		tx: -s * (frameDdb.padX - frameDdb.offsetX) - framePlut.gridOffsetX,
		ty: -s * (frameDdb.padY - frameDdb.offsetY) - framePlut.gridOffsetY,
	};
};

/** "Map 6.2: DM's Map" -> "6.2"; null without a map number. */
export const getMapNumber = name => /^\s*(?:maps?|appendix)?\s*((?:[a-z]|\d+)(?:\.\d+)?[a-z]?)\s*[:.-]\s/i.exec(name ?? "")?.[1]?.toLowerCase() ?? null;

/**
 * Name similarity for matching, which `normName` computes without the "Map 6.2:" prefix. When
 * several candidate scenes share a name once numbers are dropped (Keys from the Golden Vault has a
 * "Map N.2: DM's Map" per chapter), a different map number halves it. Otherwise numbers are
 * ignored: books reprinting a map number it differently (Barovia is Map 3.1 in one, 2.01 in another).
 */
export const getMatchSimilarity = (a, b, {isAmbiguous = false} = {}) => {
	const sim = nameSimilarity(a, b);
	if (!isAmbiguous) return sim;
	const [na, nb] = [getMapNumber(a), getMapNumber(b)];
	return na && nb && na !== nb ? sim / 2 : sim;
};

export const getCandidates = ({entry, ddbScenes, books}) => {
	const scenes = ddbScenes.filter(scene => books.has(scene.book));
	const nameCounts = new Map();
	for (const {name} of scenes) nameCounts.set(normName(name), (nameCounts.get(normName(name)) ?? 0) + 1);
	return scenes
		.map(scene => ({scene, sim: getMatchSimilarity(entry.name, scene.name, {isAmbiguous: nameCounts.get(normName(scene.name)) > 1})}))
		.filter(({sim}) => sim >= 0.3)
		.sort((a, b) => b.sim - a.sim)
		.slice(0, 5);
};

export const isSameShape = ({scene}, framePlut) => {
	if (!framePlut.width) return false;
	const arDdb = scene.frame.width / scene.frame.height;
	const arPlut = framePlut.width / framePlut.height;
	return Math.abs(arDdb / arPlut - 1) <= MAX_ASPECT_DELTA;
};

/** Two independent fits, wall registration and image bounds, landing on the same transform. */
export const isAgreeing = (reg, xf, framePlut) => !!reg
	&& Math.abs(reg.s / xf.s - 1) <= MAX_AGREE_SCALE_DELTA
	&& Math.abs(reg.tx - xf.tx) <= MAX_AGREE_OFFSET_CELLS * framePlut.gridSize
	&& Math.abs(reg.ty - xf.ty) <= MAX_AGREE_OFFSET_CELLS * framePlut.gridSize;

/**
 * Map by image bounds a candidate with a similar name and the same aspect ratio. With walls on
 * both sides, they must confirm the transform: one side's walls land on the other's (see
 * MIN_BOUNDS_COVERAGE), or wall registration found the same transform on its own. Without walls,
 * one name must contain the other.
 * @param {Map<object, object>} regs wall registration result per DDB scene
 */
export const matchByBounds = ({entry, candidates, framePlut, regs}) => {
	for (const candidate of candidates) {
		const {scene, sim} = candidate;
		if (sim < MIN_BOUNDS_SIM || !isSameShape(candidate, framePlut)) continue;
		const xf = getAnalyticTransform({frameDdb: scene.frame, framePlut});
		if (!entry.walls?.length || scene.walls.length < 3) {
			if (sim < MIN_BOUNDS_SIM_UNCONFIRMED) continue;
			return {status: "matched", method: "bounds", scene, xf, score: null, framePlut};
		}

		const reg = regs.get(scene);
		if (isAgreeing(reg, xf, framePlut)) {
			return {status: "matched", method: "bounds-agree", scene, xf, score: reg.score, framePlut};
		}
		const fit = scoreTransform({wallsDdb: scene.walls, wallsPlut: entry.walls, xf, gridPlut: framePlut.gridSize});
		// A handful of walls is only enough evidence when the names match exactly
		const minWalls = sim >= 1 ? 3 : MIN_BOUNDS_WALLS;
		const isDdbCovered = fit && fit.coverageDdb >= MIN_BOUNDS_COVERAGE && scene.walls.length >= minWalls;
		const isPlutCovered = fit && fit.coveragePlut >= MIN_BOUNDS_COVERAGE && entry.walls.length >= minWalls;
		if (isDdbCovered || isPlutCovered) {
			return {status: "matched", method: "bounds-walls", scene, xf, score: Math.max(fit.coverageDdb, fit.coveragePlut), framePlut};
		}
	}
	return null;
};

export const matchEntry = ({entry, vetMap, candidates}) => {
	const framePlut = getPlutFrame(vetMap);

	let best = null;
	const regs = new Map();
	if (entry.walls?.length) {
		for (const {scene, sim} of candidates) {
			if (!scene.walls.length) continue;
			const scaleHints = framePlut.width ? [framePlut.width / scene.frame.width, framePlut.height / scene.frame.height] : [];
			const reg = registerWalls({wallsDdb: scene.walls, wallsPlut: entry.walls, scaleHints, gridPlut: framePlut.gridSize});
			if (!reg) continue;
			regs.set(scene, reg);
			// Prefer the scene carrying the most data when two variants (DM/player) register equally well
			const rank = reg.score + 0.001 * Math.min(scene.lights.length + scene.tokens.length, 50) + 0.01 * sim;
			if (!best || rank > best.rank) best = {scene, sim, reg, rank};
		}
		if (best && best.reg.score >= MIN_REGISTRATION_SCORE) {
			return {status: "matched", method: "walls", scene: best.scene, xf: best.reg, score: best.reg.score, framePlut};
		}
	}

	return matchByBounds({entry, candidates, framePlut, regs}) ?? {status: "unmatched", best, framePlut};
};
