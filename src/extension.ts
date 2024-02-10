import * as vscode from "vscode";
import AddClosingTag from "./lib/addClosingTag";
import SharedPartsVerifier from "./lib/diagnostics/sharedPartsVerifier";
import FirmHandler from "./lib/firmHandler";
import LiquidLinter from "./lib/liquidLinter";
import LiquidTestHandler from "./lib/liquidTestHandler";
import LiquidQuickFixes from "./lib/quickFixes/liquidQuickFixes";
import LiquidTestQuickFixes from "./lib/quickFixes/liquidTestsQuickFixes";
import { FirmViewProvider } from "./lib/sidebar/panelFirm";
import { TemplateInformationViewProvider } from "./lib/sidebar/panelTemplateInfo";
import { TemplatePartsViewProvider } from "./lib/sidebar/panelTemplateParts";
import { TestsViewProvider } from "./lib/sidebar/panelTests";
import StatusBarDevMode from "./lib/statusBar/statusBarDevMode";
import StatusBarItem from "./lib/statusBar/statusBarItem";
import TemplateCommander from "./lib/templateCommander";
import TemplateUpdater from "./lib/templateUpdater";
import * as diagnosticsUtils from "./utilities/diagnosticsUtils";

export async function activate(context: vscode.ExtensionContext) {
  // Replace with ExtensionLogger
  const outputChannelLog = vscode.window.createOutputChannel(
    "Silverfin (Extension Logs)"
  );
  // replace with UserLogger
  const outputChannelUser =
    vscode.window.createOutputChannel("Silverfin (Users)");

  const firmHandler = new FirmHandler();
  const statusBarItemRunTests = new StatusBarItem(
    context,
    firmHandler.apiSecretsPresent
  );
  const statusBarDevMode = new StatusBarDevMode(
    context,
    firmHandler.apiSecretsPresent
  );
  const liquidLinter = new LiquidLinter(outputChannelLog);
  const liquidTestHandler = new LiquidTestHandler(context, outputChannelLog);

  const templateUpdater = new TemplateUpdater(firmHandler);

  // References
  firmHandler.statusBarItem = statusBarItemRunTests;
  liquidTestHandler.statusBarItem = statusBarItemRunTests;
  liquidTestHandler.firmHandler = firmHandler;
  liquidLinter.firmHandler = firmHandler;

  // Command to set active Firm ID via prompt and store it
  context.subscriptions.push(
    vscode.commands.registerCommand(firmHandler.commandNameSetFirm, () => {
      firmHandler.setFirmIdCommand();
    })
  );

  // Command to authorize a Firm via prompt and store it
  context.subscriptions.push(
    vscode.commands.registerCommand(
      firmHandler.commandNameAuthorizeFirm,
      () => {
        firmHandler.authorizeFirmCommand();
      }
    )
  );

  // Command to run the liquid linter
  context.subscriptions.push(
    vscode.commands.registerCommand(liquidLinter.commandName, () => {
      liquidLinter.verifyLiquidCommand();
    })
  );
  // Liquid Linter Command is run when you save a liquid file
  vscode.workspace.onDidSaveTextDocument(() => {
    if (LiquidLinter.isLiquidFileCheck()) {
      liquidLinter.verifyLiquidCommand();
    }
  });

  // Load Errors stored for open file if any
  if (vscode.window.activeTextEditor) {
    diagnosticsUtils.loadStoredDiagnostics(
      vscode.window.activeTextEditor.document,
      outputChannelLog,
      context,
      liquidTestHandler.errorsCollection
    );
  }

  // When a new file is opened for the first time. Load the Diagnostic stored from previous runs
  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument(async (currentDocument) => {
      diagnosticsUtils.loadStoredDiagnostics(
        currentDocument,
        outputChannelLog,
        context,
        liquidTestHandler.errorsCollection
      );
    })
  );

  // Command to clean Diagnostic Collection of current file
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "silverfin-development-toolkit.clearCurrentDiagnosticCollection",
      () => {
        if (!vscode.window.activeTextEditor) {
          return;
        }
        liquidTestHandler.errorsCollection.set(
          vscode.window.activeTextEditor.document.uri,
          []
        );
      }
    )
  );

  // Command to run all tests
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "silverfin-development-toolkit.runAllTests",
      () => {
        liquidTestHandler.runAllTestsCommand();
      }
    )
  );

  // Command to run specific test (with html input)
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "silverfin-development-toolkit.runTestWithOptionsInputHtml",
      () => {
        liquidTestHandler.runTestWithOptionsCommand("input");
      }
    )
  );

  // Command to run specific test (with html preview)
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "silverfin-development-toolkit.runTestWithOptionsPreviewHtml",
      () => {
        liquidTestHandler.runTestWithOptionsCommand("preview");
      }
    )
  );

  // Quick Fixes Provider
  context.subscriptions.push(
    vscode.languages.registerCodeActionsProvider(
      "yaml",
      new LiquidTestQuickFixes(),
      {
        providedCodeActionKinds: LiquidTestQuickFixes.providedCodeActionKinds
      }
    )
  );
  context.subscriptions.push(
    vscode.languages.registerCodeActionsProvider(
      "liquid",
      new LiquidQuickFixes(),
      {
        providedCodeActionKinds: LiquidQuickFixes.providedCodeActionKinds
      }
    )
  );

  // Side-Bar Views
  // Template Parts
  const templatePartsProvider = new TemplatePartsViewProvider(
    context.extensionUri
  );
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      TemplatePartsViewProvider.viewType,
      templatePartsProvider
    )
  );
  context.subscriptions.push(
    vscode.commands.registerCommand("template-parts-panel.refresh", () => {
      if (!templatePartsProvider._view) {
        return;
      }
      templatePartsProvider.setContent(templatePartsProvider._view);
    })
  );
  vscode.window.onDidChangeActiveTextEditor(() => {
    vscode.commands.executeCommand("template-parts-panel.refresh");
  });
  vscode.workspace.onDidSaveTextDocument(() => {
    vscode.commands.executeCommand("template-parts-panel.refresh");
  });
  // Template Info
  const templateInfoProvider = new TemplateInformationViewProvider(
    context.extensionUri
  );
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      TemplateInformationViewProvider.viewType,
      templateInfoProvider
    )
  );
  context.subscriptions.push(
    vscode.commands.registerCommand("template-info-panel.refresh", () => {
      if (!templateInfoProvider._view) {
        return;
      }
      templateInfoProvider.setContent(templateInfoProvider._view);
    })
  );
  vscode.window.onDidChangeActiveTextEditor(() => {
    vscode.commands.executeCommand("template-info-panel.refresh");
  });
  vscode.workspace.onDidSaveTextDocument(() => {
    vscode.commands.executeCommand("template-info-panel.refresh");
  });
  // Liquid Tests
  const testsProvider = new TestsViewProvider(
    context.extensionUri,
    liquidTestHandler,
    statusBarDevMode
  );
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      TestsViewProvider.viewType,
      testsProvider
    )
  );
  context.subscriptions.push(
    vscode.commands.registerCommand("tests-panel.refresh", () => {
      if (!testsProvider._view) {
        return;
      }
      testsProvider.setContent(testsProvider._view);
    })
  );
  vscode.window.onDidChangeActiveTextEditor(() => {
    vscode.commands.executeCommand("tests-panel.refresh");
  });
  vscode.workspace.onDidSaveTextDocument(() => {
    vscode.commands.executeCommand("tests-panel.refresh");
  });
  // Firm Info
  const firmInfoProvider = new FirmViewProvider(context.extensionUri);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      FirmViewProvider.viewType,
      firmInfoProvider
    )
  );
  // command that can be used to force a refresh of the firms panel
  context.subscriptions.push(
    vscode.commands.registerCommand("firm-panel.refresh", () => {
      if (!firmInfoProvider._view) {
        return;
      }
      firmInfoProvider.setContent(firmInfoProvider._view);
    })
  );
  vscode.window.onDidChangeActiveTextEditor(() => {
    vscode.commands.executeCommand("firm-panel.refresh");
  });
  vscode.workspace.onDidSaveTextDocument(() => {
    vscode.commands.executeCommand("firm-panel.refresh");
  });

  // Development Mode
  vscode.workspace.onDidSaveTextDocument(async (document) => {
    if (testsProvider.devModeStatus !== "active") {
      return;
    }
    switch (testsProvider.devModeOption) {
      case "liquid-tests":
        liquidTestHandler.runTest(
          testsProvider.testDetails.templateHandle,
          testsProvider.testDetails.testName,
          testsProvider.testDetails.previewOnly,
          testsProvider.testDetails.htmlType
        );
        break;
      case "liquid-updates":
        await templateUpdater.pushToSilverfin(document.uri.path);
        break;
    }
  });

  new SharedPartsVerifier(context, outputChannelLog);

  new TemplateCommander(firmHandler, context);

  new AddClosingTag();
}

export function deactivate() {}
