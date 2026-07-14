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
  keyword: "Given" | "When" | "Then" | "And";
  text: string;
  table?: GherkinTable;
  screenShots: unknown[];
};

export type BuiltGherkinFeature = {
  featureTitle: string;
  featureDescription: string;
  scenarioTitle: string;
  source: string;
  steps: BuiltGherkinStep[];
};

/**
 * Convert a scenario actions export into Gherkin source text.
 * The source is meant to be parsed by @cucumber/gherkin.
 */
export function buildGherkinFeature(scenario: ScenarioExport): BuiltGherkinFeature {
  const featureTitle = resolveFeatureTitle(scenario);
  const featureDescription = resolveFeatureDescription(scenario, featureTitle);
  const scenarioTitle = `Complete ${featureTitle}`;
  const rawSteps = scenario.steps ?? [];
  const keywords = assignKeywords(rawSteps);

  const steps: BuiltGherkinStep[] = rawSteps.map((step, index) => {
    const table = extractInputTable(step);
    return {
      keyword: keywords[index],
      text: applyPlaceholder(step.title?.trim() || "(Untitled step)", table),
      table,
      screenShots: step.screenShots ?? [],
    };
  });

  const lines = [
    `Feature: ${featureTitle}`,
    `  ${featureDescription}`,
    "",
    `  Scenario: ${scenarioTitle}`,
  ];

  for (const step of steps) {
    lines.push(`    ${step.keyword} ${step.text}`);
    if (step.table) {
      lines.push(`      | ${escapeCell(step.table.header)} |`);
      lines.push(`      | ${escapeCell(step.table.value)} |`);
    }
  }

  lines.push("");

  return {
    featureTitle,
    featureDescription,
    scenarioTitle,
    source: lines.join("\n"),
    steps,
  };
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
    return `Complete the ${featureTitle} flow across ${screens.join(", ")}.`;
  }

  return `Complete the ${featureTitle} flow.`;
}

function uniqueScreenNames(steps: ScenarioStep[]): string[] {
  const names: string[] = [];
  const seen = new Set<string>();

  for (const step of steps) {
    const match = /^I see (?:Screen|Accordion) — "(.+)"\.$/.exec(step.title?.trim() ?? "");
    if (!match) {
      continue;
    }
    const name = match[1];
    if (!seen.has(name)) {
      seen.add(name);
      names.push(name);
    }
  }

  return names;
}

function assignKeywords(steps: ScenarioStep[]): BuiltGherkinStep["keyword"][] {
  const keywords: BuiltGherkinStep["keyword"][] = [];
  let isFirstAction = true;
  let needWhen = false;

  for (const step of steps) {
    if (isThenStep(step)) {
      keywords.push("Then");
      needWhen = true;
      continue;
    }

    if (isFirstAction) {
      keywords.push("Given");
      isFirstAction = false;
      needWhen = true;
      continue;
    }

    if (needWhen) {
      keywords.push("When");
      needWhen = false;
      continue;
    }

    keywords.push("And");
  }

  return keywords;
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
