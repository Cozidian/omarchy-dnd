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

const tests = [
  testParseRejectsOversizedRaw,
  testParseCapsEntries,
  testParseStripsMarkup,
  testSearchDoesNotScanPastHaystack,
  testFilterUsesNameAndBoundedHaystack,
  testSnapshotParsesUnderCaps,
  testSanitizeFilterCapsAndStrips,
  testCopyTextIsPlainAndDropsEmpty
];

for (const fn of tests)
  fn();

console.log("ok", tests.length, "tests");
