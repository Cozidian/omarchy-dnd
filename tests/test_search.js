#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const assert = require("assert");

const root = path.join(__dirname, "..");
const src = fs.readFileSync(path.join(root, "Search.js"), "utf8").replace(/^\.pragma library\s*/, "");
const ctx = {};
vm.createContext(ctx);
vm.runInContext(src, ctx);

function indexOf(entries) {
  return {
    version: 1,
    entries: entries
  };
}

function testParseRejectsOversizedRaw() {
  const raw = "x".repeat(ctx.MAX_INDEX_BYTES + 1);
  const out = ctx.parseIndex(raw);
  assert.strictEqual(out.length, 0);
}

function testParseCapsEntries() {
  const entries = [];
  for (let i = 0; i < ctx.MAX_ENTRIES + 25; i++)
    entries.push({ kind: "spell", name: "Spell " + i, summary: "s", body: "body " + i, tags: "spell" });
  const out = ctx.parseIndex(JSON.stringify(indexOf(entries)));
  assert.strictEqual(out.length, ctx.MAX_ENTRIES);
}

function testParseStripsMarkup() {
  const out = ctx.parseIndex(JSON.stringify(indexOf([{
    kind: "spell",
    name: '<img src="https://evil.example/x.png">Fireball',
    summary: "Level 3 <b>evocation</b>",
    body: '<p>A bright streak</p><img src="file:///etc/passwd">',
    tags: "spell <script>alert(1)</script>"
  }])));
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].name, "Fireball");
  assert.ok(!out[0].summary.includes("<"));
  assert.ok(!out[0].body.includes("<"));
  assert.ok(!out[0].body.includes("img"));
  assert.ok(!out[0].haystack.includes("<img"));
  assert.ok(out[0].haystack.includes("fireball"));
}

function testSearchDoesNotScanPastHaystack() {
  const needle = "uniquesecretxyz";
  const body = "a".repeat(ctx.MAX_HAYSTACK_CHARS + 50) + needle;
  const out = ctx.parseIndex(JSON.stringify(indexOf([{
    kind: "spell",
    name: "Decoy",
    summary: "s",
    body: body,
    tags: "spell"
  }])));
  assert.strictEqual(out.length, 1);
  assert.ok(!out[0].haystack.includes(needle));
  const hits = ctx.filterEntries(out, needle, 80);
  assert.strictEqual(hits.length, 0);
}

function testFilterUsesNameAndBoundedHaystack() {
  const out = ctx.parseIndex(JSON.stringify(indexOf([
    { kind: "spell", name: "Fireball", summary: "Level 3 Evocation", body: "A bright streak flashes.", tags: "fireball spell evocation" },
    { kind: "monster", name: "Goblin", summary: "Small Humanoid", body: "A goblin.", tags: "goblin monster" }
  ])));
  const fire = ctx.filterEntries(out, "fireball", 80);
  assert.strictEqual(fire.length, 1);
  assert.strictEqual(fire[0].name, "Fireball");
}

function testSnapshotParsesUnderCaps() {
  const raw = fs.readFileSync(path.join(root, "data", "srd.json"), "utf8");
  assert.ok(raw.length <= ctx.MAX_INDEX_BYTES);
  const entries = ctx.parseIndex(raw);
  assert.ok(entries.length > 100);
  assert.ok(entries.length <= ctx.MAX_ENTRIES);
  const prone = ctx.filterEntries(entries, "prone", 80);
  assert.ok(prone.length >= 1);
  assert.strictEqual(prone[0].name.toLowerCase().includes("prone") || prone[0].haystack.includes("prone"), true);
  for (const row of entries) {
    assert.ok(row.name.length <= ctx.MAX_NAME_CHARS);
    assert.ok(row.body.length <= ctx.MAX_BODY_CHARS);
    assert.ok(row.haystack.length <= ctx.MAX_HAYSTACK_CHARS);
  }
}

