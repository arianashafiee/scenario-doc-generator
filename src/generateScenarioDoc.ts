import { mkdir, writeFile } from "node:fs/promises";
import { basename, dirname } from "node:path";
import {
  AlignmentType,
  BorderStyle,
  Document,
  HeadingLevel,
  ImageRun,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from "docx";
import type { Step } from "@cucumber/messages";
import { buildGherkinFeature, type BuiltGherkinStep, type ScenarioExport } from "./gherkin.js";
import { parseGherkinSource } from "./parseGherkin.js";

export type { ScenarioExport } from "./gherkin.js";

type ParsedScreenshot = {
  data: Buffer;
  type: "jpg" | "png" | "gif" | "bmp";
};

export type GenerateScenarioDocOptions = {
  inputPath: string;
  outputPath: string;
  scenario?: ScenarioExport;
};

const TABLE_BORDER = {
  style: BorderStyle.SINGLE,
  size: 1,
  color: "D9D9D9",
};

const MONO = "Courier New";

export async function generateScenarioDoc(options: GenerateScenarioDocOptions): Promise<void> {
  const scenario = options.scenario;

  if (!scenario) {
    throw new Error("A parsed scenario export is required.");
  }

  const built = buildGherkinFeature(scenario);
  const parsed = parseGherkinSource(built.source, basename(options.inputPath));

  if (parsed.steps.length !== built.steps.length) {
    throw new Error(
      `Gherkin parse step count mismatch: parsed ${parsed.steps.length}, built ${built.steps.length}`,
    );
  }

  const doc = new Document({
    sections: [
      {
        properties: {},
        children: buildDocumentChildren(parsed.featureName, parsed.featureDescription, parsed.scenarioName, parsed.steps, built.steps, options.inputPath),
      },
    ],
  });

  const buffer = await Packer.toBuffer(doc);
  await mkdir(dirname(options.outputPath), { recursive: true });
  await writeFile(options.outputPath, buffer);
}

function buildDocumentChildren(
  featureName: string,
  featureDescription: string,
  scenarioName: string,
  parsedSteps: readonly Step[],
  builtSteps: BuiltGherkinStep[],
  inputPath: string,
): (Paragraph | Table)[] {
  const children: (Paragraph | Table)[] = [
    new Paragraph({
      text: featureName,
      heading: HeadingLevel.TITLE,
    }),
    new Paragraph({
      children: [
        new TextRun({
          text: `Source: ${basename(inputPath)}`,
          italics: true,
          color: "666666",
        }),
      ],
      spacing: { after: 240 },
    }),
    new Paragraph({
      children: [
        new TextRun({ text: "Feature: ", bold: true, font: MONO }),
        new TextRun({ text: featureName, font: MONO }),
      ],
      spacing: { after: 80 },
    }),
  ];

  if (featureDescription) {
    children.push(
      new Paragraph({
        children: [new TextRun({ text: `  ${featureDescription}`, font: MONO })],
        spacing: { after: 200 },
      }),
    );
  }

  children.push(
    new Paragraph({
      children: [
        new TextRun({ text: "  Scenario: ", bold: true, font: MONO }),
        new TextRun({ text: scenarioName, font: MONO }),
      ],
      spacing: { after: 160 },
    }),
  );

  if (!parsedSteps.length) {
    children.push(new Paragraph("No steps were found in this export."));
    return children;
  }

  parsedSteps.forEach((step, index) => {
    children.push(...buildStepChildren(step, builtSteps[index]));
  });

  return children;
}

function buildStepChildren(step: Step, media: BuiltGherkinStep): (Paragraph | Table)[] {
  const keyword = (step.keyword ?? "").trim();
  const children: (Paragraph | Table)[] = [
    new Paragraph({
      children: [
        new TextRun({ text: `    ${keyword} `, bold: true, font: MONO }),
        new TextRun({ text: step.text ?? "", font: MONO }),
      ],
      spacing: { before: 120, after: 80 },
    }),
  ];

  const tableRows = step.dataTable?.rows ?? [];
  if (tableRows.length) {
    children.push(buildParsedDataTable(tableRows.map((row) => row.cells.map((cell) => cell.value))));
  }

  const screenshots = media.screenShots.map(parseScreenshot).filter(isPresent);
  screenshots.forEach((screenshot, screenshotIndex) => {
    children.push(
      new Paragraph({
        children: [
          new TextRun({
            text: `Screenshot${screenshots.length > 1 ? ` ${screenshotIndex + 1}` : ""}`,
            italics: true,
          }),
        ],
        spacing: { before: 100, after: 60 },
      }),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [
          new ImageRun({
            data: screenshot.data,
            type: screenshot.type,
            transformation: {
              width: 560,
              height: 315,
            },
          }),
        ],
        spacing: { after: 140 },
      }),
    );
  });

  return children;
}

function buildParsedDataTable(rows: string[][]): Table {
  const columnCount = Math.max(...rows.map((row) => row.length), 1);
  const columnWidth = Math.floor(9000 / columnCount);

  return new Table({
    width: { size: 60, type: WidthType.PERCENTAGE },
    columnWidths: Array.from({ length: columnCount }, () => columnWidth),
    borders: {
      top: TABLE_BORDER,
      bottom: TABLE_BORDER,
      left: TABLE_BORDER,
      right: TABLE_BORDER,
      insideHorizontal: TABLE_BORDER,
      insideVertical: TABLE_BORDER,
    },
    rows: rows.map(
      (row, rowIndex) =>
        new TableRow({
          tableHeader: rowIndex === 0,
          children: Array.from({ length: columnCount }, (_, columnIndex) => {
            const value = row[columnIndex] ?? "";
            return new TableCell({
              shading: rowIndex === 0 ? { fill: "F2F2F2" } : undefined,
              width: { size: columnWidth, type: WidthType.DXA },
              children: [
                new Paragraph({
                  children: [
                    new TextRun({
                      text: value,
                      bold: rowIndex === 0,
                      font: MONO,
                    }),
                  ],
                }),
              ],
            });
          }),
        }),
    ),
  });
}

function parseScreenshot(value: unknown): ParsedScreenshot | null {
  if (typeof value !== "string") {
    return null;
  }

  const match = /^data:image\/(png|jpeg|jpg|gif|bmp);base64,(.+)$/i.exec(value);
  if (!match) {
    return null;
  }

  const type = match[1].toLowerCase() === "jpeg" ? "jpg" : (match[1].toLowerCase() as ParsedScreenshot["type"]);
  return {
    type,
    data: Buffer.from(match[2], "base64"),
  };
}

function isPresent<T>(value: T | null | undefined): value is T {
  return value !== null && value !== undefined;
}
