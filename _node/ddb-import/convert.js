import {WallDataOptimizer} from "../convert-foundry-data/EntityDataOptimizer/WallDataOptimizer.js";
import {LightDataOptimizer} from "../convert-foundry-data/EntityDataOptimizer/LightDataOptimizer.js";
import {nameSimilarity, normName} from "./loaders.js";

const wallOptimizer = new WallDataOptimizer();
const lightOptimizer = new LightDataOptimizer();

const round = (n, dp = 0) => Math.round(n * 10 ** dp) / 10 ** dp;

/** Plutonium scene frame for a 5etools map entry; mirrors `DataConverterMap` in Plutonium. */
export const getPlutFrame = vetMap => ({
	gridSize: vetMap?.grid?.size ?? 100,
	gridDistance: vetMap?.grid?.distance ?? 5,
	gridUnits: vetMap?.grid?.units ?? "ft",
	gridOffsetX: vetMap?.grid?.offsetX ?? 0,
	gridOffsetY: vetMap?.grid?.offsetY ?? 0,
	width: vetMap?.width ? vetMap.width * (vetMap.grid?.scale ?? 1) : null,
	height: vetMap?.height ? vetMap.height * (vetMap.grid?.scale ?? 1) : null,
});

const isSameUnit = (a, b) => normName(a).replace(/s$/, "") === normName(b).replace(/s$/, "");

/**
 * Light radii are in scene distance units, not pixels: convert DDB units -> DDB px -> Plutonium px
 * -> Plutonium units. With mismatched units (an overland map in miles vs a printed scale in feet)
 * keep the radius proportional to grid cells instead.
 */
const getRadiusFactor = ({xf, frameDdb, framePlut}) => {
	const pxPerUnitDdb = frameDdb.gridSize / frameDdb.gridDistance;
	const pxPerUnitPlut = framePlut.gridSize / framePlut.gridDistance;
	return isSameUnit(frameDdb.gridUnits, framePlut.gridUnits)
		? xf.s * pxPerUnitDdb / pxPerUnitPlut
		: xf.s * frameDdb.gridSize / framePlut.gridSize;
};

const applyPoint = (xf, x, y) => [round(xf.s * x + xf.tx), round(xf.s * y + xf.ty)];

const stripLevelData = entity => {
	const cpy = structuredClone(entity);
	// Level ids and these legacy keys are scene-specific; Plutonium assigns its own level
	delete cpy.levels;
	delete cpy.config?.gradual;
	delete cpy.lightAnimation;
	return cpy;
};

export const convertLights = ({lights, xf, frameDdb, framePlut}) => {
	const k = getRadiusFactor({xf, frameDdb, framePlut});
	// Community data sometimes stacks identical lights; the schema requires unique items
	const seen = new Set();
	return lights
		.map(light => {
			const cpy = stripLevelData(light);
			[cpy.x, cpy.y] = applyPoint(xf, light.x, light.y);
			cpy.config = {...cpy.config};
			cpy.config.dim = round((cpy.config.dim || 0) * k, 2);
			cpy.config.bright = round((cpy.config.bright || 0) * k, 2);
			// Lights exported from Foundry v9 carry `angle: 0` for "unrestricted"; modern Foundry
			// renders a zero-width cone, i.e. nothing
			if (!cpy.config.angle) cpy.config.angle = 360;
			return lightOptimizer.getOptimizedEntity(cpy);
		})
		.filter(light => {
			if (!light) return false;
			const id = JSON.stringify(light);
			if (seen.has(id)) return false;
			seen.add(id);
			return true;
		});
};

/**
 * The map image in Plutonium scene coordinates (Plutonium shifts the image by its grid offset),
 * with half a grid cell of margin for walls drawn along the edge. Null without image dimensions.
 */
export const getImageRect = frame => {
	if (!frame.width || !frame.height) return null;
	const m = frame.gridSize / 2;
	return [-frame.gridOffsetX - m, -frame.gridOffsetY - m, frame.width - frame.gridOffsetX + m, frame.height - frame.gridOffsetY + m];
};

/**
 * Clip a wall segment to a rectangle (Liang-Barsky): DDB walls drawn past the image edge, or onto
 * a part of the map the 5etools image crops out, end at the image edge instead.
 * @return {?number[]} the clipped [x0, y0, x1, y1], or null if the wall lies outside
 */