function testSanitizeFilterCapsAndStrips() {
  const cleaned = ctx.sanitizeFilter('<img src="x">  foo  ' + "y".repeat(500));
  assert.ok(!cleaned.includes("<"));
  assert.ok(cleaned.length <= ctx.MAX_FILTER_CHARS);
  assert.ok(cleaned.startsWith("foo"));
}

function testCopyTextIsPlainAndDropsEmpty() {
  const text = ctx.copyText({ kind: "spell", name: "Fireball", body: "A bright streak." });
  assert.ok(text.indexOf("Fireball") === 0);
  assert.ok(text.indexOf("A bright streak.") !== -1);
  assert.strictEqual(ctx.copyText(null), "");
  assert.strictEqual(ctx.copyText({ kind: "spell", name: "", body: "x" }), "");
}

function testBodyBlocksParseMultilineTable() {
  const body = [
    "Add your Proficiency Bonus.",
    "",
    "Table: Skills",
    "",
    "|Skill|Ability|Example Uses|",
    "|---|---|---|",
    "|Acrobatics|Dexterity|Stay on your feet.|",
    "|Stealth|Dexterity|Escape notice.|",
    "",
    "## Skill Lists",
    "",
    "The skills are shown on the Skills table."
  ].join("\n");
  const blocks = ctx.bodyBlocks(body);
  const kinds = Array.prototype.map.call(blocks, b => String(b.kind));
  assert.strictEqual(kinds.join(","), "text,table,heading,text");
  assert.ok(String(blocks[0].text).includes("Proficiency Bonus"));
  assert.strictEqual(String(blocks[1].caption), "Skills");
  assert.strictEqual(Number(blocks[1].colCount), 3);
  assert.strictEqual(String(blocks[1].headers[0]), "Skill");
  assert.strictEqual(blocks[1].rows.length, 2);
  assert.strictEqual(String(blocks[1].rows[0][0]), "Acrobatics");
  assert.strictEqual(String(blocks[1].rows[1][1]), "Dexterity");
  assert.strictEqual(String(blocks[2].text), "Skill Lists");
  assert.ok(String(blocks[3].text).includes("Skills table"));
}

function testBodyBlocksExpandCollapsedTables() {
  const body = "The GM chooses the omen from the Omens table. Table: Omens | Omen | For Results That Will Be … | |--------------|----------------------------| | Weal | Good | | Woe | Bad | | Indifference | Neither good nor bad | The spell doesn't account for circumstances.";
  const blocks = ctx.bodyBlocks(body);
  const tables = blocks.filter(b => b.kind === "table");
  assert.strictEqual(tables.length, 1);
  assert.strictEqual(tables[0].caption, "Omens");
  assert.strictEqual(tables[0].colCount, 2);
  assert.strictEqual(tables[0].headers[0], "Omen");
  assert.strictEqual(tables[0].rows.length, 3);
  assert.strictEqual(tables[0].rows[0][0], "Weal");
  assert.strictEqual(tables[0].rows[2][0], "Indifference");
  const text = blocks.filter(b => b.kind === "text").map(b => b.text).join("\n");
  assert.ok(text.includes("Omens table"));
  assert.ok(text.includes("doesn't account"));
  assert.ok(!text.includes("| Weal |"));
}

function testBodyBlocksChainedCollapsedTables() {
  const body = "Change its stage by one. Table: Precipitation | Stage | Condition | |-------|-----------| | 1 | Clear | | 2 | Rain | Table: Wind | Stage | Condition | |-------|-----------| | 1 | Calm | | 2 | Gale |";
  const tables = ctx.bodyBlocks(body).filter(b => b.kind === "table");
  assert.strictEqual(tables.length, 2);
  assert.strictEqual(tables[0].caption, "Precipitation");
  assert.strictEqual(tables[0].rows[1][1], "Rain");
  assert.strictEqual(tables[1].caption, "Wind");
  assert.strictEqual(tables[1].rows[1][1], "Gale");
}

