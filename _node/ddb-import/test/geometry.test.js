import {test} from "node:test";
import assert from "node:assert/strict";
import {clipSegment, getImageRect, getPlayerTransform, retargetWalls} from "../convert.js";
import {registerWalls, scoreTransform} from "../geometry.js";

const RECT = [0, 0, 1000, 500];

test("clipSegment keeps, trims or drops walls", () => {
	assert.deepEqual(clipSegment([10, 10, 200, 10], RECT), [10, 10, 200, 10]);
	assert.deepEqual(clipSegment([-100, 100, 100, 100], RECT), [0, 100, 100, 100]);
	assert.deepEqual(clipSegment([500, -50, 500, 600], RECT), [500, 0, 500, 500]);
	assert.equal(clipSegment([-100, -100, -10, -10], RECT), null);
	assert.equal(clipSegment([1100, 0, 1100, 500], RECT), null);
});

test("the image rect follows Plutonium's grid offset, with half a cell of margin", () => {
	assert.deepEqual(getImageRect({width: 1000, height: 500, gridSize: 100, gridOffsetX: 20, gridOffsetY: 10}), [-70, -60, 1030, 540]);
	assert.equal(getImageRect({width: null, height: null, gridSize: 100, gridOffsetX: 0, gridOffsetY: 0}), null);
});

test("player versions: rescale same-aspect images, refuse other crops", () => {
	const frameDm = {width: 1000, height: 615, gridSize: 50, gridOffsetX: 0, gridOffsetY: 0};
	const framePlayer = {width: 1950, height: 1200, gridSize: 98, gridOffsetX: 5, gridOffsetY: 0};
	const xf = getPlayerTransform({frameDm, framePlayer});
	assert.equal(xf.s, 1.95);
	assert.equal(xf.tx, -5);
	assert.equal(getPlayerTransform({frameDm, framePlayer: {...framePlayer, height: 1950}}), null);
	// Walls past the player image are trimmed to it
	const walls = retargetWalls({walls: [{c: [0, 100, 2000, 100]}], xf, framePlayer});
	assert.deepEqual(walls[0].c, [-5, 195, 1994, 195]); // image right edge 1950 - 5, plus half a 98px cell
});

/** A room with an inner wall, in DDB coordinates, and the same room at half scale, shifted. */
const ROOM = [[0, 0, 400, 0], [400, 0, 400, 300], [400, 300, 0, 300], [0, 300, 0, 0], [200, 0, 200, 150]].map(c => ({c}));
const ROOM_PLUT = ROOM.map(({c}) => ({c: [c[0] / 2 + 30, c[1] / 2 + 40, c[2] / 2 + 30, c[3] / 2 + 40]}));

test("wall registration recovers scale and offset", () => {
	const reg = registerWalls({wallsDdb: ROOM, wallsPlut: ROOM_PLUT, scaleHints: [0.5], gridPlut: 50});
	assert.ok(reg.score > 0.9);
	assert.ok(Math.abs(reg.s - 0.5) < 0.01);
	assert.ok(Math.abs(reg.tx - 30) < 2 && Math.abs(reg.ty - 40) < 2);
});

test("scoreTransform tells a right transform from a wrong one", () => {
	const right = scoreTransform({wallsDdb: ROOM, wallsPlut: ROOM_PLUT, xf: {s: 0.5, tx: 30, ty: 40}, gridPlut: 50});
	const wrong = scoreTransform({wallsDdb: ROOM, wallsPlut: ROOM_PLUT, xf: {s: 0.5, tx: 130, ty: 140}, gridPlut: 50});
	assert.ok(right.score > 0.9);
	assert.ok(wrong.score < 0.5);
});
