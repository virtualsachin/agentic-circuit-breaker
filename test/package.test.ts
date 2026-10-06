import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

// The compiled tests live in dist/test, so the package root is two levels up.
const root = join(__dirname, "..", "..");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { main: string; types: string; files?: string[] };

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

  it("publishes only the built library: `files` covers main and types, and the whole build of src exists", () => {
    const files = pkg.files;
    assert.ok(Array.isArray(files) && files.length > 0, "package.json needs a `files` list");
    const covered = (path: string): boolean => files.some((entry) => path === entry || path.startsWith(`${entry}/`));
    assert.ok(covered(pkg.main), `${pkg.main} is not covered by files`);
    assert.ok(covered(pkg.types), `${pkg.types} is not covered by files`);
    assert.ok(!files.some((entry) => entry === "dist" || entry.startsWith("dist/test") || entry.startsWith("test")), "files must not ship the tests");
    assert.ok(existsSync(join(root, "dist", "src", "errors.js")), "dist/src/errors.js does not exist: build first");
  });
});
