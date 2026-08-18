import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";
import { resolveGitCwd } from "./git";

const scratch = mkdtempSync(path.join(os.tmpdir(), "local-studio-git-cwd-"));

after(() => rmSync(scratch, { recursive: true, force: true }));

describe("resolveGitCwd", () => {
  test("returns the canonical path for a directory inside a configured root", () => {
    const root = path.join(scratch, "root");
    const repo = path.join(root, "repo");
    mkdirSync(repo, { recursive: true });

    assert.equal(resolveGitCwd(repo, [root]), realpathSync(repo));
  });

  test("rejects a symlink that escapes a configured root", () => {
    const root = path.join(scratch, "symlink-root");
    const outside = path.join(scratch, "outside");
    const escaped = path.join(root, "escaped");
    mkdirSync(root, { recursive: true });
    mkdirSync(outside, { recursive: true });
    symlinkSync(outside, escaped, "dir");

    assert.equal(resolveGitCwd(escaped, [root]), null);
  });

  test("rejects paths that do not exist", () => {
    const root = path.join(scratch, "missing-root");
    mkdirSync(root, { recursive: true });

    assert.equal(resolveGitCwd(path.join(root, "missing"), [root]), null);
  });
});
