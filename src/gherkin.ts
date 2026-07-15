export type ScenarioExport = {
  title?: string;
  description?: string;
  scenarioTags?: string[];
  pages?: ScenarioPage[];
  steps?: ScenarioStep[];
};

export type ScenarioPage = {
  title?: string;
  url?: string;
};

export type ScenarioStep = {
  title?: string;
  actionId?: string;
  screenShots?: unknown[];
  stepDataTable?: {
    key?: string;
    value?: unknown;
  } | null;
  stepEvent?: {
    type?: string;
  };
};

export type GherkinTable = {
  header: string;
  value: string;
};

export type BuiltGherkinStep = {
  keyword: "Given" | "When" | "Then" | "And" | "But";
  text: string;
  table?: GherkinTable;
  screenShots: unknown[];
  /** True when the step was synthesized for Gherkin structure (no JSON screenshot). */
  synthetic?: boolean;
};

export type BuiltScenario = {
  name: string;
  steps: BuiltGherkinStep[];
};

export type BuiltRule = {
  name: string;
  scenarios: BuiltScenario[];
};

export type BuiltGherkinFeature = {
  featureTitle: string;
  featureDescription: string;
  rules: BuiltRule[];
  source: string;
  /** Flat ordered steps for screenshot handling / validation helpers. */
  steps: BuiltGherkinStep[];
};

/**
 * Convert a scenario actions export into Gherkin source text.
 * Structure follows Cucumber reference style:
 * Feature -> Rule -> Scenario -> Given/When/Then steps.
 */
export function buildGherkinFeature(scenario: ScenarioExport): BuiltGherkinFeature {
  const featureTitle = resolveFeatureTitle(scenario);
  const featureDescription = resolveFeatureDescription(scenario, featureTitle);
  const rawSteps = scenario.steps ?? [];
  const segments = splitIntoRuleSegments(rawSteps);
  const rules = segments.map((segment, index) => buildRule(segment, index, segments));

  const lines = [`Feature: ${featureTitle}`, `  ${featureDescription}`, ""];

  for (const rule of rules) {
    lines.push(`  Rule: ${rule.name}`);
    lines.push("");
    for (const scenarioBlock of rule.scenarios) {
      lines.push(`    Scenario: ${scenarioBlock.name}`);
      for (const step of scenarioBlock.steps) {
        lines.push(`      ${step.keyword} ${step.text}`);
        if (step.table) {
          lines.push(`        | ${escapeCell(step.table.header)} |`);
          lines.push(`        | ${escapeCell(step.table.value)} |`);
        }
      }
      lines.push("");
    }
  }

  const steps = rules.flatMap((rule) => rule.scenarios.flatMap((scenarioBlock) => scenarioBlock.steps));

  return {
    featureTitle,
    featureDescription,
    rules,
    source: lines.join("\n").trimEnd() + "\n",
    steps,
  };
}

function splitIntoRuleSegments(steps: ScenarioStep[]): ScenarioStep[][] {
  if (!steps.length) {
    return [];
  }

  const segments: ScenarioStep[][] = [];
  let current: ScenarioStep[] = [];

  for (const step of steps) {
    current.push(step);
    if (isThenStep(step)) {
      segments.push(current);
      current = [];
    }
  }

  if (current.length) {
    segments.push(current);
  }

  return segments;
}

function buildRule(segment: ScenarioStep[], index: number, allSegments: ScenarioStep[][]): BuiltRule {
  const outcome = extractOutcomeName(segment[segment.length - 1]);
  const previousOutcome =
    index > 0 ? extractOutcomeName(allSegments[index - 1][allSegments[index - 1].length - 1]) : undefined;

  const ruleName = outcome ?? previousOutcome ?? `Flow section ${index + 1}`;
  const scenarioName = outcome
    ? `Reach ${outcome}`
    : previousOutcome
      ? `Continue from ${previousOutcome}`
      : `Complete section ${index + 1}`;

  const steps = buildScenarioSteps(segment, index === 0, previousOutcome);

  return {
    name: ruleName,
    scenarios: [
      {
        name: scenarioName,
        steps,
      },
    ],
  };
}

