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
import {inferBookSources, loadCreatureAliases, loadDdbScenes, loadVetoolsBestiary, loadVetoolsMaps, normName} from "./loaders.js";
import {getCandidates, matchEntry} from "./match.js";
import {convertLights, convertTokens, convertWalls, getPlayerTransform, getPlutFrame, retargetLights, retargetTokens, retargetWalls} from "./convert.js";

export const FLAG_SCOPE = "ddb-plutonium-scenes";

const DIR_DATA = "data";

const getParams = () => new Command()
	.requiredOption("--ddb <dir>", `Path to the "content" directory of a ddb-meta-data checkout.`)
	.requiredOption("--vet <dir>", `Path to the "data" directory of a 5etools-src checkout.`)
	.option("--report <file>", "Write a JSON report of every match decision.")
	.parse(process.argv)
	.opts();

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
 * Copy a matched DDB scene's lights and walls (where the entry has none) and its creatures onto
 * a scene repository entry.
 * @return {string[]} what was added
 */
const applyMatch = ({entry, match, source, ctx, stats}) => {
	const {scene, xf, framePlut} = match;
	const added = [];

	if (!entry.lights?.length && scene.lights.length) {
		const lights = convertLights({lights: scene.lights, xf, frameDdb: scene.frame, framePlut});
		if (lights.length) { entry.lights = lights; stats.lights += lights.length; stats.scenesLit++; added.push("lights"); }
	}

	if (!entry.walls?.length && scene.walls.length) {
		const walls = convertWalls({walls: scene.walls, xf, framePlut});
		if (walls.length) { entry.walls = walls; stats.walls += walls.length; stats.scenesWalled++; added.push("walls"); }
	}

	if (scene.tokens.length) {
		const tokens = convertTokens({tokens: scene.tokens, xf, frameDdb: scene.frame, framePlut, source, bestiary: ctx.bestiary, aliases: ctx.aliases});
		if (tokens.length) {
			entry.flags = {
				...entry.flags,
				[FLAG_SCOPE]: {...entry.flags?.[FLAG_SCOPE], tokens, ddbScene: scene.file},
			};
			stats.tokens += tokens.length; stats.scenesPopulated++; added.push("tokens");
		}
	}
	return added;
};

const getMatchReport = ({source, entry, match, added}) => ({
	source,
	name: entry.name,
	status: "matched",
	method: match.method,
	score: match.score && Number(match.score.toFixed(3)),
	scale: Number(match.xf.s.toFixed(4)),
	ddbScene: match.scene.file,
	added,
});

/**
 * A player image cropped differently from its DM map cannot take the DM data: match it against
 * the DDB scenes directly, as a map of its own (DDB often has a player scene of its own too).
 * @return {{added: string[], match: object}}
 */
const matchPlayerDirectly = ({entry, source, player, ctx, stats}) => {
	// Already matched as an entry of its own in the main pass
	if (!ctx.books?.size || entry.lights?.length || entry.flags?.[FLAG_SCOPE]?.tokens?.length) return {added: [], match: null};
	const candidates = getCandidates({entry, ddbScenes: ctx.ddbScenes, books: ctx.books});
	if (!candidates.length) return {added: [], match: null};
	const match = matchEntry({entry, vetMap: player, candidates});
	if (match.status !== "matched") return {added: [], match};
	return {added: applyMatch({entry, match, source, ctx, stats}), match};
};

/**
 * Plutonium imports a map's player version as its own scene and gives it side data by its own name
 * only, so a player scene would get no lights, walls or creatures. Copy the DM map's data onto it,
 * keeping anything the repository already has for the player version.
 * @return {string[]} what was added
 */
const addPlayerVersion = ({entriesByName, source, vetMap, player, ctx, stats}) => {
	if (!entriesByName.has(player.name)) entriesByName.set(player.name, {name: player.name, source});
	const entry = entriesByName.get(player.name);
	if (entry.isIgnored) return [];
	const added = [];

	if (!entry.flags?.[FLAG_SCOPE]?.folder && setFolder(entry, vetMap, {isPlayer: true})) { stats.scenesFoldered++; added.push("folder"); }

	const dm = entriesByName.get(vetMap.name);
	if (!dm) return [...added, ...matchPlayerDirectly({entry, source, player, ctx, stats}).added];
	const frameDm = getPlutFrame(vetMap);
	const framePlayer = getPlutFrame(player);
	const xf = getPlayerTransform({frameDm, framePlayer});
	if (!xf) {
		const direct = matchPlayerDirectly({entry, source, player, ctx, stats});
		return [...added, ...direct.added];
	}

	if (!entry.walls?.length && dm.walls?.length) {
		entry.walls = retargetWalls({walls: dm.walls, xf, framePlayer});
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
	const aliases = loadCreatureAliases(params.vet);
	const ddbScenes = loadDdbScenes(params.ddb);
	const bookSources = inferBookSources({ddbScenes, vetMaps});

	const fpathIndex = path.join(DIR_DATA, "foundry-index.json");
	const index = readJsonSync(fpathIndex);
	const report = [];
	const stats = {lights: 0, walls: 0, tokens: 0, scenesLit: 0, scenesWalled: 0, scenesPopulated: 0, scenesFoldered: 0, unmatched: 0};

	const sources = new Set([...Object.keys(index), ...vetMaps.map(m => m.source)]);
	for (const source of [...sources].sort()) {
		const books = bookSources.get(source);
		const ctx = {bestiary, aliases, ddbScenes, books};
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

			const added = applyMatch({entry, match, source, ctx, stats});
			report.push(getMatchReport({source, entry, match, added}));
			if (added.length) isChanged = true;
		}

		for (const vetMap of vetMapsForSource) {
			for (const player of vetMap.players ?? []) {
				const added = addPlayerVersion({entriesByName, source, vetMap, player, ctx, stats});
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
