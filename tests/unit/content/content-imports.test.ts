import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const SRC_DIR = resolve(__dirname, "../../../src");
const IMPORT_PATTERN = /(?:^|\n)\s*(?:import|export)\s[^;]*?from\s+["']([^"']+)["']/g;

/** Collects every module the content script reaches through static imports. */
function collectImports(entry: string): { files: Set<string>; packages: Set<string> } {
  const files = new Set<string>();
  const packages = new Set<string>();
  const pending = [entry];

  while (pending.length > 0) {
    const file = pending.pop()!;
    if (files.has(file)) {
      continue;
    }

    files.add(file);
    for (const [, specifier] of readFileSync(file, "utf8").matchAll(IMPORT_PATTERN)) {
      if (specifier.startsWith(".")) {
        pending.push(resolve(dirname(file), specifier.replace(/\.js$/, ".ts")));
      } else {
        packages.add(specifier);
      }
    }
  }

  return { files, packages };
}

describe("content script imports", () => {
  // The public suffix list is large and the content script loads in every frame;
  // saved rules are matched by hostname suffix instead (see findMatchingSitePolicy).
  it("does not load tldts", () => {
    const { files, packages } = collectImports(resolve(SRC_DIR, "content.ts"));

    expect(files).toContain(resolve(SRC_DIR, "storage.ts"));
    expect([...packages].filter((name) => name.startsWith("tldts"))).toEqual([]);
    expect(files).not.toContain(resolve(SRC_DIR, "site-patterns.ts"));
  });
});
