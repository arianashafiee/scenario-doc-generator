# Scenario Doc Generator

Generate a Word document from a scenario actions JSON export.

Output layout (based on sample A):

- scenario title, description, and tags
- `Scenario` heading
- each step title only (no numbering, no Given/When/Then keywords added)
- a `Text Value` table when input data is present (Type / Position omitted for now)
- embedded screenshots under the step (no "Screenshot" label; multiple images per step supported)
- one blank line between steps

## Usage

```bash
npm install
python3 -m pip install -r requirements.txt
npm run generate:sample
```

The sample command reads `fixtures/scenario-actions-1784040232462.json` and writes `output/sample-scenario.docx`.

To run against another export:

```bash
npm start -- /path/to/scenario-actions.json --out output/scenario.docx
```

## Screenshot Retrieval

Screenshots are read from each step's `screenShots` entries as `data:image/...;base64,...` values when embedded in the JSON. Service-account fetch can be added later if screenshots arrive as remote references.
