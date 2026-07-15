import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { spawn } from "node:child_process";

type JsonObject = Record<string, unknown>;

export type ScenarioExport = {
  title?: string;
  description?: string;
  scenarioTags?: string[];
  pages?: Array<{ title?: string; url?: string }>;
  steps?: ScenarioStep[];
};

type ScenarioStep = {
  title?: string;
  actionId?: string;
  screenShots?: unknown[];
  stepDataTable?: {
    key?: string;
    value?: unknown;
  } | null;
};

type ParsedScreenshot = {
  data: Buffer;
  extension: "jpg" | "png" | "gif" | "bmp";
};

export type GenerateScenarioDocOptions = {
  inputPath: string;
  outputPath: string;
  scenario?: ScenarioExport;
};

type ManifestStep = {
  text: string;
  table: string[][];
  screenshotPaths: string[];
};

type DocManifest = {
  title: string;
  description: string;
  tags: string[];
  sourceLabel: string;
  steps: ManifestStep[];
};

/**
 * Build the Word doc in the sample-A layout:
 * title / description / tags, then each step title, Text Value table, screenshots.
 */
export async function generateScenarioDoc(options: GenerateScenarioDocOptions): Promise<void> {
  const scenario = options.scenario;

  if (!scenario) {
    throw new Error("A parsed scenario export is required.");
  }

  const tempDir = await mkdtemp(join(tmpdir(), "scenario-doc-"));
  try {
    const manifest = await buildManifest(scenario, options.inputPath, tempDir);
    const manifestPath = join(tempDir, "manifest.json");
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
    await mkdir(dirname(options.outputPath), { recursive: true });
    await runPythonBuilder(manifestPath, options.outputPath);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function buildManifest(
  scenario: ScenarioExport,
  inputPath: string,
  tempDir: string,
): Promise<DocManifest> {
  const steps: ManifestStep[] = [];
  const rawSteps = scenario.steps ?? [];

  for (let index = 0; index < rawSteps.length; index += 1) {
    const step = rawSteps[index];
    const screenshotPaths: string[] = [];
    const screenshots = (step.screenShots ?? []).map(parseScreenshot).filter(isPresent);

    for (let shotIndex = 0; shotIndex < screenshots.length; shotIndex += 1) {
      const screenshot = screenshots[shotIndex];
      const filePath = join(tempDir, `step-${index + 1}-${shotIndex + 1}.${screenshot.extension}`);
      await writeFile(filePath, screenshot.data);
      screenshotPaths.push(filePath);
    }

    steps.push({
      text: cleanStepTitle(step.title),
      table: buildVariableTable(step),
      screenshotPaths,
    });
  }

  return {
    title: resolveTitle(scenario),
    description: scenario.description?.trim() ?? "",
    tags: (scenario.scenarioTags ?? []).map((tag) => String(tag).trim()).filter(Boolean),
    sourceLabel: basename(inputPath),
    steps,
  };
}

function cleanStepTitle(title: string | undefined): string {
  const trimmed = (title ?? "").trim();
  if (!trimmed) {
    return "(Untitled step)";
  }

  // Drop a leading Gherkin keyword (Given/When/Then/And/But/*) if present.
  const withoutKeyword = trimmed.replace(/^(Given|When|Then|And|But|\*)\s+/i, "").trim() || trimmed;

  // Capitalize the first letter so sentences read like sample A.
  return withoutKeyword.charAt(0).toUpperCase() + withoutKeyword.slice(1);
}

function buildVariableTable(step: ScenarioStep): string[][] {
  const value = step.stepDataTable?.value;
  if (!Array.isArray(value)) {
    return [];
  }

  const columns = value
    .filter(isJsonObject)
    .map((row) => {
      const raw = row.textValue ?? row.value;
      if (raw === null || raw === undefined || raw === "") {
        return null;
      }
      const provided = typeof row.variableName === "string" ? row.variableName.trim() : "";
      const header = provided || deriveVariableName(step.title ?? "") || "value";
      return { header, value: String(raw) };
    })
    .filter(isPresent);

  if (!columns.length) {
    return [];
  }

  // Header = variable name, value below it. Multiple inputs become multiple columns.
  return [columns.map((c) => c.header), columns.map((c) => c.value)];
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

function resolveTitle(scenario: ScenarioExport): string {
  const explicit = scenario.title?.trim();
  if (explicit) {
    return explicit;
  }

  const pageTitle = scenario.pages?.find((page) => page.title?.trim())?.title?.trim();
  if (pageTitle) {
    return pageTitle;
  }

  return "Generated Scenario";
}

function runPythonBuilder(manifestPath: string, outputPath: string): Promise<void> {
  const scriptPath = resolve(process.cwd(), "scripts/build_docx.py");

  return new Promise((resolvePromise, reject) => {
    const child = spawn("python3", [scriptPath, manifestPath, "--out", outputPath], {
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolvePromise();
        return;
      }
      reject(new Error(`python-docx builder failed (${code}): ${stderr || "unknown error"}`));
    });
  });
}

function parseScreenshot(value: unknown): ParsedScreenshot | null {
  if (typeof value !== "string") {
    return null;
  }

  const match = /^data:image\/(png|jpeg|jpg|gif|bmp);base64,([\s\S]+)$/i.exec(value.trim());
  if (!match) {
    return null;
  }

  const extension =
    match[1].toLowerCase() === "jpeg" ? "jpg" : (match[1].toLowerCase() as ParsedScreenshot["extension"]);

  return {
    extension,
    data: Buffer.from(match[2], "base64"),
  };
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPresent<T>(value: T | null | undefined): value is T {
  return value !== null && value !== undefined;
}
