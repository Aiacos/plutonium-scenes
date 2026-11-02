import {test} from "node:test";
import assert from "node:assert/strict";
import {resolveCreatures} from "../convert.js";
import {BESTIARY, ddbToken} from "./helpers.js";

const resolve = (token, source, aliases) => resolveCreatures({token, source, bestiary: BESTIARY, aliases});
const name2024 = (...args) => resolve(...args)?.["2024"]?.name ?? null;

test("generic creatures pick the newest statblock of each edition", () => {
	assert.deepEqual(resolve(ddbToken("Goblin 3", "Goblin"), "LMoP"), {
		"2024": {name: "Goblin Warrior", source: "XMM"},
		"2014": {name: "Goblin", source: "MM"},
	});
});

test("a personal name on a generic statblock resolves to the book's NPC", () => {
	assert.deepEqual(resolve(ddbToken("Danika Martikov", "Commoner"), "CoS"), {
		"2024": {name: "Danika Dorakova", source: "CoS"},
		"2014": {name: "Danika Dorakova", source: "CoS"},
		npc: true,
	});
	assert.equal(name2024(ddbToken("Brom", "Commoner"), "CoS"), "Brom Martikov");
	assert.equal(name2024(ddbToken("Szoldar Szolarovich", "Scout"), "CoS"), "Szoldar Szoldarovich");
	assert.equal(name2024(ddbToken("Rudolph van Richten", "Noble"), "CoS"), "Rictavio");
});

test("DDB's own NPC name resolves through the nickname", () => {
	assert.equal(name2024(ddbToken("Rose Durst"), "CoS"), "Rosavalda \"Rose\" Durst");
});

test("unknown personal names keep the generic statblock", () => {
	assert.equal(name2024(ddbToken("Child", "Commoner"), "CoS"), "Commoner");
	assert.equal(resolve(ddbToken("Child", "Commoner"), "CoS").npc, undefined);
});

test("a name that is itself a creature only matches exactly", () => {
	assert.equal(name2024(ddbToken("Guard"), "CoS"), "Guard");
});

test("rejects false friends", () => {
	// Numbered names
	assert.equal(name2024(ddbToken("Prisoner 6", "Commoner"), "KftGV"), "Commoner");
	assert.equal(name2024(ddbToken("Prisoner 13"), "KftGV"), "Prisoner 13");
	// First words other books use
	assert.equal(name2024(ddbToken("King Groak", "Commoner"), "ToA"), "Commoner");
	assert.equal(name2024(ddbToken("Stone Giant of Deadstone Cleft"), "SKT"), "Deadstone Cleft Stone Giant");
});

test("plural names find the singular statblock", () => {
	assert.equal(name2024(ddbToken("Tribal Warrior Spore Servants"), "IDRotF"), "Tribal Warrior Spore Servant");
});

test("the book's own aliases win, but never for generic names", () => {
	const aliases = new Map([
		["oota", new Map([["princelivid", {name: "Gray Ooze", source: "MM"}]])],
		["cos", new Map([["commoner", {name: "Vistana Guard", source: "CoS"}]])],
	]);
	assert.deepEqual(resolve(ddbToken("Prince Livid"), "OotA", aliases), {
		"2024": {name: "Gray Ooze", source: "XMM"},
		"2014": {name: "Gray Ooze", source: "MM"},
	});
	assert.equal(name2024(ddbToken("Commoner"), "CoS", aliases), "Commoner");
});
