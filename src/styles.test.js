import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const css = fs.readFileSync(path.resolve("src/styles.css"), "utf8");
const normalizedCss = css.replace(/\r\n/g, "\n");

describe("single-screen layout css", () => {
  it("prevents page-level vertical scrolling", () => {
    expect(normalizedCss).toContain("html,\nbody,\n#root");
    expect(css).toContain("overflow: hidden");
    expect(css).toContain(".app-shell");
    expect(css).toContain("height: 100vh");
  });

  it("uses the screenshot-aligned three-column fixed viewport grid", () => {
    expect(css).toContain("grid-template-columns: 376px minmax(0, 1fr) 388px");
    expect(css).toContain("height: calc(100vh - 56px)");
  });
});
