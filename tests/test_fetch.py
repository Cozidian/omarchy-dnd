#!/usr/bin/env python3
"""Regression tests for Open5e refresh bounds and markup stripping."""

from __future__ import annotations

import importlib.util
import json
import unittest
import urllib.request
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
FETCH_PATH = ROOT / "scripts" / "fetch-srd.py"


def load_fetch():
    spec = importlib.util.spec_from_file_location("fetch_srd", FETCH_PATH)
    mod = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(mod)
    return mod


fetch = load_fetch()


class FakeHeaders(dict):
    def get(self, key, default=None):
        return super().get(key, default)


class BoundedReadTests(unittest.TestCase):
    def test_read_bounded_rejects_content_length(self):
        resp = SimpleNamespace(headers=FakeHeaders({"Content-Length": str(fetch.MAX_RESPONSE_BYTES + 1)}))
        with self.assertRaises(RuntimeError):
            fetch.read_bounded(resp)

    def test_read_bounded_stops_after_ceiling(self):
        payload = b"x" * (fetch.MAX_RESPONSE_BYTES + 50)

        class Resp:
            headers = FakeHeaders()

            def read(self, n):
                return payload[:n]

        with self.assertRaises(RuntimeError):
            fetch.read_bounded(Resp())

    def test_read_bounded_accepts_small_body(self):
        class Resp:
            headers = FakeHeaders({"Content-Length": "4"})

            def read(self, n):
                return b"{}"

        self.assertEqual(fetch.read_bounded(Resp()), b"{}")


class SanitizeTests(unittest.TestCase):
    def test_strips_html_img_and_keeps_text(self):
        dirty = 'Fireball <img src="https://evil.example/x.png"> explodes.'
        clean = fetch.sanitize_text(dirty, allow_newlines=False, max_chars=fetch.MAX_BODY_CHARS)
        self.assertNotIn("<", clean)
        self.assertNotIn("img", clean)
        self.assertIn("Fireball", clean)
        self.assertIn("explodes", clean)

    def test_strips_bidi_and_controls(self):
        dirty = "Prone\u202e\x1b<img src='http://127.0.0.1/'>end"
        clean = fetch.sanitize_text(dirty, allow_newlines=False, max_chars=120)
        self.assertEqual(clean, "Proneend")

    def test_truncates_long_strings(self):
        clean = fetch.sanitize_text("a" * 5000, allow_newlines=False, max_chars=fetch.MAX_NAME_CHARS)
        self.assertEqual(len(clean), fetch.MAX_NAME_CHARS)

    def test_entry_drops_markup_and_empty_names(self):
        row = fetch.entry(
            "spell",
            '<b>Fireball</b>',
            'Level 3 <img src="https://evil.example/e.png">',
            '<p>A bright streak.</p>\n<img src="file:///etc/passwd">',
            "spell <script>alert(1)</script>",
        )
        self.assertIsNotNone(row)
        self.assertEqual(row["name"], "Fireball")
        self.assertNotIn("<", row["summary"])
        self.assertNotIn("<", row["body"])
        self.assertNotIn("script", row["tags"])
        self.assertIn("bright streak", row["body"].lower())

    def test_entry_rejects_unknown_kind(self):
        self.assertIsNone(fetch.entry("wizard", "Name", "sum", "body", "tags"))

    def test_format_item_weapon_uses_nested_stats(self):
        row = {
            "name": "Dagger",
            "desc": "A dagger.",
            "category": {"name": "Weapon"},
            "cost": "2.00",
            "weight": "1.000",
            "weight_unit": "lb",
            "weapon": {
                "damage_dice": "1d4",
                "damage_type": {"name": "Piercing"},
                "properties": [
                    {
                        "property": {"name": "Finesse", "desc": "Use Str or Dex."},
                        "detail": None,
                    },
                    {
                        "property": {"name": "Thrown", "desc": "You can throw it."},
                        "detail": "Range 20/60",
                    },
                ],
            },
        }
        item = fetch.format_item(row)
        self.assertIsNotNone(item)
        self.assertEqual(item["kind"], "weapon")
        self.assertIn("1d4 Piercing", item["summary"])
        self.assertIn("Damage: 1d4 Piercing", item["body"])
        self.assertIn("Cost: 2 gp", item["body"])
        self.assertIn("Weight: 1 lb", item["body"])
        self.assertIn("Thrown (Range 20/60).", item["body"])
        self.assertNotIn("<", item["body"])

    def test_format_magic_keeps_rarity_and_attunement(self):
        row = {
            "name": '<b>Bag of Holding</b>',
            "desc": "<p>This bag is bigger inside.</p>",
            "category": {"name": "Wondrous Item"},
            "rarity": {"name": "Uncommon"},
            "requires_attunement": True,
            "attunement_detail": "",
            "cost": "0.00",
            "weight": "15.000",
            "weight_unit": "lb",
        }
        item = fetch.format_magic(row)
        self.assertIsNotNone(item)
        self.assertEqual(item["kind"], "magic")
        self.assertEqual(item["name"], "Bag of Holding")
        self.assertIn("Uncommon", item["summary"])
        self.assertIn("Rarity: Uncommon", item["body"])
        self.assertIn("Attunement: requires attunement", item["body"])
        self.assertIn("bigger inside", item["body"])
        self.assertNotIn("<", item["body"])

    def test_from_srd_filters_foreign_documents(self):
        self.assertTrue(fetch.from_srd({"name": "X"}))
        self.assertTrue(fetch.from_srd({"document": {"key": "srd-2024"}}))
        self.assertFalse(fetch.from_srd({"document": {"key": "vom"}}))
        self.assertFalse(fetch.from_srd({"document": {"key": "srd-2014"}}))

    def test_classify_armor_and_cost_text(self):
        self.assertEqual(fetch.cost_text("25.00"), "25 gp")
        self.assertEqual(fetch.cost_text("0.10"), "1 sp")
        self.assertEqual(fetch.cost_text("0.00"), "")
        armor = fetch.format_item({
            "name": "Plate Armor",
            "desc": "Heavy armor.",
            "category": {"name": "Armor"},
            "armor": {
                "ac_display": "18",
                "grants_stealth_disadvantage": True,
                "strength_score_required": 15,
            },
            "cost": "1500.00",
            "weight": "65.000",
            "weight_unit": "lb",
        })
        self.assertEqual(armor["kind"], "armor")
        self.assertIn("AC: 18", armor["body"])
        self.assertIn("Stealth: Disadvantage", armor["body"])
        self.assertIn("Strength: 15", armor["body"])


