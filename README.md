# Scenario Doc Generator

Generate a Word document from a scenario actions JSON export.

The generator combines the exported Gherkin-style step titles into one scenario. For each step, it adds:

- the step text
- a table for `stepDataTable.value`, when present
- screenshots from `screenShots`, when they are embedded as `data:image/...;base64,...`

## Usage

```bash
npm install
npm run generate:sample
```

The sample command reads `fixtures/scenario-actions-1784040232462.json` and writes `output/sample-scenario.docx`.

To run against another export:

```bash
npm start -- /path/to/scenario-actions.json --out output/scenario.docx
```

## Screenshot Retrieval

The current implementation supports screenshots that are already embedded in the JSON as data URIs. If screenshots need to be fetched with service-account credentials, add that lookup before `parseScreenshot()` in `src/generateScenarioDoc.ts` so the rest of the document generation flow can stay the same.
