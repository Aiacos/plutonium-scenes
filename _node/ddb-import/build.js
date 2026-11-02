/**
 * Enrich Plutonium scene data with the DDB Importer community scene data
 * (https://github.com/MrPrimate/ddb-meta-data): lights, missing walls, and monster/NPC placements.
 *
 * Usage:
 *   node _node/ddb-import/build.js --ddb <ddb-meta-data/content> --vet <5etools-src/data> [--report <file>]
 */
import fs from "fs";
import path from "path";
import {Command} from "commander";
import {readJsonSync, writeJsonSync} from "5etools-utils/lib/UtilFs.js";
import {registerWalls} from "./geometry.js";
import {inferBookSources, loadDdbScenes, loadVetoolsBestiary, loadVetoolsMaps, nameSimilarity, normName} from "./loaders.js";
import {convertLights, convertTokens, convertWalls, getPlayerTransform, getPlutFrame, retargetLights, retargetTokens, retargetWalls} from "./convert.js";

export const FLAG_SCOPE = "ddb-plutonium-scenes";

/** Below this, the walls of the two scenes do not describe the same map closely enough. */
const MIN_REGISTRATION_SCORE = 0.5;
/** Without walls to register against, only accept an identical name and image aspect ratio. */
const MAX_ASPECT_DELTA = 0.02;

const DIR_DATA = "data";

const getParams = () => new Command()
	.requiredOption("--ddb <dir>", `Path to the "content" directory of a ddb-meta-data checkout.`)
	.requiredOption("--vet <dir>", `Path to the "data" directory of a 5etools-src checkout.`)
	.option("--report <file>", "Write a JSON report of every match decision.")
	.parse(process.argv)
	.opts();

/**
 * Without walls on the Plutonium side, map the DDB image onto the 5etools image by its bounds.
 * DDB coordinates include Foundry's padding minus the background offset; Plutonium shifts the
 * image by the 5etools grid offset. Calibrated against wall registration on 80 maps: median error
 * 0.1 grid cells, 71/80 within half a cell.
 */
const getAnalyticTransform = ({frameDdb, framePlut}) => {
	const s = framePlut.width / frameDdb.width;
	return {
		s,
		tx: -s * (frameDdb.padX - frameDdb.offsetX) - framePlut.gridOffsetX,
		ty: -s * (frameDdb.padY - frameDdb.offsetY) - framePlut.gridOffsetY,
	};
};

const getCandidates = ({entry, ddbScenes, books}) => ddbScenes
	.filter(scene => books.has(scene.book))
	.map(scene => ({scene, sim: nameSimilarity(entry.name, scene.name)}))
	.filter(({sim}) => sim >= 0.3)
	.sort((a, b) => b.sim - a.sim)
	.slice(0, 5);

const matchEntry = ({entry, vetMap, candidates}) => {
	const framePlut = getPlutFrame(vetMap);

	if (entry.walls?.length) {
		let best = null;
		for (const {scene, sim} of candidates) {
			if (!scene.walls.length) continue;
			const scaleHints = framePlut.width ? [framePlut.width / scene.frame.width, framePlut.height / scene.frame.height] : [];
			const reg = registerWalls({wallsDdb: scene.walls, wallsPlut: entry.walls, scaleHints, gridPlut: framePlut.gridSize});
			if (!reg) continue;
			// Prefer the scene carrying the most data when two variants (DM/player) register equally well
			const rank = reg.score + 0.001 * Math.min(scene.lights.length + scene.tokens.length, 50) + 0.01 * sim;
			if (!best || rank > best.rank) best = {scene, sim, reg, rank};
		}
		if (!best || best.reg.score < MIN_REGISTRATION_SCORE) return {status: "unmatched", best, framePlut};
		return {status: "matched", method: "walls", scene: best.scene, xf: best.reg, score: best.reg.score, framePlut};
	}

	if (!framePlut.width) return {status: "unmatched", framePlut};
	const exact = candidates.find(({scene, sim}) => {
		if (sim < 1) return false;
		const arDdb = scene.frame.width / scene.frame.height;
		const arPlut = framePlut.width / framePlut.height;
		return Math.abs(arDdb / arPlut - 1) <= MAX_ASPECT_DELTA;
	});
	if (!exact) return {status: "unmatched", framePlut};
	return {status: "matched", method: "bounds", scene: exact.scene, xf: getAnalyticTransform({frameDdb: exact.scene.frame, framePlut}), score: null, framePlut};
};

