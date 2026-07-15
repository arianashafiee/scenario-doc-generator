#!/usr/bin/env python3
"""Build a Word document in the sample-A layout with the requested tweaks."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from docx import Document
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml.ns import qn
from docx.shared import Inches, Pt, RGBColor


def add_run(paragraph, text: str, *, bold: bool = False, italic: bool = False, size: int = 11, mono: bool = False):
    run = paragraph.add_run(text)
    if mono:
        run.font.name = "Courier New"
        run._element.rPr.rFonts.set(qn("w:eastAsia"), "Courier New")
    run.font.size = Pt(size)
    run.bold = bold
    run.italic = italic
    return run


def build_doc(manifest: dict, output: Path) -> None:
    doc = Document()

    title = (manifest.get("title") or "Generated Scenario").strip()
    doc.add_heading(title, level=0)

    description = (manifest.get("description") or "").strip()
    if description:
        doc.add_paragraph(description)

    tags = [str(tag).strip() for tag in (manifest.get("tags") or []) if str(tag).strip()]
    if tags:
        p = doc.add_paragraph()
        add_run(p, "Tags: ", bold=True)
        add_run(p, ", ".join(tags))

    source = (manifest.get("sourceLabel") or "").strip()
    if source:
        p = doc.add_paragraph()
        run = p.add_run(f"Source: {source}")
        run.italic = True
        run.font.color.rgb = RGBColor(0x66, 0x66, 0x66)

    # Match sample A section heading
    doc.add_heading("Scenario", level=1)

    steps = manifest.get("steps") or []
    if not steps:
        doc.add_paragraph("No steps were found in this export.")

    for index, step in enumerate(steps):
        # Step title only — no numbering, no Given/When/Then prefix added
        p = doc.add_paragraph()
        add_run(p, step.get("text") or "(Untitled step)", bold=True)

        table_rows = step.get("table") or []
        if table_rows:
            table = doc.add_table(rows=len(table_rows), cols=len(table_rows[0]))
            table.style = "Table Grid"
            for r_idx, row in enumerate(table_rows):
                for c_idx, cell_value in enumerate(row):
                    cell = table.cell(r_idx, c_idx)
                    cell.text = ""
                    para = cell.paragraphs[0]
                    add_run(para, str(cell_value), bold=(r_idx == 0), mono=True, size=10)

        # Images only — no "Screenshot" label; supports multiple per step
        for shot_path in step.get("screenshotPaths") or []:
            path = Path(shot_path)
            if not path.exists():
                continue
            picture = doc.add_paragraph()
            picture.alignment = WD_ALIGN_PARAGRAPH.CENTER
            picture.add_run().add_picture(str(path), width=Inches(6.0))

        # One blank line between steps
        if index < len(steps) - 1:
            doc.add_paragraph("")

    output.parent.mkdir(parents=True, exist_ok=True)
    doc.save(output)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("manifest")
    parser.add_argument("--out", required=True)
    args = parser.parse_args()
    manifest = json.loads(Path(args.manifest).read_text())
    build_doc(manifest, Path(args.out))
    print(f"Generated {args.out}")


if __name__ == "__main__":
    main()
