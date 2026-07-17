#!/usr/bin/env python3
"""CLI wrapper around docgen.docx_builder.build_doc.

Kept so the TypeScript pipeline (src/generateScenarioDoc.ts) can invoke the
builder via `python3 scripts/build_docx.py <manifest> --out ... --template ...`.
The actual builder lives in the importable `docgen` package.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

# Ensure the repo root is importable when run as a script.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from docgen.docx_builder import DEFAULT_TEMPLATE, build_doc


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("manifest")
    parser.add_argument("--out", required=True)
    parser.add_argument("--template", default=None)
    args = parser.parse_args()
    manifest = json.loads(Path(args.manifest).read_text())
    template = Path(args.template) if args.template else DEFAULT_TEMPLATE
    build_doc(manifest, Path(args.out), template)
    print(f"Generated {args.out}")


if __name__ == "__main__":
    main()
