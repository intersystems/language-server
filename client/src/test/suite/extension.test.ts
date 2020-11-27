import * as assert from "assert";
import { before } from "mocha";

// You can import and use all API from the 'vscode' module
// as well as import your extension to test it
import { window, extensions } from "vscode";
import { extensionId } from "../../extension";

import { sleep } from "./helper";

suite("Extension Test Suite", () => {
  suiteSetup(async function () {
    // make sure extension is activated
    const ext = extensions.getExtension(extensionId);
    await ext.activate();
    await sleep(5000); // Wait for server activation
  });

  before(() => {
    window.showInformationMessage("Start all tests.");
  });

  test("Extension started", () => {
    assert.ok("All good");
  });
});
