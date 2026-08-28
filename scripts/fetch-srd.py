#!/usr/bin/env python3
"""Snapshot SRD 5.2 (2024 / '5.5') text from Open5e into a compact search index."""

from __future__ import annotations

import json
import re
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

BASE = "https://api.open5e.com/v2"
ALLOWED_HOST = "api.open5e.com"
DOC = "srd-2024"
UA = "omarchy-dnd-srd-lookup/1.0 (https://github.com/Cozidian/omarchy-dnd)"
KINDS = frozenset({"spell", "monster", "condition", "rule", "feat"})

MAX_RESPONSE_BYTES = 2 * 1024 * 1024
MAX_PAGES = 40
MAX_ENTRIES = 4000
MAX_NAME_CHARS = 120
MAX_SUMMARY_CHARS = 280
MAX_BODY_CHARS = 16 * 1024
MAX_TAGS_CHARS = 240
MAX_ROW_STRING = 32 * 1024
MAX_LIST_ITEMS = 64
MAX_OBJECT_KEYS = 64
MAX_DEPTH = 8

_COMMENT_RE = re.compile(r"<!--.*?-->", re.DOTALL)
_TAG_RE = re.compile(r"<[^>]*>")
_INCOMPLETE_TAG_RE = re.compile(r"<[^>]*$")


def allowed_url(url: str) -> bool:
    parsed = urllib.parse.urlparse(url)
    return parsed.scheme == "https" and parsed.hostname == ALLOWED_HOST