function testBodyBlocksIgnorePipesWithoutSeparator() {
  const blocks = ctx.bodyBlocks("Choose Strength | Dexterity | Constitution and roll.");
  assert.strictEqual(blocks.length, 1);
  assert.strictEqual(blocks[0].kind, "text");
  assert.ok(blocks[0].text.includes("Strength | Dexterity"));
}

function testTableCellAndCopyFormatting() {
  const body = "|Score|Modifier|\n|---|---|\n|1|−5|\n|10–11|+0|";
  const blocks = ctx.bodyBlocks(body);
  assert.strictEqual(blocks[0].kind, "table");
  const headersJson = JSON.stringify(blocks[0].headers);
  const rowsJson = JSON.stringify(blocks[0].rows);
  assert.strictEqual(ctx.tableCell(headersJson, rowsJson, 0, 0), "Score");
  assert.strictEqual(ctx.tableCell(headersJson, rowsJson, 1, 1), "−5");
  const copied = ctx.copyText({ kind: "rule", name: "Ability Modifiers", body: body });
  assert.ok(copied.indexOf("Ability Modifiers") === 0);
  assert.ok(copied.includes("Score"));
  assert.ok(copied.includes("−5"));
  assert.ok(!copied.includes("|---|"));
}

function testBodyBlocksParseConditionList() {
  const body = [
    "While you have the Blinded condition, you experience the following effects.",
    " * Can’t See. You can’t see and automatically fail any ability check that requires sight.",
    " * Attacks Affected. Attack rolls against you have Advantage."
  ].join("\n");
  const blocks = ctx.bodyBlocks(body);
  const kinds = Array.prototype.map.call(blocks, b => String(b.kind)).join(",");
  assert.strictEqual(kinds, "text,list");
  assert.ok(String(blocks[0].text).includes("Blinded condition"));
  assert.strictEqual(blocks[1].items.length, 2);
  assert.strictEqual(String(blocks[1].items[0].label), "Can’t See.");
  assert.ok(String(blocks[1].items[0].body).includes("can’t see"));
  assert.strictEqual(String(blocks[1].items[1].label), "Attacks Affected.");
  const copied = ctx.copyText({ kind: "condition", name: "Blinded", body: body });
  assert.ok(copied.includes("• Can’t See."));
  assert.ok(!copied.includes(" * Can’t"));
}

function testBodyBlocksParseDashAndNumberedLists() {
  const dash = ctx.bodyBlocks([
    "Choose the command from these options:",
    "",
    "- **Drop.** The target drops whatever it is holding.",
    "- **Flee.** The target spends its turn moving away from you."
  ].join("\n"));
  const dashList = Array.prototype.filter.call(dash, b => b.kind === "list")[0];
  assert.ok(dashList);
  assert.strictEqual(dashList.items.length, 2);
  assert.strictEqual(String(dashList.items[0].label), "Drop.");
  assert.ok(String(dashList.items[1].body).includes("moving away"));

  const numbered = ctx.bodyBlocks([
    "1. **Choose a Target.** Pick a target within range.",
    "2. **Determine Modifiers.** The GM determines cover.",
    "3. **Resolve the Attack.** Make the attack roll."
  ].join("\n"));
  const numList = Array.prototype.filter.call(numbered, b => b.kind === "list")[0];
  assert.ok(numList);
  assert.strictEqual(!!numList.ordered, true);
  assert.strictEqual(numList.items.length, 3);
  assert.strictEqual(String(numList.items[0].marker), "1");
  assert.strictEqual(String(numList.items[2].label), "Resolve the Attack.");
}

