import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
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

type JsonObject = Record<string, unknown>;

export type ScenarioExport = {
  title?: string;
  description?: string;
  scenarioTags?: string[];
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

export async function generateScenarioDoc(options: GenerateScenarioDocOptions): Promise<void> {
  const scenario = options.scenario;

  if (!scenario) {
    throw new Error("A parsed scenario export is required.");
  }

  const doc = new Document({
    sections: [
      {
        properties: {},
        children: buildDocumentChildren(scenario, options.inputPath),
      },
    ],
  });

  const buffer = await Packer.toBuffer(doc);
  await mkdir(dirname(options.outputPath), { recursive: true });
  await writeFile(options.outputPath, buffer);
}

function buildDocumentChildren(scenario: ScenarioExport, inputPath: string): (Paragraph | Table)[] {
  const children: (Paragraph | Table)[] = [
    new Paragraph({
      text: scenario.title?.trim() || "Generated Scenario",
      heading: HeadingLevel.TITLE,
    }),
    new Paragraph({
      children: [new TextRun({ text: `Source: ${inputPath}`, italics: true, color: "666666" })],
      spacing: { after: 240 },
    }),
  ];

  if (scenario.description?.trim()) {
    children.push(
      new Paragraph({
        text: scenario.description.trim(),
        spacing: { after: 240 },
      }),
    );
  }

  if (scenario.scenarioTags?.length) {
    children.push(
      new Paragraph({
        children: [new TextRun({ text: `Tags: ${scenario.scenarioTags.join(", ")}`, italics: true })],
        spacing: { after: 240 },
      }),
    );
  }

  const steps = scenario.steps ?? [];
  if (!steps.length) {
    children.push(new Paragraph("No steps were found in this export."));
    return children;
  }

  children.push(
    new Paragraph({
      text: "Scenario",
      heading: HeadingLevel.HEADING_1,
      spacing: { before: 240, after: 120 },
    }),
  );

  steps.forEach((step, index) => {
    children.push(...buildStepChildren(step, index + 1));
  });

  return children;
}

function buildStepChildren(step: ScenarioStep, ordinal: number): (Paragraph | Table)[] {
  const children: (Paragraph | Table)[] = [
    new Paragraph({
      children: [
        new TextRun({ text: `${ordinal}. `, bold: true }),
        new TextRun({ text: step.title?.trim() || "(Untitled step)", bold: true }),
      ],
      spacing: { before: 180, after: 100 },
    }),
  ];

  const tableRows = normalizeTableRows(step.stepDataTable?.value);
  if (tableRows.length) {
    children.push(buildDataTable(tableRows));
  }

  const screenshots = (step.screenShots ?? []).map(parseScreenshot).filter(isPresent);
  screenshots.forEach((screenshot, screenshotIndex) => {
    children.push(
      new Paragraph({
        children: [
          new TextRun({
            text: `Screenshot${screenshots.length > 1 ? ` ${screenshotIndex + 1}` : ""}`,
            italics: true,
          }),
        ],
        spacing: { before: 120, after: 80 },
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
        spacing: { after: 160 },
      }),
    );
  });

  return children;
}

function normalizeTableRows(value: unknown): JsonObject[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter(isJsonObject).map((row) => {
    const cleaned: JsonObject = {};
    Object.entries(row).forEach(([key, item]) => {
      if (item !== "" && item !== null && item !== undefined) {
        cleaned[key] = item;
      }
    });
    return cleaned;
  });
}

function buildDataTable(rows: JsonObject[]): Table {
  const columns = collectColumns(rows);
  const header = new TableRow({
    tableHeader: true,
    children: columns.map((column) =>
      new TableCell({
        shading: { fill: "F2F2F2" },
        children: [new Paragraph({ children: [new TextRun({ text: formatHeader(column), bold: true })] })],
      }),
    ),
  });

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top: TABLE_BORDER,
      bottom: TABLE_BORDER,
      left: TABLE_BORDER,
      right: TABLE_BORDER,
      insideHorizontal: TABLE_BORDER,
      insideVertical: TABLE_BORDER,
    },
    rows: [
      header,
      ...rows.map(
        (row) =>
          new TableRow({
            children: columns.map(
              (column) =>
                new TableCell({
                  children: [new Paragraph(formatCell(row[column]))],
                }),
            ),
          }),
      ),
    ],
  });
}

function collectColumns(rows: JsonObject[]): string[] {
  const seen = new Set<string>();
  rows.forEach((row) => {
    Object.keys(row).forEach((key) => seen.add(key));
  });
  return [...seen];
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

function formatHeader(value: string): string {
  return value.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, (char) => char.toUpperCase());
}

function formatCell(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }

  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  return JSON.stringify(value);
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPresent<T>(value: T | null | undefined): value is T {
  return value !== null && value !== undefined;
}