class HostLimitedRedirectHandler(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        if not allowed_url(newurl):
            raise RuntimeError(f"refusing redirect to {newurl}")
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def opener() -> urllib.request.OpenerDirector:
    return urllib.request.build_opener(HostLimitedRedirectHandler)


def read_bounded(resp, max_bytes: int = MAX_RESPONSE_BYTES) -> bytes:
    length = resp.headers.get("Content-Length")
    if length is not None:
        try:
            declared = int(length)
        except ValueError:
            declared = -1
        if declared > max_bytes:
            raise RuntimeError(f"response Content-Length {declared} exceeds {max_bytes} byte ceiling")
    data = resp.read(max_bytes + 1)
    if len(data) > max_bytes:
        raise RuntimeError(f"response exceeds {max_bytes} byte ceiling")
    return data


def get(path: str, params: dict) -> dict:
    query = urllib.parse.urlencode(params, doseq=True)
    url = f"{BASE}{path}?{query}"
    if not allowed_url(url):
        raise RuntimeError(f"refusing URL {url}")
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
    with opener().open(req, timeout=60) as resp:
        if not allowed_url(resp.geturl()):
            raise RuntimeError(f"refusing redirected URL {resp.geturl()}")
        payload = json.loads(read_bounded(resp).decode("utf-8"))
    if not isinstance(payload, dict):
        raise RuntimeError("Open5e response is not an object")
    return payload


def clamp_value(value, depth: int = 0):
    if depth > MAX_DEPTH:
        return None
    if value is None or isinstance(value, (bool, int, float)):
        return value
    if isinstance(value, str):
        return value[:MAX_ROW_STRING]
    if isinstance(value, list):
        return [clamp_value(item, depth + 1) for item in value[:MAX_LIST_ITEMS]]
    if isinstance(value, dict):
        out = {}
        for i, (key, item) in enumerate(value.items()):
            if i >= MAX_OBJECT_KEYS:
                break
            out[str(key)[:64]] = clamp_value(item, depth + 1)
        return out
    return None


def paginate(path: str, params: dict) -> list:
    params = dict(params)
    params.setdefault("limit", 50)
    out = []
    page = 1
    while page <= MAX_PAGES and len(out) < MAX_ENTRIES:
        params["page"] = page
        payload = get(path, params)
        rows = payload.get("results") or []
        if not isinstance(rows, list) or not rows:
            break
        for row in rows:
            if len(out) >= MAX_ENTRIES:
                break
            if not isinstance(row, dict):
                continue
            clamped = clamp_value(row)
            if isinstance(clamped, dict):
                out.append(clamped)
        if not payload.get("next"):
            break
        page += 1
        time.sleep(0.15)
    return out


def sanitize_text(value, *, allow_newlines: bool, max_chars: int) -> str:
    text = str(value or "")
    text = _COMMENT_RE.sub("", text)
    text = _TAG_RE.sub("", text)
    text = _INCOMPLETE_TAG_RE.sub("", text)
    cleaned = []
    for ch in text:
        code = ord(ch)
        if code in (0x09, 0x0A, 0x0D):
            if allow_newlines:
                cleaned.append("\n" if code != 0x09 else " ")
            continue
        if code < 0x20 or 0x7F <= code <= 0x9F:
            continue
        if code in (0x200B, 0x200C, 0x200D, 0x200E, 0x200F):
            continue
        if 0x202A <= code <= 0x202E:
            continue
        if 0x2066 <= code <= 0x2069:
            continue
        if code in (0xFEFF, 0xFFF9, 0xFFFA, 0xFFFB, 0xFFFC):
            continue
        cleaned.append(ch)
    text = "".join(cleaned)
    if allow_newlines:
        text = re.sub(r"\n{3,}", "\n\n", text).strip()
    else:
        text = " ".join(text.split())
    if len(text) > max_chars:
        text = text[:max_chars]
    return text


def pick_desc(descriptions: list, document: str = DOC) -> str:
    if not descriptions:
        return ""
    for row in descriptions:
        if row.get("document") == document:
            return str(row.get("desc") or "").strip()
    return str(descriptions[0].get("desc") or "").strip()


def speed_text(speed: dict | None) -> str:
    if not isinstance(speed, dict):
        return ""
    unit = speed.get("unit") or "ft."
    if unit in ("feet", "ft"):
        unit = "ft."
    bits = []
    for key in ("walk", "fly", "swim", "climb", "burrow", "hover"):
        val = speed.get(key)
        if val in (None, False, 0, "0"):
            continue
        if key == "hover" and val:
            bits.append("hover")
            continue
        label = "" if key == "walk" else f"{key} "
        bits.append(f"{label}{val} {unit}")
    return ", ".join(bits)


def action_block(title: str, actions: list) -> str:
    if not actions:
        return ""
    lines = [title]
    for act in actions:
        name = str(act.get("name") or "").strip()
        desc = str(act.get("desc") or "").strip()
        if not name:
            continue
        lines.append(f"{name}. {desc}" if desc else name)
    return "\n".join(lines)


def format_spell(row: dict) -> dict:
    level = row.get("level")
    if level in (0, "0", None):
        level_label = "Cantrip"
    else:
        level_label = f"Level {level}"
    school = (row.get("school") or {}).get("name") or ""
    parts = [
        f"{level_label} {school}".strip(),
        f"Casting time: {row.get('casting_time') or '—'}",
        f"Range: {row.get('range_text') or '—'}",
        f"Duration: {row.get('duration') or '—'}",
    ]
    flags = []
    if row.get("concentration"):
        flags.append("concentration")
    if row.get("ritual"):
        flags.append("ritual")
    comps = []
    if row.get("verbal"):
        comps.append("V")
    if row.get("somatic"):
        comps.append("S")
    if row.get("material"):
        comps.append("M")
    if comps:
        material = row.get("material_specified") or ""
        parts.append("Components: " + ", ".join(comps) + (f" ({material})" if material else ""))
    if flags:
        parts.append(" · ".join(flags))
    classes = [c.get("name") for c in (row.get("classes") or []) if c.get("name")]
    if classes:
        parts.append("Classes: " + ", ".join(classes))
    body = str(row.get("desc") or "").strip()
    higher = str(row.get("higher_level") or "").strip()
    if higher:
        body = body + "\n\nAt higher levels. " + higher
    summary = f"{level_label} {school}".strip()
    name = row.get("name") or ""
    tags = " ".join([name, summary, "spell", school] + classes).lower()
    return entry("spell", name, summary, "\n".join(parts) + "\n\n" + body, tags)


def format_monster(row: dict) -> dict:
    size = (row.get("size") or {}).get("name") or ""
    typ = (row.get("type") or {}).get("name") or ""
    cr = row.get("challenge_rating_text") or row.get("challenge_rating")
    cr_text = f"CR {cr}" if cr not in (None, "") else ""
    summary_bits = [b for b in [size, typ, cr_text] if b]
    summary = ", ".join(summary_bits)
    lines = [summary] if summary else []
    ac = row.get("armor_class")
    hp = row.get("hit_points")
    combat = []
    if ac not in (None, ""):
        combat.append(f"AC {ac}")
    if hp not in (None, ""):
        combat.append(f"HP {hp}")
    spd = speed_text(row.get("speed"))
    if spd:
        combat.append(f"Speed {spd}")
    if combat:
        lines.append(" · ".join(combat))
    actions = row.get("actions") or []
    traits = row.get("traits") or []
    trait_actions = [a for a in actions if str(a.get("action_type") or "") == "TRAIT"]
    real_actions = [a for a in actions if str(a.get("action_type") or "") in ("", "ACTION", "None")]
    bonus = [a for a in actions if "BONUS" in str(a.get("action_type") or "")]
    reactions = [a for a in actions if "REACTION" in str(a.get("action_type") or "")]
    legendary = [a for a in actions if "LEGENDARY" in str(a.get("action_type") or "")]
    if not real_actions:
        real_actions = [a for a in actions if a not in legendary + bonus + reactions + trait_actions]
    chunks = [
        action_block("Traits", (traits or []) + trait_actions),
        action_block("Actions", real_actions),
        action_block("Bonus actions", bonus),
        action_block("Reactions", reactions),
        action_block("Legendary actions", legendary),
    ]
    for chunk in chunks:
        if chunk:
            lines.append("")
            lines.append(chunk)
    name = row.get("name") or ""
    tags = " ".join([name, summary, "monster", "creature", typ, size, cr_text]).lower()
    return entry("monster", name, summary or "Monster", "\n".join(lines).strip(), tags)


def format_condition(row: dict) -> dict | None:
    name = row.get("name") or ""
    if not name:
        return None
    body = ""
    for item in row.get("descriptions") or []:
        if item.get("document") == DOC:
            body = str(item.get("desc") or "").strip()
            break
    if not body:
        return None
    first = body.split("\n", 1)[0].strip(" *")
    return entry("condition", name, first[:140], body, f"{name} condition")


def format_rule(row: dict) -> dict:
    name = row.get("name") or ""
    body = str(row.get("desc") or "").strip()
    first = body.split("\n", 1)[0][:140]
    return entry("rule", name, first, body, f"{name} rule")


def format_feat(row: dict) -> dict | None:
    name = row.get("name") or ""
    if not name:
        return None
    bits = []
    feat_type = str(row.get("type") or "").strip()
    prereq = str(row.get("prerequisite") or "").strip()
    if feat_type:
        bits.append(feat_type)
    if prereq:
        bits.append("Prerequisite: " + prereq)
    body_parts = []
    desc = str(row.get("desc") or "").strip()
    if desc:
        body_parts.append(desc)
    for benefit in row.get("benefits") or []:
        text = str(benefit.get("desc") or "").strip()
        if text:
            body_parts.append("• " + text)
    body = "\n".join(bits + ([""] if bits and body_parts else []) + body_parts).strip()
    if not body:
        return None
    summary = (feat_type + (" · " if feat_type and prereq else "") + (prereq if prereq else "")).strip(" ·")
    return entry("feat", name, summary or "Feat", body, f"{name} feat {feat_type} {prereq}")


def entry(kind: str, name: str, summary: str, body: str, tags: str) -> dict | None:
    kind = str(kind or "").strip()
    if kind not in KINDS:
        return None
    name = sanitize_text(name, allow_newlines=False, max_chars=MAX_NAME_CHARS)
    summary = sanitize_text(summary, allow_newlines=False, max_chars=MAX_SUMMARY_CHARS)
    body = sanitize_text(body, allow_newlines=True, max_chars=MAX_BODY_CHARS)
    tags = sanitize_text(tags, allow_newlines=False, max_chars=MAX_TAGS_CHARS).lower()
    if not name or not body:
        return None
    return {
        "kind": kind,
        "name": name,
        "summary": summary,
        "body": body,
        "tags": tags,
    }


def main() -> int:
    dest = Path(__file__).resolve().parents[1] / "data" / "srd.json"
    dest.parent.mkdir(parents=True, exist_ok=True)

    print("conditions…", file=sys.stderr)
    conditions = []
    for row in paginate("/conditions/", {"limit": 50}):
        item = format_condition(row)
        if item:
            conditions.append(item)

    print("spells…", file=sys.stderr)
    spells = [
        item
        for row in paginate(
            "/spells/",
            {
                "document__key": DOC,
                "limit": 50,
                "fields": ",".join(
                    [
                        "name",
                        "key",
                        "desc",
                        "higher_level",
                        "level",
                        "school",
                        "classes",
                        "casting_time",
                        "range_text",
                        "duration",
                        "concentration",
                        "ritual",
                        "verbal",
                        "somatic",
                        "material",
                        "material_specified",
                    ]
                ),
            },
        )
        if (item := format_spell(row))
    ]

    print("creatures…", file=sys.stderr)
    monsters = [
        item
        for row in paginate(
            "/creatures/",
            {
                "document__key": DOC,
                "limit": 50,
                "fields": ",".join(
                    [
                        "name",
                        "key",
                        "type",
                        "size",
                        "armor_class",
                        "hit_points",
                        "challenge_rating",
                        "challenge_rating_text",
                        "speed",
                        "actions",
                        "traits",
                    ]
                ),
            },
        )
        if (item := format_monster(row))
    ]

    print("rules…", file=sys.stderr)
    rules = [
        item
        for row in paginate(
            "/rules/",
            {"document__key": DOC, "limit": 50, "fields": "name,key,desc"},
        )
        if (item := format_rule(row))
    ]

    print("feats…", file=sys.stderr)
    feats = []
    for row in paginate(
        "/feats/",
        {
            "document__key": DOC,
            "limit": 50,
            "fields": "name,key,desc,prerequisite,type,benefits",
        },
    ):
        item = format_feat(row)
        if item:
            feats.append(item)

    entries = conditions + spells + monsters + rules + feats
    entries = [e for e in entries if e and e.get("name") and e.get("body")]
    entries = entries[:MAX_ENTRIES]
    entries.sort(key=lambda e: (e["kind"], e["name"].lower()))

    payload = {
        "version": 1,
        "document": DOC,
        "documentName": "System Reference Document 5.2",
        "source": "https://api.open5e.com/v2/",
        "counts": {
            "condition": len(conditions),
            "spell": len(spells),
            "monster": len(monsters),
            "rule": len(rules),
            "feat": len(feats),
            "total": len(entries),
        },
        "entries": entries,
    }
    dest.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"wrote {dest} ({dest.stat().st_size} bytes, {len(entries)} entries)", file=sys.stderr)
    print(json.dumps(payload["counts"]), file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