/**
 * Book > chapter folder for the companion module, mirroring DDB Importer's adventure layout. `sort`
 * keeps chapters and maps in reading order, which alphabetical folder sorting would scramble.
 */
const setFolder = (entry, vetMap, {isPlayer = false} = {}) => {
	if (!vetMap.bookName || !vetMap.chapterName) return false;
	entry.flags = {
		...entry.flags,
		[FLAG_SCOPE]: {
			...entry.flags?.[FLAG_SCOPE],
			// A player version sorts right after its DM map
			folder: {path: [vetMap.bookName, vetMap.chapterName], sort: [vetMap.chapterIx, vetMap.order + (isPlayer ? 0.5 : 0)]},
		},
	};
	return true;
};

/**
 * Plutonium imports a map's player version as its own scene and gives it side data by its own name
 * only, so a player scene would get no lights, walls or creatures. Copy the DM map's data onto it,
 * keeping anything the repository already has for the player version.
 * @return {string[]} what was added
 */
const addPlayerVersion = ({entriesByName, source, vetMap, player, stats}) => {
	if (!entriesByName.has(player.name)) entriesByName.set(player.name, {name: player.name, source});
	const entry = entriesByName.get(player.name);
	if (entry.isIgnored) return [];
	const added = [];

	if (!entry.flags?.[FLAG_SCOPE]?.folder && setFolder(entry, vetMap, {isPlayer: true})) { stats.scenesFoldered++; added.push("folder"); }

	const dm = entriesByName.get(vetMap.name);
	if (!dm) return added;
	const frameDm = getPlutFrame(vetMap);
	const framePlayer = getPlutFrame(player);
	const xf = getPlayerTransform({frameDm, framePlayer});
	if (!xf) return added;

	if (!entry.walls?.length && dm.walls?.length) {
		entry.walls = retargetWalls({walls: dm.walls, xf});
		stats.walls += entry.walls.length; stats.scenesWalled++; added.push("walls");
	}
	if (!entry.lights?.length && dm.lights?.length) {
		entry.lights = retargetLights({lights: dm.lights, xf, frameDm, framePlayer});
		stats.lights += entry.lights.length; stats.scenesLit++; added.push("lights");
	}
	const dmFlags = dm.flags?.[FLAG_SCOPE];
	if (!entry.flags?.[FLAG_SCOPE]?.tokens?.length && dmFlags?.tokens?.length) {
		const tokens = retargetTokens({tokens: dmFlags.tokens, xf, frameDm, framePlayer});
		entry.flags = {...entry.flags, [FLAG_SCOPE]: {...entry.flags?.[FLAG_SCOPE], tokens, ddbScene: dmFlags.ddbScene}};
		stats.tokens += tokens.length; stats.scenesPopulated++; added.push("tokens");
	}
	return added;
};

