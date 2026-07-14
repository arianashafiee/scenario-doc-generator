# Scenario Doc Generator

Generate a Word document from a scenario actions JSON export.

The generator converts the JSON into Gherkin source, parses it with the official [`@cucumber/gherkin`](https://github.com/cucumber/gherkin) parser, then writes a Word document from that AST. For each step it includes:

- placeholder variables in the step text when input values are present
- a data table parsed from the Gherkin step
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

The current implementation supports screenshots that are already embedded in the JSON as data URIs. If screenshots need to be fetched with service-account credentials, resolve them before screenshot parsing in `src/generateScenarioDoc.ts` so the Gherkin formatting flow can stay the same.
