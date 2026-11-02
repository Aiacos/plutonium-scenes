import {test} from "node:test";
import assert from "node:assert/strict";
import {getCandidates, getMapNumber, getMatchSimilarity, isAgreeing, matchEntry} from "../match.js";

test("map numbers are read from the title prefix", () => {
	assert.equal(getMapNumber("Map 6.2: DM's Map"), "6.2");
	assert.equal(getMapNumber("MAP 1.2: DM’S MAP"), "1.2");
	assert.equal(getMapNumber("Map B.1: Death House"), "b.1");
	assert.equal(getMapNumber("Death House"), null);
});

test("different map numbers halve the similarity of ambiguous names only", () => {
	const isAmbiguous = true;
	assert.equal(getMatchSimilarity("Map 6.2: DM's Map", "Map 6.2: DM’s Map", {isAmbiguous}), 1);
	assert.equal(getMatchSimilarity("Map 6.2: DM's Map", "Map 2.2: DM’s Map", {isAmbiguous}), 0.5);
	// One side without a number: no penalty
	assert.equal(getMatchSimilarity("Map 12.1: Wizard of Wines Winery", "Wizard of Wines Winery", {isAmbiguous}), 1);
	// A map reprinted in another book under another number
	assert.equal(getMatchSimilarity("Map 3.1: Barovia", "Map 2.01: Barovia"), 1);
});

test("candidates: the right chapter's map wins among same-named scenes", () => {
	const scene = (name, book = "kftgv") => ({name, book});
	const ddbScenes = [scene("Map 2.2: DM’s Map"), scene("Map 6.2: DM’s Map"), scene("Map 6.1: Player Map")];
	const candidates = getCandidates({entry: {name: "Map 6.2: DM's map"}, ddbScenes, books: new Set(["kftgv"])});
	assert.equal(candidates[0].scene.name, "Map 6.2: DM’s Map");
	assert.equal(candidates[0].sim, 1);
	assert.equal(candidates.find(c => c.scene.name === "Map 2.2: DM’s Map").sim, 0.5);
});

test("registration agrees with the bounds transform within 1% scale and one cell", () => {
	const xf = {s: 0.9174, tx: -662, ty: -880};
	const framePlut = {gridSize: 72};
	assert.equal(isAgreeing({s: 0.9174, tx: -664, ty: -880}, xf, framePlut), true);
	assert.equal(isAgreeing({s: 0.2452, tx: 286, ty: 364}, xf, framePlut), false);
	assert.equal(isAgreeing({s: 0.9174, tx: -500, ty: -880}, xf, framePlut), false);
	assert.equal(isAgreeing(null, xf, framePlut), false);
});

/** A DDB scene frame with no padding, so the bounds transform is a pure scale. */
const ddbScene = ({name, width, height, walls = [], tokens = []}) => ({
	name,
	file: `${name}.json`,
	walls,
	lights: [],
	tokens,
	frame: {width, height, gridSize: 100, padX: 0, padY: 0, offsetX: 0, offsetY: 0},
});
const vetMap = {width: 1000, height: 500, grid: {size: 50}};

test("no walls anywhere: bounds needs a contained name and the same shape", () => {
	const near = {scene: ddbScene({name: "Ruins of Berez", width: 2000, height: 1000}), sim: 0.8};
	const far = {scene: ddbScene({name: "Something Else", width: 2000, height: 1000}), sim: 0.76};
	const otherShape = {scene: ddbScene({name: "Ruins of Berez", width: 2000, height: 2000}), sim: 1};
	assert.equal(matchEntry({entry: {name: "The Ruins of Berez"}, vetMap, candidates: [near]}).method, "bounds");
	assert.equal(matchEntry({entry: {name: "The Ruins of Berez"}, vetMap, candidates: [far]}).status, "unmatched");
	assert.equal(matchEntry({entry: {name: "The Ruins of Berez"}, vetMap, candidates: [otherShape]}).status, "unmatched");
});

test("matching walls register; bounds transform equals the image scale", () => {
	const room = [[0, 0, 1600, 0], [1600, 0, 1600, 800], [1600, 800, 0, 800], [0, 800, 0, 0], [800, 0, 800, 400], [400, 400, 1200, 400]];
	const scene = ddbScene({name: "Keep", width: 2000, height: 1000, walls: room.map(c => ({c}))});
	const entry = {name: "Keep", walls: room.map(c => ({c: c.map(v => v / 2)}))};
	const match = matchEntry({entry, vetMap, candidates: [{scene, sim: 1}]});
	assert.equal(match.status, "matched");
	assert.ok(Math.abs(match.xf.s - 0.5) < 0.01);
});