function testBodyBlocksParseQuoteStatsAndHigher() {
  const quoted = ctx.bodyBlocks([
    "An ability modifier is derived from its score.",
    "",
    "> **Round Down**",
    "> Whenever you divide or multiply a number in the game, round down."
  ].join("\n"));
  const quote = Array.prototype.filter.call(quoted, b => b.kind === "quote")[0];
  assert.ok(quote);
  assert.strictEqual(String(quote.caption), "Round Down");
  assert.ok(String(quote.text).includes("round down"));

  const spell = ctx.bodyBlocks([
    "Level 3 Evocation",
    "Casting time: action",
    "Range: 150 feet",
    "Duration: instantaneous",
    "Components: V, S, M (a ball of bat guano and sulfur)",
    "Classes: Sorcerer, Wizard",
    "",
    "A bright streak flashes from you.",
    "",
    "At higher levels. The damage increases by 1d6."
  ].join("\n"));
  const kinds = Array.prototype.map.call(spell, b => String(b.kind)).join(",");
  assert.strictEqual(kinds, "stats,text,quote");
  assert.strictEqual(spell[0].rows.length, 6);
  assert.strictEqual(String(spell[0].rows[1].label), "Casting time");
  assert.strictEqual(String(spell[2].caption), "At higher levels");
}

function testSnapshotListsParse() {
  const raw = fs.readFileSync(path.join(root, "data", "srd.json"), "utf8");
  const entries = ctx.parseIndex(raw);
  const blinded = entries.find(e => e.name === "Blinded");
  assert.ok(blinded);
  const blindedList = ctx.bodyBlocks(blinded.body).filter(b => b.kind === "list")[0];
  assert.ok(blindedList);
  assert.ok(blindedList.items.some(it => String(it.label).indexOf("Can’t See") === 0));
  const alert = entries.find(e => e.name === "Alert");
  assert.ok(alert);
  const alertList = ctx.bodyBlocks(alert.body).filter(b => b.kind === "list")[0];
  assert.ok(alertList);
  assert.ok(alertList.items.length >= 2);
}

function testSnapshotTablesParse() {
  const raw = fs.readFileSync(path.join(root, "data", "srd.json"), "utf8");
  const entries = ctx.parseIndex(raw);
  let tableEntries = 0;
  let tableBlocks = 0;
  for (const row of entries) {
    if (!/\|[\s]*:?-{2,}/.test(row.body))
      continue;
    tableEntries++;
    const tables = ctx.bodyBlocks(row.body).filter(b => b.kind === "table");
    assert.ok(tables.length >= 1, row.name + " should parse a table");
    for (const table of tables) {
      tableBlocks++;
      assert.ok(table.colCount >= 2, row.name);
      assert.ok(table.rows.length >= 1, row.name);
      assert.strictEqual(table.headers.length, table.colCount, row.name);
      assert.strictEqual(table.weights.length, table.colCount, row.name);
    }
  }
  assert.ok(tableEntries >= 10, "expected several snapshot tables");
  assert.ok(tableBlocks >= 12, "expected parsed snapshot tables");
  const skills = entries.find(e => e.name === "Skill Proficiencies");
  assert.ok(skills);
  const skillTables = ctx.bodyBlocks(skills.body).filter(b => b.kind === "table");
  assert.strictEqual(skillTables.length, 1);
  assert.strictEqual(skillTables[0].caption, "Skills");
  assert.ok(skillTables[0].rows.some(r => r[0] === "Acrobatics"));
  assert.ok(skillTables[0].rows.some(r => r[0] === "Stealth"));
}

const tests = [
  testParseRejectsOversizedRaw,
  testParseCapsEntries,
  testParseStripsMarkup,
  testSearchDoesNotScanPastHaystack,
  testFilterUsesNameAndBoundedHaystack,
  testSnapshotParsesUnderCaps,
  testSanitizeFilterCapsAndStrips,
  testCopyTextIsPlainAndDropsEmpty,
  testBodyBlocksParseMultilineTable,
  testBodyBlocksExpandCollapsedTables,
  testBodyBlocksChainedCollapsedTables,
  testBodyBlocksIgnorePipesWithoutSeparator,
  testTableCellAndCopyFormatting,
  testBodyBlocksParseConditionList,
  testBodyBlocksParseDashAndNumberedLists,
  testBodyBlocksParseQuoteStatsAndHigher,
  testSnapshotListsParse,
  testSnapshotTablesParse
];

for (const fn of tests)
  fn();

console.log("ok", tests.length, "tests");