const run = () => {
	const params = getParams();

	const vetMaps = loadVetoolsMaps(params.vet);
	const bestiary = loadVetoolsBestiary(params.vet);
	const ddbScenes = loadDdbScenes(params.ddb);
	const bookSources = inferBookSources({ddbScenes, vetMaps});

	const fpathIndex = path.join(DIR_DATA, "foundry-index.json");
	const index = readJsonSync(fpathIndex);
	const report = [];
	const stats = {lights: 0, walls: 0, tokens: 0, scenesLit: 0, scenesWalled: 0, scenesPopulated: 0, scenesFoldered: 0, unmatched: 0};

	const sources = new Set([...Object.keys(index), ...vetMaps.map(m => m.source)]);
	for (const source of [...sources].sort()) {
		const books = bookSources.get(source);
		const vetMapsForSource = vetMaps.filter(m => m.source === source);
		if (!books?.size && !vetMapsForSource.length) continue;

		const fname = index[source] ?? `foundry-maps-${source.toLowerCase()}.json`;
		const fpath = path.join(DIR_DATA, fname);
		const json = fs.existsSync(fpath) ? readJsonSync(fpath) : {map: []};

		// Keyed by exact name, as Plutonium matches: normalised names collide ("Map 2: Walls of
		// Ravenloft" vs "Walls of Ravenloft (Battlemap; DM Version)")
		const entriesByName = new Map(json.map.map(e => [e.name, e]));
		// Every DM map Plutonium can import, plus entries the repo already has
		for (const vetMap of vetMapsForSource) {
			if (!entriesByName.has(vetMap.name)) entriesByName.set(vetMap.name, {name: vetMap.name, source});
		}

		let isChanged = false;
		for (const entry of entriesByName.values()) {
			if (entry.isIgnored) continue;
			const vetMap = vetMapsForSource.find(m => m.name === entry.name) ?? vetMapsForSource.find(m => normName(m.name) === normName(entry.name));

			if (vetMap && setFolder(entry, vetMap)) { stats.scenesFoldered++; isChanged = true; }

			const candidates = books?.size ? getCandidates({entry, ddbScenes, books}) : [];
			if (!candidates.length) continue;

			const match = matchEntry({entry, vetMap, candidates});
			if (match.status !== "matched") {
				stats.unmatched++;
				report.push({source, name: entry.name, status: "unmatched", bestScene: match.best?.scene.file ?? null, bestScore: match.best?.reg.score ?? null});
				continue;
			}

			const {scene, xf, framePlut} = match;
			const added = [];

			if (!entry.lights?.length && scene.lights.length) {
				const lights = convertLights({lights: scene.lights, xf, frameDdb: scene.frame, framePlut});
				if (lights.length) { entry.lights = lights; stats.lights += lights.length; stats.scenesLit++; added.push("lights"); }
			}

			if (!entry.walls?.length && scene.walls.length) {
				const walls = convertWalls({walls: scene.walls, xf});
				if (walls.length) { entry.walls = walls; stats.walls += walls.length; stats.scenesWalled++; added.push("walls"); }
			}

			if (scene.tokens.length) {
				const tokens = convertTokens({tokens: scene.tokens, xf, frameDdb: scene.frame, framePlut, source, bestiary});
				if (tokens.length) {
					entry.flags = {
						...entry.flags,
						[FLAG_SCOPE]: {...entry.flags?.[FLAG_SCOPE], tokens, ddbScene: scene.file},
					};
					stats.tokens += tokens.length; stats.scenesPopulated++; added.push("tokens");
				}
			}

			report.push({source, name: entry.name, status: "matched", method: match.method, score: match.score && Number(match.score.toFixed(3)), scale: Number(xf.s.toFixed(4)), ddbScene: scene.file, added});
			if (added.length) isChanged = true;
		}

		for (const vetMap of vetMapsForSource) {
			for (const player of vetMap.players ?? []) {
				const added = addPlayerVersion({entriesByName, source, vetMap, player, stats});
				if (added.length) { isChanged = true; report.push({source, name: player.name, status: "player", dm: vetMap.name, added}); }
			}
		}

		if (!isChanged) continue;

		// The schema requires 3+ properties per entry; a bare {name, source} adds nothing
		json.map = [...entriesByName.values()]
			.filter(e => Object.keys(e).length >= 3)
			.sort((a, b) => a.name.localeCompare(b.name, undefined, {sensitivity: "base"}));
		writeJsonSync(fpath, json, {isClean: true});
		index[source] ||= fname;
	}

	const indexSorted = Object.fromEntries(Object.entries(index).sort(([a], [b]) => a.localeCompare(b, undefined, {sensitivity: "base"})));
	writeJsonSync(fpathIndex, indexSorted, {isClean: true});

	patchSchema();

	if (params.report) fs.writeFileSync(params.report, JSON.stringify({stats, entries: report}, null, "\t"));
	console.log(stats);
};

/** Map entries now carry scene `flags` (creature placements), which Plutonium copies onto the scene. */
const patchSchema = () => {
	const fpath = path.join("test", "schema", "shared.json");
	const schema = readJsonSync(fpath);
	if (schema.$defs.map.properties.flags) return;
	schema.$defs.map.properties.flags = {type: "object"};
	writeJsonSync(fpath, schema, {isClean: true});
};

run();