export const clipSegment = ([x0, y0, x1, y1], [minX, minY, maxX, maxY]) => {
	const dx = x1 - x0;
	const dy = y1 - y0;
	let t0 = 0;
	let t1 = 1;
	for (const [p, q] of [[-dx, x0 - minX], [dx, maxX - x0], [-dy, y0 - minY], [dy, maxY - y0]]) {
		if (p === 0) {
			if (q < 0) return null;
			continue;
		}
		const t = q / p;
		if (p < 0) t0 = Math.max(t0, t);
		else t1 = Math.min(t1, t);
		if (t0 > t1) return null;
	}
	return [round(x0 + t0 * dx), round(y0 + t0 * dy), round(x0 + t1 * dx), round(y0 + t1 * dy)];
};

const clipWall = (wall, rect) => {
	if (!rect) return wall;
	const c = clipSegment(wall.c, rect);
	return c ? {...wall, c} : null;
};

export const convertWalls = ({walls, xf, framePlut}) => {
	const seen = new Set();
	const rect = framePlut ? getImageRect(framePlut) : null;
	return walls
		.map(wall => {
			const cpy = stripLevelData(wall);
			const [x0, y0] = applyPoint(xf, wall.c[0], wall.c[1]);
			const [x1, y1] = applyPoint(xf, wall.c[2], wall.c[3]);
			cpy.c = [x0, y0, x1, y1];
			const clipped = clipWall(cpy, rect);
			return clipped && wallOptimizer.getOptimizedEntity(clipped);
		})
		.filter(wall => {
			if (!wall || (wall.c[0] === wall.c[2] && wall.c[1] === wall.c[3])) return false;
			const id = wall.c.join("__");
			if (seen.has(id)) return false;
			seen.add(id);
			return true;
		});
};

/* -------------------------------------------- */
/* Player versions                               */
/* -------------------------------------------- */

const MAX_PLAYER_ASPECT_DELTA = 0.02;

/**
 * Map a DM scene onto its player version. Both images show the same map, but a player image may be
 * exported at another resolution (5etools `autoScale`); a different aspect ratio means a different
 * crop, which cannot be mapped without walls to register against.
 * @return {?{s: number, tx: number, ty: number}}
 */
export const getPlayerTransform = ({frameDm, framePlayer}) => {
	if (!frameDm.width || !framePlayer.width) return null;
	const arDm = frameDm.width / frameDm.height;
	const arPlayer = framePlayer.width / framePlayer.height;
	if (Math.abs(arPlayer / arDm - 1) > MAX_PLAYER_ASPECT_DELTA) return null;
	// Plutonium shifts each image by its own grid offset
	const s = framePlayer.width / frameDm.width;
	return {s, tx: s * frameDm.gridOffsetX - framePlayer.gridOffsetX, ty: s * frameDm.gridOffsetY - framePlayer.gridOffsetY};
};

/** Re-target already converted entity data (scene coordinates) from a DM scene to its player version. */
export const retargetWalls = ({walls, xf, framePlayer}) => {
	const rect = framePlayer ? getImageRect(framePlayer) : null;
	return walls
		.map(wall => {
			const [x0, y0] = applyPoint(xf, wall.c[0], wall.c[1]);
			const [x1, y1] = applyPoint(xf, wall.c[2], wall.c[3]);
			return clipWall({...wall, c: [x0, y0, x1, y1]}, rect);
		})
		.filter(wall => wall && (wall.c[0] !== wall.c[2] || wall.c[1] !== wall.c[3]));
};

export const retargetLights = ({lights, xf, frameDm, framePlayer}) => {
	const k = getRadiusFactor({xf, frameDdb: frameDm, framePlut: framePlayer});
	return lights.map(light => {
		const cpy = structuredClone(light);
		[cpy.x, cpy.y] = applyPoint(xf, light.x, light.y);
		if (cpy.config?.dim != null) cpy.config.dim = round(cpy.config.dim * k, 2);
		if (cpy.config?.bright != null) cpy.config.bright = round(cpy.config.bright * k, 2);
		return cpy;
	});
};

export const retargetTokens = ({tokens, xf, frameDm, framePlayer}) => tokens.map(token => {
	const [cx, cy] = applyPoint(xf, token.x + token.width * frameDm.gridSize / 2, token.y + token.height * frameDm.gridSize / 2);
	return {...token, x: round(cx - token.width * framePlayer.gridSize / 2), y: round(cy - token.height * framePlayer.gridSize / 2)};
});

/* -------------------------------------------- */
/* Creatures                                     */
/* -------------------------------------------- */

