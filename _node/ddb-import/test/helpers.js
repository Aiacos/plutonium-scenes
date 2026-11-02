import {normName} from "../loaders.js";

/** A bestiary shaped like `loadVetoolsBestiary`'s: normalised name -> entries. */
export const makeBestiary = creatures => {
	const out = new Map();
	for (const c of creatures) {
		const k = normName(c.name);
		if (!out.has(k)) out.set(k, []);
		out.get(k).push(c);
	}
	return out;
};

/** A DDB token as found in ddb-meta-data scenes. */
export const ddbToken = (name, ddbName = name) => ({name, flags: {ddbActorFlags: {name: ddbName}}});

export const BESTIARY = makeBestiary([
	{name: "Commoner", source: "MM", published: "2014-09-30"},
	{name: "Commoner", source: "XMM", published: "2025-02-18"},
	{name: "Goblin", source: "MM", published: "2014-09-30", reprintedAs: ["Goblin Warrior|XMM"]},
	{name: "Goblin Warrior", source: "XMM", published: "2025-02-18"},
	{name: "Gray Ooze", source: "MM", published: "2014-09-30"},
	{name: "Gray Ooze", source: "XMM", published: "2025-02-18"},
	{name: "Guard", source: "MM", published: "2014-09-30"},
	{name: "Stone Giant", source: "MM", published: "2014-09-30"},
	{name: "Danika Dorakova", source: "CoS", published: "2016-03-15"},
	{name: "Brom Martikov", source: "CoS", published: "2016-03-15"},
	{name: "Urwin Martikov", source: "CoS", published: "2016-03-15"},
	{name: "Rosavalda \"Rose\" Durst", source: "CoS", published: "2016-03-15"},
	{name: "Szoldar Szoldarovich", source: "CoS", published: "2016-03-15"},
	{name: "Vistana Guard", source: "CoS", published: "2016-03-15"},
	{name: "Rictavio", source: "CoS", published: "2016-03-15", alias: ["Rudolph van Richten"]},
	{name: "Prisoner 13", source: "KftGV", published: "2023-05-16"},
	{name: "King of Feathers", source: "ToA", published: "2017-09-19"},
	{name: "The Pudding King", source: "OotA", published: "2015-09-15"},
	{name: "Stone Giant Statue", source: "SKT", published: "2016-09-06"},
	{name: "Deadstone Cleft Stone Giant", source: "SKT", published: "2016-09-06"},
	{name: "Tribal Warrior Spore Servant", source: "IDRotF", published: "2020-09-15"},
]);
