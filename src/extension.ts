/* eslint-disable @typescript-eslint/naming-convention */
import * as vscode from "vscode";
import { posix } from "path";
const sfToolkit = require("sf-toolkit");

type ResultArray = {
  test: string;
  result: string;
  got: any;
  expected: any;

  line_number: number;
}[];
type ResponseObject = {
  status: "completed" | "internal_error" | "test_error" | "started";
  result?: ResultArray;
  error_line_number?: number;
  error_message?: string;
};
type DiagnosticObject = {
  range: vscode.Range;
  code?: string;
  message: string;
  severity: vscode.DiagnosticSeverity;
  source: string;
};
let firstRowRange: vscode.Range = new vscode.Range(
  new vscode.Position(0, 0),
  new vscode.Position(0, 500)
);

// Check open file is a Liquid Test
// Check right folder structure && type YAML
// Return templateHandle to run liquid test
async function checkFilePath() {
  // File information
  if (!vscode.window.activeTextEditor) {
    return;
  }
  const filePath = posix.resolve(
    vscode.window.activeTextEditor.document.uri.path
  );
  const fileBasename = posix.basename(filePath);
  const pathParts = posix.dirname(filePath).split(posix.sep);
  // Check /tests directory
  if (pathParts[pathParts.length - 1] !== "tests") {
    vscode.window.showErrorMessage(
      'File is not stored in a "./tests" directory'
    );
    return;
  }
  // Check file name
  const nameRe = new RegExp("_liquid_test.yml");
  const matchName = fileBasename.match(nameRe);
  if (!matchName) {
    vscode.window.showErrorMessage(
      "File name is not correct: [handle]_liquid_test.yml"
    );
    return;
  }
  const templateHandle = pathParts[pathParts.length - 2];
  const templatePath = posix.dirname(posix.dirname(filePath));
  // Check Config File
  const configPath = posix.join(templatePath, "config.json");
  const configUri = vscode.window.activeTextEditor.document.uri.with({
    path: configPath,
  });
  try {
    await vscode.workspace.fs.stat(configUri);
  } catch (error) {
    vscode.window.showErrorMessage("Config.json is missing");
    return;
  }
  // Set the right path
  const basePath = posix.dirname(posix.dirname(templatePath));
  process.chdir(basePath);
  return templateHandle;
}