/** "Goblin 3", "Goblin (A)", "Goblin #2" -> "Goblin" */
const stripTokenSuffix = name => (name || "").replace(/\s*(\(.*?\)|#?\d+|[A-Z])$/, "").trim();

/** The 2024 core rules (XPHB) came out on this date; later books use the 2024 statblock format. */
const EDITION_2024_START = "2024-09-17";

const getEdition = creature => creature.published && creature.published >= EDITION_2024_START ? "2024" : "2014";

const byNewest = (a, b) => (b.published ?? "").localeCompare(a.published ?? "");

/** "Goblin Warrior|XMM" -> the bestiary entry */
const getByUid = (bestiary, uid) => {
	const [name, source] = uid.split("|");
	return bestiary.get(normName(name))?.find(c => c.source.toLowerCase() === (source ?? "").toLowerCase()) ?? null;
};

/**
 * Pick the 5etools creature a DDB token stands for in one rules edition, among every bestiary entry
 * sharing its name: the most recently published statblock of that edition. For 2024, a 2014-only
 * name follows its `reprintedAs` link ("Goblin" -> "Goblin Warrior"). Without a statblock in the
 * edition, the newest one of any edition is used.
 */
export const pickCreature = (candidates, edition, bestiary) => {
	const sorted = [...candidates].sort(byNewest);
	const inEdition = sorted.find(c => getEdition(c) === edition);
	if (inEdition) return inEdition;
	if (edition === "2024") {
		const reprint = sorted
			.flatMap(c => c.reprintedAs ?? [])
			.map(uid => getByUid(bestiary, uid))
			.filter(Boolean)
			.sort(byNewest)[0];
		if (reprint) return reprint;
	}
	return sorted[0];
};

const toRef = creature => ({name: creature.name, source: creature.source});

/* -------------------------------------------- */
/* Adventure NPCs                                */
/* -------------------------------------------- */

const nameWords = str => (str || "").toLowerCase().replace(/['’"]/g, "").split(/[^a-z0-9]+/).filter(Boolean);

const sourceCreatures = new WeakMap();
const commonWords = new WeakMap();

/** The creatures a book itself defines: its named NPCs and variants. */
const getSourceCreatures = (bestiary, source) => {
	if (!sourceCreatures.has(bestiary)) sourceCreatures.set(bestiary, new Map());
	const cache = sourceCreatures.get(bestiary);
	const key = (source ?? "").toLowerCase();
	if (!cache.has(key)) cache.set(key, [...bestiary.values()].flat().filter(c => c.source.toLowerCase() === key));
	return cache.get(key);
};

/**
 * Words used in creature names across several books ("stone", "king", "prisoner"): a first name
 * must not be one of them, or "Stone Giant of Deadstone Cleft" would match "Stone Giant Statue".
 */
const getCommonWords = bestiary => {
	if (!commonWords.has(bestiary)) {
		const sourcesByWord = new Map();
		for (const c of [...bestiary.values()].flat()) {
			for (const w of nameWords(c.name)) {
				if (!sourcesByWord.has(w)) sourcesByWord.set(w, new Set());
				sourcesByWord.get(w).add(c.source);
			}
		}
		commonWords.set(bestiary, new Set([...sourcesByWord].filter(([, sources]) => sources.size > 1).map(([w]) => w)));
	}
	return commonWords.get(bestiary);
};

const getNumbers = words => words.filter(w => /\d/.test(w)).join(" ");

const unique = arr => arr.length === 1 ? arr[0] : null;

/**
 * The book's own statblock for a named token. DDB places adventure NPCs with a generic statblock
 * and a personal name ("Danika Martikov" as a Commoner), and its names differ from 5etools':
 *   exact or alias      "Rictavio"           -> Rictavio
 *   every word          "Rose Durst"         -> Rosavalda "Rose" Durst, "Brom" -> Brom Martikov
 *   same first name     "Danika Martikov"    -> Danika Dorakova (unique, and not a word other books use)
 *   near-identical      "Cloven Belview"     -> Clovin Belview
 * A name that is itself a creature ("Guard", "Wolf") only matches exactly.
 */
export const findBookCreature = ({name, source, bestiary}) => {
	const own = getSourceCreatures(bestiary, source);
	if (!own.length) return null;
	const k = normName(name);
	if (!k) return null;
	// "Tribal Warrior Spore Servants" names the group of "Tribal Warrior Spore Servant"
	const singular = str => normName(str).replace(/s$/, "");
	const exact = own.find(c => normName(c.name) === k || c.alias?.some(a => normName(a) === k)) ??
		own.find(c => singular(c.name) === singular(name));
	if (exact) return exact;
	if (bestiary.has(k)) return null;

	const words = nameWords(name);
	// "Prisoner 6" is not "Prisoner 13"
	const numbers = getNumbers(words);
	const others = own.filter(c => getNumbers(nameWords(c.name)) === numbers);
	const bySubset = others.filter(c => {
		const cw = new Set(nameWords(c.name));
		return words.every(w => cw.has(w));
	});
	if (bySubset.length) return unique(bySubset);

	if (words.length > 1 && !getCommonWords(bestiary).has(words[0])) {
		const byFirst = unique(others.filter(c => nameWords(c.name)[0] === words[0]));
		if (byFirst) return byFirst;
	}
	return unique(others.filter(c => nameSimilarity(c.name, name) >= 0.85));
};

/**
 * The creature a book's own text names this way ("Prince Livid" -> Gray Ooze, see
 * `loadCreatureAliases`), as a bestiary entry. Names that are creatures themselves are skipped.
 */
const findAliasedCreature = ({name, source, bestiary, aliases}) => {
	// Only personal names: books also alias generic ones ("commoner" for a Vistana Commoner)
	if (bestiary.has(normName(name))) return null;
	const ref = aliases?.get((source ?? "").toLowerCase())?.get(normName(name));
	if (!ref) return null;
	return getByUid(bestiary, `${ref.name}|${ref.source}`);
};

/**
 * @param {{token: object, source: string, bestiary: Map, aliases?: Map}} opts `aliases` from
 * `loadCreatureAliases`
 * @return {?{"2024": {name, source}, "2014": {name, source}, npc?: true}} `npc`: the book's own
 * statblock for a named NPC, which the module must not swap for a generic one
 */
export const resolveCreatures = ({token, source, bestiary, aliases}) => {
	const ddbName = token.flags?.ddbActorFlags?.name;
	const tokenName = stripTokenSuffix(token.name);
	const asNpc = npc => ({"2024": toRef(npc), "2014": toRef(npc), npc: true});
	const asCreature = creature => {
		if (creature.source.toLowerCase() === (source ?? "").toLowerCase()) return asNpc(creature);
		const candidates = bestiary.get(normName(creature.name));
		return {"2024": toRef(pickCreature(candidates, "2024", bestiary)), "2014": toRef(pickCreature(candidates, "2014", bestiary))};
	};

	// What the book itself calls this creature beats any guess
	for (const name of new Set([token.name, tokenName, ddbName].filter(Boolean))) {
		const aliased = findAliasedCreature({name, source, bestiary, aliases});
		if (aliased) return asCreature(aliased);
	}

	// A personal name on a generic statblock: the book's own NPC beats the generic one
	if (ddbName && normName(tokenName) !== normName(ddbName)) {
		const npc = findBookCreature({name: tokenName, source, bestiary});
		if (npc) return asNpc(npc);
	}

	for (const name of [ddbName, token.name, tokenName]) {
		const candidates = bestiary.get(normName(name));
		if (!candidates?.length) continue;
		return {
			"2024": toRef(pickCreature(candidates, "2024", bestiary)),
			"2014": toRef(pickCreature(candidates, "2014", bestiary)),
		};
	}

	// DDB's own NPC actor, named differently from 5etools ("Rose Durst")
	for (const name of new Set([ddbName, token.name, tokenName].filter(Boolean))) {
		const npc = findBookCreature({name, source, bestiary});
		if (npc) return asNpc(npc);
	}
	return null;
};

/**
 * Tokens are stored as data, not TokenDocuments: placing them needs actors, which only the
 * companion Foundry module can import (from official compendiums or via Plutonium).
 */
export const convertTokens = ({tokens, xf, frameDdb, framePlut, source, bestiary, aliases}) => tokens
	.filter(t => Number.isFinite(t.x) && Number.isFinite(t.y))
	.map(t => {
		const width = t.width || 1;
		const height = t.height || 1;
		// Transform the centre: DDB and Plutonium grid cells differ in size, the creature size does not
		const [cx, cy] = applyPoint(xf, t.x + width * frameDdb.gridSize / 2, t.y + height * frameDdb.gridSize / 2);
		const {npc, ...creatures} = resolveCreatures({token: t, source, bestiary, aliases}) ?? {};
		return {
			name: t.name,
			ddbName: t.flags?.ddbActorFlags?.name ?? t.name,
			ddbId: t.flags?.ddbActorFlags?.id ?? null,
			...(creatures["2024"] ? {creatures} : {}),
			...(npc ? {npc} : {}),
			x: round(cx - width * framePlut.gridSize / 2),
			y: round(cy - height * framePlut.gridSize / 2),
			width,
			height,
			...(t.scale && t.scale !== 1 ? {scale: t.scale} : {}),
			...(t.elevation ? {elevation: t.elevation} : {}),
			disposition: t.disposition ?? -1,
			...(t.hidden ? {hidden: true} : {}),
		};
	});
