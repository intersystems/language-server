import * as vscode from "vscode";
import * as assert from "assert";
import { getDocUri, activate } from "../helper";

suite("Should get diagnostics", () => {
  const docUri = getDocUri("src/User/Test.cls");

  test("Diagnoses Parameters", async () => {
    const source = "InterSystems Language Server";
    const message = "Parameter value and type do not match.";
    const severity = vscode.DiagnosticSeverity.Warning;
    await testDiagnostics(docUri, [
      { range: toRange(5, 40, 4), message, severity, source },
      { range: toRange(9, 42, 6), message, severity, source },
      { range: toRange(13, 42, 6), message, severity, source },
    ]);
  });
});

function toRange(sLine: number, sChar: number, len: number): vscode.Range;
function toRange(sLine: number, sChar: number, eLine: number, eChar: number): vscode.Range;
function toRange(...vals: number[]): vscode.Range {
  const [sLine, sChar, len] = vals;
  let [eLine, eChar] = [sLine, sChar + len];
  if (vals.length === 4) {
    [, , eLine, eChar] = vals;
  }
  const start = new vscode.Position(sLine, sChar);
  const end = new vscode.Position(eLine, eChar);
  return new vscode.Range(start, end);
}

async function testDiagnostics(docUri: vscode.Uri, expectedDiagnostics: vscode.Diagnostic[]) {
  await activate(docUri);

  const actualDiagnostics = vscode.languages.getDiagnostics(docUri);

  assert.strictEqual(actualDiagnostics.length, expectedDiagnostics.length);

  expectedDiagnostics.forEach((expectedDiagnostic, i) => {
    const actualDiagnostic = actualDiagnostics[i];
    assert.strictEqual(actualDiagnostic.message, expectedDiagnostic.message);
    assert.deepStrictEqual(actualDiagnostic.range, expectedDiagnostic.range);
    assert.strictEqual(actualDiagnostic.severity, expectedDiagnostic.severity);
  });
}
