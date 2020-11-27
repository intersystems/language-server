import * as cp from "child_process";
import * as path from "path";

import { downloadAndUnzipVSCode, resolveCliPathFromVSCodeExecutablePath, runTests } from "vscode-test";

async function main() {
  try {
    // The folder containing the Extension Manifest package.json
    // Passed to `--extensionDevelopmentPath`
    const extensionDevelopmentPath = path.resolve(__dirname, "../../../");

    // The path to the extension test script
    // Passed to --extensionTestsPath
    const extensionTestsPath = path.resolve(__dirname, "./suite/index");

    // The path to the workspace file
    const workspace = path.resolve(extensionDevelopmentPath, "./test-fixtures/test.code-workspace");

    const version = "stable";
    const vscodeExecutablePath = await downloadAndUnzipVSCode(version);
    const cliPath = resolveCliPathFromVSCodeExecutablePath(vscodeExecutablePath);

    const installExtension = (extId: string) =>
      cp.spawnSync(cliPath, ["--install-extension", extId], {
        encoding: "utf-8",
        stdio: "inherit",
      });

    // Install dependent extensions
    const dependencies = ["intersystems-community.servermanager", "intersystems-community.vscode-objectscript"];
    dependencies.forEach(installExtension);

    // disable extensions
    const disableExtensions = cp
      .spawnSync(cliPath, ["--list-extensions"], {
        encoding: "utf-8",
        stdio: "pipe",
      })
      .stdout.split("\n")
      .filter((el) => !dependencies.includes(el))
      .filter((el) => el.length)
      .reduce((r, el) => {
        r.push("--disable-extension", el);
        return r;
      }, []);

    const launchArgs = ["-n", ...disableExtensions, workspace];

    // Download VS Code, unzip it and run the integration test
    await runTests({ version, extensionDevelopmentPath, extensionTestsPath, launchArgs });
  } catch (err) {
    console.error("Failed to run tests", err);
    process.exit(1);
  }
}

main();
