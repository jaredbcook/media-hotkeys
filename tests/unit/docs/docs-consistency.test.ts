// @vitest-environment node
// Guards against docs drifting from the code. When a check fails, update the
// doc it names (see "Keeping docs current" in CONTRIBUTING.md), not this test,
// unless the doc structure itself changed on purpose.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import defaults from "../../../src/settings/defaults.json";
import type { AdvancedSettings } from "../../../src/storage.js";

const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));

function read(relativePath: string): string {
  return readFileSync(path.join(repoRoot, relativePath), "utf8");
}

function listFiles(relativeDir: string): string[] {
  if (!existsSync(path.join(repoRoot, relativeDir))) {
    return [];
  }

  return readdirSync(path.join(repoRoot, relativeDir), { withFileTypes: true })
    .filter((entry) => !entry.name.startsWith("."))
    .flatMap((entry) => {
      const relativePath = `${relativeDir}/${entry.name}`;
      return entry.isDirectory() ? listFiles(relativePath) : [relativePath];
    })
    .sort();
}

const docFiles = [
  "README.md",
  "AGENTS.md",
  "ARCHITECTURE.md",
  "CONTRIBUTING.md",
  "CLAUDE.md",
  ...listFiles("docs").filter((file) => file.endsWith(".md")),
  ...listFiles(".github").filter((file) => file.endsWith(".md")),
];

// Returns the rows of the first Markdown table whose header starts with
// `firstHeader`, as trimmed cells with backticks removed.
function readTable(markdown: string, firstHeader: string): string[][] {
  const lines = markdown.split("\n");
  const start = lines.findIndex((line) => new RegExp(`^\\|\\s*${firstHeader}\\s*\\|`).test(line));
  if (start === -1) {
    throw new Error(`No table with first header "${firstHeader}"`);
  }

  const rows: string[][] = [];
  for (const line of lines.slice(start + 2)) {
    if (!line.startsWith("|")) {
      break;
    }
    rows.push(
      line
        .slice(1, -1)
        .split("|")
        .map((cell) => cell.trim().replaceAll("`", "")),
    );
  }
  return rows;
}

describe("ARCHITECTURE.md code map", () => {
  const architecture = read("ARCHITECTURE.md");

  it.each(listFiles("src"))("mentions %s", (file) => {
    expect(architecture, `Add \`${file}\` to the ARCHITECTURE.md code map`).toContain(
      `\`${file}\``,
    );
  });
});

describe("README.md defaults", () => {
  const readme = read("README.md");

  it("lists every configurable action with its default keys", () => {
    // Labels must match the Quick Settings popup so users see the same names.
    const labelSource = read("src/quick-settings-popup.ts").match(
      /const ACTION_LABELS[^{]*\{([^}]*)\}/,
    )?.[1];
    expect(labelSource, "ACTION_LABELS not found in src/quick-settings-popup.ts").toBeDefined();
    const labels = Object.fromEntries(
      [...(labelSource ?? "").matchAll(/(\w+):\s*"([^"]+)"/g)].map(([, action, label]) => [
        action,
        label,
      ]),
    );
    const rows = readTable(readme, "Action");

    for (const [action, binding] of Object.entries(defaults.quickSettings.actionKeyBindings)) {
      const label = labels[action];
      const row = rows.find(([cell]) => cell.toLowerCase() === label?.toLowerCase());
      expect(row, `README hotkey table needs a "${label}" row for ${action}`).toBeDefined();
      expect(
        row?.[1].split(",").map((key) => key.trim()),
        `README keys for "${label}"`,
      ).toEqual(binding.keys);
    }
  });

  it("lists every advanced setting with its default value", () => {
    const s = defaults.advancedSettings as AdvancedSettings;
    const onOff = (value: boolean) => (value ? "On" : "Off");
    const capitalize = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);

    // README label -> [settings covered, expected default text]
    const expected: Record<string, [Array<keyof AdvancedSettings>, string]> = {
      "Min speed": [["speedMin"], `${s.speedMin}x`],
      "Max speed": [["speedMax"], `${s.speedMax}x`],
      "Speed increment": [["speedStep"], `${s.speedStep}x`],
      "Volume increment": [["volumeStep"], `${Math.round(s.volumeStep * 100)}%`],
      "Small / medium / large skip": [
        ["seekStepSmall", "seekStepMedium", "seekStepLarge"],
        `${s.seekStepSmall}s / ${s.seekStepMedium}s / ${s.seekStepLarge}s`,
      ],
      "Sum skips before overlay fadeout": [["sumQuickSkips"], onOff(s.sumQuickSkips)],
      "Number keys jump to location": [["useNumberKeysToJump"], onOff(s.useNumberKeysToJump)],
      "Show overlays": [["showOverlays"], onOff(s.showOverlays)],
      "Overlay position": [["overlayPosition"], capitalize(s.overlayPosition)],
      "Skip back/forward position": [["skipOverlayPosition"], capitalize(s.skipOverlayPosition)],
      "Overlay duration": [["overlayVisibleDuration"], `${s.overlayVisibleDuration}ms`],
      "Fade duration": [["overlayFadeDuration"], `${s.overlayFadeDuration}ms`],
      "Debug logging": [["debugLogging"], onOff(s.debugLogging)],
    };

    const covered = new Set(Object.values(expected).flatMap(([keys]) => keys));
    const uncovered = Object.keys(s).filter((key) => !covered.has(key as keyof AdvancedSettings));
    expect(uncovered, "Add these settings to the README table and to this test").toEqual([]);

    const rows = new Map(readTable(readme, "Setting").map(([label, value]) => [label, value]));
    for (const [label, [, value]] of Object.entries(expected)) {
      expect(rows.get(label), `README setting "${label}"`).toBe(value);
    }
  });
});

describe("doc references", () => {
  const scripts = Object.keys(
    (JSON.parse(read("package.json")) as { scripts: Record<string, string> }).scripts,
  );

  it.each(docFiles)("%s only references npm scripts that exist", (doc) => {
    const referenced = [...read(doc).matchAll(/npm run ([\w:-]+)/g)].map(([, name]) => name);
    const missing = referenced.filter((name) => !scripts.includes(name));
    expect(missing, `Unknown npm scripts in ${doc}`).toEqual([]);
  });

  it.each(docFiles)("%s only links to files that exist", (doc) => {
    const links = [...read(doc).matchAll(/\]\(([^)\s]+)\)/g)]
      .map(([, target]) => target.split("#")[0])
      .filter((target) => target && !/^[a-z]+:/i.test(target));
    const missing = links.filter(
      (target) => !existsSync(path.resolve(repoRoot, path.dirname(doc), target)),
    );
    expect(missing, `Broken relative links in ${doc}`).toEqual([]);
  });
});
