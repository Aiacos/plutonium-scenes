import fs from "fs";
import path from "path";

const readJson = file => JSON.parse(fs.readFileSync(file, "utf-8"));

/** Name normalisation shared by map and creature matching: drops "Map 3.2:", "(Player)", punctuation. */
export const normName = str => (str || "")
	.toLowerCase()
	.replace(/^(map|appendix)?\s*[\d.a-z]{0,6}\s*[:.-]\s+/, "")
	.replace(/\(.*?\)|\bplayer\b|\bversion\b|\bdm\b/g, "")
	.replace(/[^a-z0-9]/g, "");

const bigrams = s => new Set([...Array(Math.max(0, s.length - 1))].map((_, i) => s.slice(i, i + 2)));

/** 1 = same normalised name, 0.8 = one contains the other, else bigram Dice coefficient. */
export const nameSimilarity = (a, b) => {
	a = normName(a); b = normName(b);
	if (!a || !b) return 0;
	if (a === b) return 1;
	if (a.includes(b) || b.includes(a)) return 0.8;
	const A = bigrams(a); const B = bigrams(b);
	let shared = 0;
	for (const x of A) if (B.has(x)) shared++;
	return 2 * shared / (A.size + B.size || 1);
};

/* -------------------------------------------- */
/* 5etools                                       */
/* -------------------------------------------- */

const walkMapImages = (obj, out, source) => {
	if (Array.isArray(obj)) return obj.forEach(it => walkMapImages(it, out, source));
	if (!obj || typeof obj !== "object") return;
	if (obj.type === "image" && obj.imageType === "map" && obj.title) {
		out.push({source, name: obj.title, width: obj.width, height: obj.height, grid: obj.grid || {}});
	}
	Object.values(obj).forEach(it => walkMapImages(it, out, source));
};

/** DM map images of every 5etools adventure and book, i.e. the scenes Plutonium can import. */
export const loadVetoolsMaps = vetDir => {
	const out = [];
	for (const [dir, indexFile, prop] of [["adventure", "adventures.json", "adventure"], ["book", "books.json", "book"]]) {
		for (const meta of readJson(path.join(vetDir, indexFile))[prop]) {
			const file = path.join(vetDir, dir, `${dir}-${meta.id.toLowerCase()}.json`);
			if (!fs.existsSync(file)) continue;
			walkMapImages(readJson(file), out, meta.source ?? meta.id);
		}
	}
	return out;
};

/** normalised creature name -> [{name, source}], from every official 5etools bestiary file. */
export const loadVetoolsBestiary = vetDir => {
	const dir = path.join(vetDir, "bestiary");
	const out = new Map();
	for (const file of fs.readdirSync(dir)) {
		if (!/^bestiary-.*\.json$/.test(file)) continue;
		for (const mon of readJson(path.join(dir, file)).monster || []) {
			if (!mon.name || !mon.source) continue;
			const k = normName(mon.name);
			if (!out.has(k)) out.set(k, []);
			out.get(k).push({name: mon.name, source: mon.source});
		}
	}
	return out;
};

/* -------------------------------------------- */
/* DDB meta data                                 */
/* -------------------------------------------- */

/** Normalise the scene frame across the Foundry generations the meta data was exported from. */
const getDdbFrame = scene => {
	const isGridObject = scene.grid && typeof scene.grid === "object";
	const gridSize = isGridObject ? scene.grid.size : scene.grid;
	const gridDistance = isGridObject ? scene.grid.distance : scene.gridDistance;
	const gridUnits = isGridObject ? scene.grid.units : scene.gridUnits;
	const padding = scene.padding ?? 0.25;
	// Foundry rounds padding up to a whole number of grid cells
	const padX = Math.ceil(scene.width * padding / gridSize) * gridSize;
	const padY = Math.ceil(scene.height * padding / gridSize) * gridSize;
	return {
		width: scene.width,
		height: scene.height,
		gridSize,
		gridDistance: gridDistance ?? 5,
		gridUnits: gridUnits ?? "ft",
		padX,
		padY,
		offsetX: scene.background?.offsetX ?? scene.shiftX ?? 0,
		offsetY: scene.background?.offsetY ?? scene.shiftY ?? 0,
	};
};

export const loadDdbScenes = ddbContentDir => {
	const root = path.join(ddbContentDir, "scene_info");
	const out = [];
	for (const book of fs.readdirSync(root)) {
		for (const file of fs.readdirSync(path.join(root, book))) {
			if (!file.endsWith(".json")) continue;
			const scene = readJson(path.join(root, book, file));
			out.push({
				book,
				file,
				name: scene.name,
				frame: getDdbFrame(scene),
				walls: (scene.walls || []).filter(w => Array.isArray(w.c) && w.c.length === 4),
				lights: scene.lights || [],
				tokens: scene.flags?.ddb?.tokens || [],
			});
		}
	}
	return out;
};

/**
 * DDB book codes rarely equal 5etools source ids (`tod` covers HotDQ + RoT, `tftyp` is split into
 * `TftYP-*`). Infer the mapping from shared map names instead of maintaining it by hand: a book is a
 * candidate for every 5etools source it shares at least one map name with (two, for large books).
 * Wall registration rejects wrong candidates later, so over-inclusion is cheap.
 * @return {Map<string, Set<string>>} 5etools source -> DDB book codes
 */
export const inferBookSources = ({ddbScenes, vetMaps}) => {
	const namesBySource = new Map();
	for (const m of vetMaps) {
		if (!namesBySource.has(m.source)) namesBySource.set(m.source, new Set());
		namesBySource.get(m.source).add(normName(m.name));
	}
	const namesByBook = new Map();
	for (const s of ddbScenes) {
		if (!namesByBook.has(s.book)) namesByBook.set(s.book, new Set());
		const n = normName(s.name);
		if (n) namesByBook.get(s.book).add(n);
	}

	const out = new Map();
	const add = (source, book) => {
		if (!out.has(source)) out.set(source, new Set());
		out.get(source).add(book);
	};
	for (const [book, names] of namesByBook) {
		for (const [source, vetNames] of namesBySource) {
			if (source.toLowerCase() === book) { add(source, book); continue; }
			let shared = 0;
			for (const n of names) if (vetNames.has(n)) shared++;
			if (shared >= 2 || (shared === 1 && names.size <= 3)) add(source, book);
		}
	}
	return out;
};
