#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Command } from "commander";
import { generateScenarioDoc, type ScenarioExport } from "./generateScenarioDoc.js";

const program = new Command();

program
  .name("scenario-doc-generator")
  .description("Generate a Word document from a scenario action JSON export.")
  .argument("<input>", "Path to a scenario actions JSON export")
  .option("-o, --out <path>", "Output .docx path (defaults to a timestamped file)")
  .action(async (input: string, options: { out?: string }) => {
    const inputPath = resolve(input);
    const outputPath = resolve(options.out ?? defaultOutputPath());
    const scenario = await readScenario(inputPath);

    await generateScenarioDoc({
      inputPath,
      outputPath,
      scenario,
    });

    console.log(`Generated ${outputPath}`);
  });

program.parseAsync().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Failed to generate document: ${message}`);
  process.exitCode = 1;
});

async function readScenario(path: string): Promise<ScenarioExport> {
  const raw = await readFile(path, "utf8");
  const parsed = JSON.parse(raw) as unknown;

  if (!isScenarioExport(parsed)) {
    throw new Error("Input JSON does not look like a scenario export.");
  }

  return parsed;
}

function isScenarioExport(value: unknown): value is ScenarioExport {
  return typeof value === "object" && value !== null && Array.isArray((value as ScenarioExport).steps);
}

function defaultOutputPath(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `output/scenario-${stamp}.docx`;
}