class RedirectTests(unittest.TestCase):
    def test_allowed_url_https_open5e_only(self):
        self.assertTrue(fetch.allowed_url("https://api.open5e.com/v2/spells/"))
        self.assertFalse(fetch.allowed_url("http://api.open5e.com/v2/spells/"))
        self.assertFalse(fetch.allowed_url("https://evil.example/v2/spells/"))
        self.assertFalse(fetch.allowed_url("https://127.0.0.1/v2/spells/"))
        self.assertFalse(fetch.allowed_url("file:///etc/passwd"))

    def test_redirect_handler_refuses_foreign_host_before_follow(self):
        handler = fetch.HostLimitedRedirectHandler()
        req = urllib.request.Request("https://api.open5e.com/v2/spells/")
        with self.assertRaises(RuntimeError) as raised:
            handler.redirect_request(req, None, 302, "Found", {}, "http://127.0.0.1/secret")
        self.assertIn("127.0.0.1", str(raised.exception))

    def test_redirect_handler_refuses_http_even_on_allowed_host(self):
        handler = fetch.HostLimitedRedirectHandler()
        req = urllib.request.Request("https://api.open5e.com/v2/spells/")
        with self.assertRaises(RuntimeError):
            handler.redirect_request(req, None, 301, "Moved", {}, "http://api.open5e.com/v2/spells/")


class ClampAndPageTests(unittest.TestCase):
    def test_clamp_value_caps_lists_and_strings(self):
        row = {
            "name": "x" * (fetch.MAX_ROW_STRING + 10),
            "actions": [{"name": "a"} for _ in range(fetch.MAX_LIST_ITEMS + 20)],
        }
        out = fetch.clamp_value(row)
        self.assertEqual(len(out["name"]), fetch.MAX_ROW_STRING)
        self.assertEqual(len(out["actions"]), fetch.MAX_LIST_ITEMS)

    def test_paginate_stops_at_page_and_entry_ceilings(self):
        calls = {"n": 0}

        def fake_get(path, params):
            calls["n"] += 1
            return {"results": [{"name": str(params["page"])}], "next": "https://api.open5e.com/v2/more"}

        with mock.patch.object(fetch, "get", fake_get), mock.patch.object(fetch.time, "sleep"):
            rows = fetch.paginate("/spells/", {"limit": 50})
        self.assertEqual(len(rows), fetch.MAX_PAGES)
        self.assertEqual(calls["n"], fetch.MAX_PAGES)
        self.assertLessEqual(len(rows), fetch.MAX_ENTRIES)


class SnapshotTests(unittest.TestCase):
    def test_checked_in_snapshot_is_within_ceilings(self):
        raw = (ROOT / "data" / "srd.json").read_bytes()
        self.assertLessEqual(len(raw), 4 * 1024 * 1024)
        payload = json.loads(raw.decode("utf-8"))
        entries = payload["entries"]
        self.assertLessEqual(len(entries), fetch.MAX_ENTRIES)
        self.assertGreater(len(entries), 100)
        for row in entries:
            self.assertLessEqual(len(row["name"]), fetch.MAX_NAME_CHARS)
            self.assertLessEqual(len(row.get("summary") or ""), fetch.MAX_SUMMARY_CHARS)
            self.assertLessEqual(len(row["body"]), fetch.MAX_BODY_CHARS)
            self.assertNotIn("<img", row["name"].lower())
            self.assertNotIn("<img", row["body"].lower())


if __name__ == "__main__":
    unittest.main()