function buildScenarioSteps(
  segment: ScenarioStep[],
  isFirstRule: boolean,
  previousOutcome: string | undefined,
): BuiltGherkinStep[] {
  const steps: BuiltGherkinStep[] = [];

  if (!isFirstRule && previousOutcome) {
    steps.push({
      keyword: "Given",
      text: `I am on the "${previousOutcome}" step.`,
      screenShots: [],
      synthetic: true,
    });
  }

  const actionSteps = segment.map((step) => {
    const table = extractInputTable(step);
    return {
      raw: step,
      text: applyPlaceholder(step.title?.trim() || "(Untitled step)", table),
      table,
      screenShots: step.screenShots ?? [],
      isThen: isThenStep(step),
    };
  });

  let introducedGiven = !isFirstRule && Boolean(previousOutcome);
  let needWhen = introducedGiven;

  for (const action of actionSteps) {
    let keyword: BuiltGherkinStep["keyword"];

    if (action.isThen) {
      keyword = "Then";
      needWhen = true;
    } else if (!introducedGiven) {
      keyword = "Given";
      introducedGiven = true;
      needWhen = true;
    } else if (needWhen) {
      keyword = "When";
      needWhen = false;
    } else {
      keyword = "And";
    }

    steps.push({
      keyword,
      text: action.text,
      table: action.table,
      screenShots: action.screenShots,
    });
  }

  return steps;
}

function extractOutcomeName(step: ScenarioStep | undefined): string | undefined {
  if (!step) {
    return undefined;
  }
  const match = /^I see (?:Screen|Accordion) — "(.+)"\.$/.exec(step.title?.trim() ?? "");
  return match?.[1];
}

function resolveFeatureTitle(scenario: ScenarioExport): string {
  const explicit = scenario.title?.trim();
  if (explicit) {
    return explicit;
  }

  const pageTitle = scenario.pages?.find((page) => page.title?.trim())?.title?.trim();
  if (pageTitle) {
    const url = scenario.pages?.find((page) => page.url)?.url ?? "";
    if (/signup/i.test(url)) {
      return `${pageTitle} account signup`;
    }
    return `${pageTitle} scenario`;
  }

  return "Generated scenario";
}

function resolveFeatureDescription(scenario: ScenarioExport, featureTitle: string): string {
  const explicit = scenario.description?.trim();
  if (explicit) {
    return explicit;
  }

  const screens = uniqueScreenNames(scenario.steps ?? []);
  if (screens.length) {
    return [
      `Business rules for ${featureTitle} are grouped below.`,
      `Each Rule covers one screen or accordion outcome: ${screens.join(", ")}.`,
    ].join(" ");
  }

  return `Business rules and examples for ${featureTitle}.`;
}

function uniqueScreenNames(steps: ScenarioStep[]): string[] {
  const names: string[] = [];
  const seen = new Set<string>();

  for (const step of steps) {
    const name = extractOutcomeName(step);
    if (!name || seen.has(name)) {
      continue;
    }
    seen.add(name);
    names.push(name);
  }

  return names;
}

function isThenStep(step: ScenarioStep): boolean {
  if (step.stepEvent?.type === "stateChange") {
    return true;
  }
  return /^I see /i.test(step.title?.trim() ?? "");
}

function extractInputTable(step: ScenarioStep): GherkinTable | undefined {
  const rows = Array.isArray(step.stepDataTable?.value) ? step.stepDataTable.value : [];
  const first = rows.find(isRecord);
  if (!first) {
    return undefined;
  }

  const rawValue = first.textValue ?? first.value;
  if (rawValue === null || rawValue === undefined || rawValue === "") {
    return undefined;
  }

  const value = String(rawValue);
  const providedName = typeof first.variableName === "string" ? first.variableName.trim() : "";
  const header = providedName || deriveVariableName(step.title ?? "") || "value";

  return { header, value };
}

function applyPlaceholder(title: string, table?: GherkinTable): string {
  if (!table) {
    return title;
  }

  const placeholder = `"<${table.header}>"`;
  const escapedValue = escapeRegExp(table.value);

  const valuePattern = new RegExp(`"${escapedValue}"`);
  if (valuePattern.test(title)) {
    return title.replace(valuePattern, placeholder);
  }

  if (/"\*+"/.test(title)) {
    return title.replace(/"\*+"/, placeholder);
  }

  return title.replace(/"([^"]*)"/, placeholder);
}

function deriveVariableName(title: string): string {
  const patterns = [
    /\[name=['"]([^'"]+)['"]/i,
    /label\['([^']+)'/i,
    /name=["']([^"']+)["']/i,
    /role=["']([^"']+)["']/i,
  ];

  for (const pattern of patterns) {
    const match = pattern.exec(title);
    if (match?.[1]) {
      return slugify(match[1]);
    }
  }

  return "value";
}

function slugify(value: string): string {
  return value
    .replace(/\*/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_")
    .toLowerCase();
}

function escapeCell(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\|/g, "\\|").replace(/\n/g, " ");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
