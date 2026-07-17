"""Build a document manifest from a scenario-actions JSON export.

This is a Python port of the logic previously in src/generateScenarioDoc.ts, so
the service can turn a raw scenario export straight into the manifest consumed by
docgen.docx_builder.build_doc — no Node step required.
"""

from __future__ import annotations

import base64
import binascii
import re
from pathlib import Path
from typing import Any

GHERKIN_KEYWORDS = ("Given", "When", "Then", "And", "But")

_LEADING_KEYWORD = re.compile(r"^(Given|When|Then|And|But|\*)\s+", re.IGNORECASE)
_THEN_STEP = re.compile(r"^\s*I see ", re.IGNORECASE)
_DATA_URI = re.compile(r"^data:image/(png|jpeg|jpg|gif|bmp);base64,([\s\S]+)$", re.IGNORECASE)

_VARIABLE_PATTERNS = (
    re.compile(r"\[name=['\"]([^'\"]+)['\"]", re.IGNORECASE),
    re.compile(r"label\['([^']+)'", re.IGNORECASE),
    re.compile(r"name=[\"']([^\"']+)[\"']", re.IGNORECASE),
    re.compile(r"role=[\"']([^\"']+)[\"']", re.IGNORECASE),
)


class ManifestError(ValueError):
    """Raised when the scenario export cannot be turned into a manifest."""


def _is_object(value: Any) -> bool:
    return isinstance(value, dict)


def _clean_step_title(title: str | None) -> str:
    trimmed = (title or "").strip()
    if not trimmed:
        return "(Untitled step)"
    without_keyword = _LEADING_KEYWORD.sub("", trimmed).strip() or trimmed
    return without_keyword[0].upper() + without_keyword[1:]


def _is_then_step(step: dict) -> bool:
    return bool(_THEN_STEP.match(str(step.get("title") or "")))


def assign_keywords(steps: list[dict]) -> list[str]:
    keywords: list[str] = []
    introduced_given = False
    need_when = False

    for step in steps:
        if _is_then_step(step):
            keyword = "Then"
            need_when = True
        elif not introduced_given:
            keyword = "Given"
            introduced_given = True
            need_when = True
        elif need_when:
            keyword = "When"
            need_when = False
        else:
            keyword = "And"
        keywords.append(keyword)

    return keywords


def _slugify(value: str) -> str:
    value = value.replace("*", "")
    value = re.sub(r"[^a-zA-Z0-9]+", "_", value)
    value = re.sub(r"^_+|_+$", "", value)
    value = re.sub(r"_+", "_", value)
    return value.lower()


def _derive_variable_name(title: str) -> str:
    for pattern in _VARIABLE_PATTERNS:
        match = pattern.search(title)
        if match and match.group(1):
            return _slugify(match.group(1))
    return "value"


def _build_variable_table(step: dict) -> list[list[str]]:
    data_table = step.get("stepDataTable") or {}
    value = data_table.get("value") if isinstance(data_table, dict) else None
    if not isinstance(value, list):
        return []

    columns: list[dict[str, str]] = []
    for row in value:
        if not _is_object(row):
            continue
        raw = row.get("textValue")
        if raw is None:
            raw = row.get("value")
        if raw is None or raw == "":
            continue
        provided = row.get("variableName")
        provided = provided.strip() if isinstance(provided, str) else ""
        header = provided or _derive_variable_name(str(step.get("title") or "")) or "value"
        columns.append({"header": header, "value": str(raw)})

    if not columns:
        return []

    return [[c["header"] for c in columns], [c["value"] for c in columns]]


def _resolve_title(scenario: dict) -> str:
    explicit = str(scenario.get("title") or "").strip()
    if explicit:
        return explicit

    for page in scenario.get("pages") or []:
        if isinstance(page, dict):
            page_title = str(page.get("title") or "").strip()
            if page_title:
                return page_title

    return "Generated Scenario"


def _parse_screenshot(value: Any) -> tuple[bytes, str] | None:
    """Return (bytes, extension) for a base64 data-URI screenshot, else None.

    Accepts either a raw data-URI string or an object with a string field
    (data/base64/value/src/url) holding the data URI.
    """
    candidate: str | None = None
    if isinstance(value, str):
        candidate = value
    elif isinstance(value, dict):
        for key in ("data", "base64", "value", "src", "url"):
            field = value.get(key)
            if isinstance(field, str):
                candidate = field
                break
    if candidate is None:
        return None

    match = _DATA_URI.match(candidate.strip())
    if not match:
        return None

    ext = match.group(1).lower()
    ext = "jpg" if ext == "jpeg" else ext
    try:
        data = base64.b64decode(match.group(2), validate=False)
    except (binascii.Error, ValueError):
        return None
    if not data:
        return None
    return data, ext


def build_manifest(scenario: dict, source_label: str, work_dir: str | Path) -> dict:
    """Turn a parsed scenario export into a manifest for docx_builder.build_doc.

    Screenshots are decoded and written into `work_dir`; their paths are stored on
    each step so the builder can embed them.
    """
    if not isinstance(scenario, dict):
        raise ManifestError("Scenario export must be a JSON object.")

    work_dir = Path(work_dir)
    work_dir.mkdir(parents=True, exist_ok=True)

    raw_steps = scenario.get("steps") or []
    if not isinstance(raw_steps, list):
        raise ManifestError("`steps` must be an array.")

    keywords = assign_keywords(raw_steps)
    steps: list[dict] = []

    for index, step in enumerate(raw_steps):
        if not isinstance(step, dict):
            continue
        screenshot_paths: list[str] = []
        shots = step.get("screenShots") or []
        if isinstance(shots, list):
            shot_index = 0
            for shot in shots:
                parsed = _parse_screenshot(shot)
                if parsed is None:
                    continue
                shot_index += 1
                data, ext = parsed
                file_path = work_dir / f"step-{index + 1}-{shot_index}.{ext}"
                file_path.write_bytes(data)
                screenshot_paths.append(str(file_path))

        steps.append(
            {
                "text": f"{keywords[index]} {_clean_step_title(step.get('title'))}",
                "table": _build_variable_table(step),
                "screenshotPaths": screenshot_paths,
            }
        )

    tags = [
        str(tag).strip()
        for tag in (scenario.get("scenarioTags") or [])
        if str(tag).strip()
    ]

    return {
        "title": _resolve_title(scenario),
        "description": str(scenario.get("description") or "").strip(),
        "tags": tags,
        "feature": str(scenario.get("feature") or scenario.get("featureName") or "").strip(),
        "testSuite": str(scenario.get("testSuite") or scenario.get("suite") or "").strip(),
        "sourceLabel": source_label,
        "steps": steps,
    }