export async function activate(context: vscode.ExtensionContext) {
  // Set Context Key
  // We should update this key based on if the user has the Silverfin CLI authorized or not
  // We can use this key in package.json menus.commandPalette to show/hide our commands
  // TO-DO (update true value with a boolean based on the cli presence)
  vscode.commands.executeCommand(
    "setContext",
    "silverfin-development-toolkit.apiAuthorized",
    true
  );

  // Status Bar Item
  const statusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    100
  );
  statusBarItem.command = "silverfin-development-toolkit.runTest";
  statusBarItem.text = "Silverfin: run liquid test";
  statusBarItem.show();
  context.subscriptions.push(statusBarItem);

  // Find in which row of the document a text is located
  // It will return only the first match if repeated
  function findIndexRow(
    document: vscode.TextDocument,
    reExpresion: string,
    startIndex: number = 0
  ) {
    let lineIndex = startIndex;
    const documentLastRow = document.lineCount - 1;
    const re = new RegExp(reExpresion);
    for (lineIndex; lineIndex < documentLastRow; lineIndex++) {
      let lineText = document.lineAt(lineIndex).text;
      let regExpTest = lineText.match(re);
      if (regExpTest) {
        return lineIndex;
      }
    }
    return 0;
  }

  // Process errors, create Diagnostic Objects with all the needed information
  function handleResponse(
    document: vscode.TextDocument,
    responseResults: ResultArray
  ): Array<any> {
    const collectionArray: Array<any> = [];
    for (let testObject of responseResults) {
      let resultParts = testObject.result.split(".");
      let resultType = resultParts.shift();
      let resultJoin;
      if (resultParts.length > 0) {
        resultJoin = resultParts.join(".");
      }

      let diagnosticMessage = `[${
        resultJoin || "Reconciled status"
      }] Expected: ${
        testObject.expected
      } (${typeof testObject.expected}) | Got: ${
        testObject.got
      } (${typeof testObject.got})`;
      let diagnosticLineNumber = testObject.line_number - 1;

      if (resultType !== "reconciled") {
        // Expresion: name: content
        let reExpresion = `${resultParts[resultParts.length - 1]}: (\"|\')${
          testObject.expected
        }(\"|\')`;
        // We first search in it's specific unit test (that's why we filter the index start)
        // If it's not found there we search in the entire file
        // Because of anchor & aliases it could be defined in a preivous test
        let testIndex = findIndexRow(document, testObject.test);
        let newIndex = findIndexRow(document, reExpresion, testIndex);
        if (newIndex && newIndex !== 0) {
          diagnosticLineNumber = newIndex;
        } else {
          newIndex = findIndexRow(document, reExpresion);
          if (newIndex && newIndex !== 0) {
            diagnosticLineNumber = newIndex;
          }
        }
      }
      // Range to highlight
      let highlightStartIndex =
        document.lineAt(diagnosticLineNumber).firstNonWhitespaceCharacterIndex;
      let highlighEndIndex =
        document.lineAt(diagnosticLineNumber).text.split("").length + 1;
      let diagnosticRange = new vscode.Range(
        new vscode.Position(diagnosticLineNumber, highlightStartIndex),
        new vscode.Position(diagnosticLineNumber, highlighEndIndex)
      );

      // Create diagnostic object
      let diagnostic: DiagnosticObject = {
        range: diagnosticRange,
        message: diagnosticMessage,
        severity: vscode.DiagnosticSeverity.Error,
        source: "Liquid Test",
        code: testObject.test,
      };
      collectionArray.push(diagnostic);
    }
    return collectionArray;
  }

  // Process the errors returned and update the collection
  function updateDiagnostics(
    document: vscode.TextDocument,
    collection: vscode.DiagnosticCollection,
    response: ResponseObject
  ): void {
    let collectionArray = [];
    console.log(response.result);
    if (response.status === "completed") {
      if (document && response.result && response.result.length > 0) {
        // Errors present after liquid test run
        collectionArray = handleResponse(document, response.result);
        collection.set(document.uri, collectionArray);
      } else {
        // No errors after liquid test
        collection.clear();
        vscode.window.showInformationMessage(
          "All tests have passed succesfully!"
        );
      }
    } else if (response.status === "test_error") {
      // Test concluded
      // Error that prevented the Liquid Test to be run
      let diagnosticRange: vscode.Range;
      if (
        response.error_line_number &&
        response.hasOwnProperty("error_line_number")
      ) {
        let highlightStartIndex = document.lineAt(
          response.error_line_number - 1
        ).firstNonWhitespaceCharacterIndex;
        let highlighEndIndex =
          document.lineAt(response.error_line_number - 1).text.split("")
            .length + 1;
        diagnosticRange = new vscode.Range(
          new vscode.Position(
            response.error_line_number - 1,
            highlightStartIndex
          ),
          new vscode.Position(response.error_line_number - 1, highlighEndIndex)
        );
      } else {
        diagnosticRange = firstRowRange;
      }
      let diagnosticMessage;
      if (response.error_message) {
        diagnosticMessage = response.error_message;
      } else {
        diagnosticMessage = "Error message not provided";
      }
      let diagnostic: DiagnosticObject = {
        range: diagnosticRange,
        message: diagnosticMessage,
        severity: vscode.DiagnosticSeverity.Error,
        source: "Liquid Test",
      };
      collectionArray.push(diagnostic);
      collection.set(document.uri, collectionArray);
    } else if (response.status === "internal_error") {
      // Internal error
      statusBarItem.text = "Silverfin: internal error";
      statusBarItem.backgroundColor = new vscode.ThemeColor(
        "statusBarItem.errorBackground"
      );
      let diagnostic: DiagnosticObject = {
        range: firstRowRange,
        message:
          "Internal error. Try to run the test again. If the issue persists, contact support",
        severity: vscode.DiagnosticSeverity.Error,
        source: "Liquid Test",
      };
    }
  }

  // Get Current Document Information
  let currentYaml: vscode.TextDocument;

  // Run Test Command
  const runTestCommand = "silverfin-development-toolkit.runTest";
  async function runTestCommandHandler() {
    // Check right file & get template handle
    let templateHandle = await checkFilePath();
    if (!templateHandle) {
      return;
    }
    // Check active tab and get document
    if (!vscode.window.activeTextEditor) {
      return;
    }
    currentYaml = vscode.window.activeTextEditor.document;
    // Errors from Liquid Test are stored in a Diagnostic Collection
    const errorsCollection = vscode.languages.createDiagnosticCollection(
      `${templateHandle}Collection`
    );
    // Start Test
    statusBarItem.text = "Silverfin: running test...";
    statusBarItem.backgroundColor = new vscode.ThemeColor(
      "statusBarItem.warningBackground"
    );
    const response = await sfToolkit.runTests(templateHandle);
    // Update status bar
    statusBarItem.text = "Silverfin: run new liquid test";
    statusBarItem.backgroundColor = "";
    // Process response and update collection
    updateDiagnostics(currentYaml, errorsCollection, response);
  }
  // Register Command
  context.subscriptions.push(
    vscode.commands.registerCommand(runTestCommand, runTestCommandHandler)
  );
}

export function deactivate() {}
