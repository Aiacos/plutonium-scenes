import {WallDataOptimizer} from "../convert-foundry-data/EntityDataOptimizer/WallDataOptimizer.js";
import {LightDataOptimizer} from "../convert-foundry-data/EntityDataOptimizer/LightDataOptimizer.js";
import {normName} from "./loaders.js";

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

export const convertWalls = ({walls, xf}) => {
	const seen = new Set();
	return walls
		.map(wall => {
			const cpy = stripLevelData(wall);
			const [x0, y0] = applyPoint(xf, wall.c[0], wall.c[1]);
			const [x1, y1] = applyPoint(xf, wall.c[2], wall.c[3]);
			cpy.c = [x0, y0, x1, y1];
			return wallOptimizer.getOptimizedEntity(cpy);
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
/* Creatures                                     */
/* -------------------------------------------- */

/** "Goblin 3", "Goblin (A)", "Goblin #2" -> "Goblin" */
const stripTokenSuffix = name => (name || "").replace(/\s*(\(.*?\)|#?\d+|[A-Z])$/, "").trim();

/**
 * Pick the 5etools creature a DDB token stands for, among every bestiary entry sharing its name.
 *
 * @param candidates {Array<{name: string, source: string}>} 5etools creatures with this name (≥1)
 * @param mapSource {string} 5etools source of the adventure/book the map belongs to (e.g. "LMoP")
 * @return {{name: string, source: string}}
 */
export const pickCreature = (candidates, mapSource) => {
	// The adventure's own statblock first (unique NPCs, adventure-specific variants), then the
	// 2014 Monster Manual the DDB adventures were written against, then the 2024 one.
	const preference = [mapSource, "MM", "XMM"];
	for (const source of preference) {
		const hit = candidates.find(c => c.source === source);
		if (hit) return hit;
	}
	return candidates[0];
};

export const resolveCreature = ({token, bestiary, mapSource}) => {
	const ddbName = token.flags?.ddbActorFlags?.name;
	for (const name of [ddbName, token.name, stripTokenSuffix(token.name)]) {
		const candidates = bestiary.get(normName(name));
		if (candidates?.length) return pickCreature(candidates, mapSource);
	}
	return null;
};

/**
 * Tokens are stored as data, not TokenDocuments: placing them needs actors, which only the
 * companion Foundry module can import (from official compendiums or via Plutonium).
 */
export const convertTokens = ({tokens, xf, frameDdb, framePlut, bestiary, mapSource}) => tokens
	.filter(t => Number.isFinite(t.x) && Number.isFinite(t.y))
	.map(t => {
		const width = t.width || 1;
		const height = t.height || 1;
		// Transform the centre: DDB and Plutonium grid cells differ in size, the creature size does not
		const [cx, cy] = applyPoint(xf, t.x + width * frameDdb.gridSize / 2, t.y + height * frameDdb.gridSize / 2);
		const creature = resolveCreature({token: t, bestiary, mapSource});
		return {
			name: t.name,
			ddbName: t.flags?.ddbActorFlags?.name ?? t.name,
			ddbId: t.flags?.ddbActorFlags?.id ?? null,
			...(creature ? {creature} : {}),
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
