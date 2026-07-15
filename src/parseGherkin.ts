import { AstBuilder, GherkinClassicTokenMatcher, Parser } from "@cucumber/gherkin";
import { IdGenerator, type GherkinDocument, type Step } from "@cucumber/messages";

export type ParsedRule = {
  name: string;
  scenarios: Array<{
    name: string;
    steps: readonly Step[];
  }>;
};

export type ParsedScenarioDocument = {
  document: GherkinDocument;
  featureName: string;
  featureDescription: string;
  rules: ParsedRule[];
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

  const rules: ParsedRule[] = [];
  const flatSteps: Step[] = [];

  for (const child of feature.children) {
    if (child.rule) {
      const scenarios = [];
      for (const ruleChild of child.rule.children) {
        if (!ruleChild.scenario) {
          continue;
        }
        scenarios.push({
          name: ruleChild.scenario.name,
          steps: ruleChild.scenario.steps,
        });
        flatSteps.push(...ruleChild.scenario.steps);
      }
      rules.push({
        name: child.rule.name,
        scenarios,
      });
      continue;
    }

    if (child.scenario) {
      rules.push({
        name: child.scenario.name,
        scenarios: [
          {
            name: child.scenario.name,
            steps: child.scenario.steps,
          },
        ],
      });
      flatSteps.push(...child.scenario.steps);
    }
  }

  if (!rules.length) {
    throw new Error("Gherkin Feature does not contain a Rule or Scenario.");
  }

  return {
    document,
    featureName: feature.name,
    featureDescription: feature.description?.trim() ?? "",
    rules,
    steps: flatSteps,
  };
}
