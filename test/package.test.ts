import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

// The compiled tests live in dist/test, so the package root is two levels up.
const root = join(__dirname, "..", "..");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { main: string; types: string };

describe("package entry points", () => {
  it("has a main that exists after the build and exports the library", () => {
    assert.ok(existsSync(join(root, pkg.main)), `${pkg.main} does not exist: build first`);
    const entry = require(join(root, pkg.main)) as Record<string, unknown>;
    assert.equal(typeof entry["AgentCircuitBreaker"], "function");
    assert.equal(typeof entry["CircuitOpenError"], "function");
  });

  it("has a types file that exists after the build", () => {
    assert.ok(existsSync(join(root, pkg.types)), `${pkg.types} does not exist: build first`);
  });
});
