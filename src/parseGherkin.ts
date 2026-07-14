import { AstBuilder, GherkinClassicTokenMatcher, Parser } from "@cucumber/gherkin";
import { IdGenerator, type GherkinDocument, type Step } from "@cucumber/messages";

export type ParsedScenarioDocument = {
  document: GherkinDocument;
  featureName: string;
  featureDescription: string;
  scenarioName: string;
  steps: readonly Step[];
};

export function parseGherkinSource(source: string, uri = "scenario.feature"): ParsedScenarioDocument {
  const newId = IdGenerator.uuid();
  const parser = new Parser(new AstBuilder(newId), new GherkinClassicTokenMatcher());
  const document = parser.parse(source);
  document.uri = uri;

  const feature = document.feature;
  if (!feature) {
    throw new Error("Gherkin parse succeeded but no Feature was found.");
  }

  const scenario = feature.children.find((child) => child.scenario)?.scenario;
  if (!scenario) {
    throw new Error("Gherkin Feature does not contain a Scenario.");
  }

  return {
    document,
    featureName: feature.name,
    featureDescription: feature.description?.trim() ?? "",
    scenarioName: scenario.name,
    steps: scenario.steps,
  };
}
