import * as vscode from "vscode";
import * as utils from "../utilities/utils";
import ExtensionContext from "./extensionContext";
import ExtensionLoggerWrapper from "./outputChannels/extensionLoggerWrapper";
import UserLogger from "./outputChannels/userLogger";
import SilverfinToolkit from "./silverfinToolkit";

/**
 * A class to handle the commands to run on the templates, interacting with the Silverfin API (using the `silverfin-cli` package).
 * Registers the command `silverfin-development-toolkit.templateCommandsInBulk` to run the `runCommandOnTemplatesInBulk` method.
 */
export default class TemplateCommander {
  private extensionLogger: ExtensionLoggerWrapper = new ExtensionLoggerWrapper(
    "TemplateCommander"
  );
  private userLogger: UserLogger = UserLogger.plug();
  constructor() {
    this.registerEvents();
  }

  /**
   * A VSCode command that open a Quick Pick panel to select a command to run.
   * It works in three steps. First you select the command to run (`import`, `create`, `update`, `get-id`).
   * Then you select the templates to run the command on. Finally, you select the firm to run the command on.
   * The command is then run and the output is logged to the user channel.
   */
  private async runCommandOnTemplatesInBulk() {
    const check = utils.setCWD();
    if (!check) {
      return;
    }

    const selectedOption = await this.selectCommand();
    if (!selectedOption) {
      vscode.window.showErrorMessage(`No command option was selected`);
      return;
    }

    const addOrRemoveSharedPart = this.checkIfCommandIsSharedPart(
      selectedOption.label
    );

    if (addOrRemoveSharedPart) {
      const selectedSharedParts = await this.selectTemplates(true, false);
      if (selectedSharedParts?.length === 0 || !selectedSharedParts) {
        vscode.window.showErrorMessage(`No template was selected`);
        return;
      }

      const selectedTemplates = await this.selectTemplates(false, true);
      if (selectedTemplates?.length === 0 || !selectedTemplates) {
        vscode.window.showErrorMessage(`No template was selected`);
        return;
      }

      vscode.window.showErrorMessage(
        `Shared parts commands are not yet implemented`
      );
      return;
    } else {
      const selectedTemplates = await this.selectTemplates();
      if (selectedTemplates?.length === 0 || !selectedTemplates) {
        vscode.window.showErrorMessage(`No template was selected`);
        return;
      }

      const selectedFirm = await this.selectFirm();
      if (selectedFirm?.length !== 1 || !selectedFirm) {
        vscode.window.showErrorMessage(
          `One and only one firm must be selected`
        );
        return;
      }

      await this.runEachSilverfinAction(
        Number(selectedFirm[0].label),
        selectedOption.label,
        selectedTemplates
      );
    }
  }

  /**
   * Show a QuickPick panel to select a command to run.
   * The options are `Create`, `Import`, `Update` and `Get template id`.
   * @returns A QuickPickItem with the selected command
   */
  private async selectCommand() {
    const optionCreate: vscode.QuickPickItem = {
      label: this.commandLabelMapper.create,
      description:
        "Create template in the Platform using code from this repository"
    };
    const optionImport: vscode.QuickPickItem = {
      label: this.commandLabelMapper.import,
      description:
        "Import template's code from Platform into this repository (existing files will be overwritten)"
    };
    const optionUpdate: vscode.QuickPickItem = {
      label: this.commandLabelMapper.update,
      description:
        "Update template's code in the Platform using code from this repository"
    };
    const optionGetId: vscode.QuickPickItem = {
      label: this.commandLabelMapper.getTemplateId,
      description: "Get the template id from the Platform"
    };
    const optionAddSharedPart: vscode.QuickPickItem = {
      label: this.commandLabelMapper.addSharedPart,
      description: "Add a shared part to a template"
    };
    const optionRemoveSharedPart: vscode.QuickPickItem = {
      label: this.commandLabelMapper.removeSharedPart,
      description: "Remove a shared part from a template"
    };
    const optionsToSelect: vscode.QuickPickItem[] = [
      optionCreate,
      optionImport,
      optionUpdate,
      optionAddSharedPart,
      optionRemoveSharedPart,
      optionGetId
    ];

    const selectedOption = await vscode.window.showQuickPick(optionsToSelect, {
      placeHolder: "Which command do you want to run?",
      title: "Select a command",
      canPickMany: false,
      matchOnDescription: true
    });

    this.extensionLogger.log("Selected command", selectedOption);

    return selectedOption;
  }

  /**
   * Show a QuickPick panel to select the templates to run the command on.
   * The options are all the templates in the repository.
   * @param includeSharedParts Whether to include shared parts in the options
   * @param includeTemplates Whether to include templates in the options (reconciliationText, accountTemplate, exportFile)
   * @returns A `QuickPickItem` with the selected templates
   */
  private async selectTemplates(
    includeSharedParts: boolean = true,
    includeTemplates: boolean = true
  ) {
    const optionsToSelect: vscode.QuickPickItem[] = [];
    if (includeSharedParts) {
      const sharedParts = await SilverfinToolkit.fsUtils.getAllTemplatesOfAType(
        "sharedPart"
      );
      for (const template of sharedParts) {
        optionsToSelect.push({
          label: template,
          description: this.templateTypeMapper.sharedPart
        });
      }
    }
    if (includeTemplates) {
      const reconciliations =
        await SilverfinToolkit.fsUtils.getAllTemplatesOfAType(
          "reconciliationText"
        );
      for (const template of reconciliations) {
        optionsToSelect.push({
          label: template,
          description: this.templateTypeMapper.reconciliationText
        });
      }
      const accountTemplates =
        await SilverfinToolkit.fsUtils.getAllTemplatesOfAType(
          "accountTemplate"
        );
      for (const template of accountTemplates) {
        optionsToSelect.push({
          label: template,
          description: this.templateTypeMapper.accountTemplate
        });
      }
      const exportFiles = await SilverfinToolkit.fsUtils.getAllTemplatesOfAType(
        "exportFile"
      );
      for (const template of exportFiles) {
        optionsToSelect.push({
          label: template,
          description: this.templateTypeMapper.exportFile
        });
      }
    }

    const selectedOption = await vscode.window.showQuickPick(optionsToSelect, {
      placeHolder: "Which template/s do you want to use?",
      title: "Select templates",
      canPickMany: true,
      matchOnDescription: true
    });

    this.extensionLogger.log("Selected template/s", selectedOption);

    return selectedOption;
  }

  /**
   * Show a QuickPick panel to select the firm to run the command on.
   * The options are all the firms the user has access to.
   * The default value is the current firm.
   * @returns A QuickPickItem with the selected firm
   */
  private async selectFirm() {
    const firmData =
      await SilverfinToolkit.firmCredentials.listAuthorizedFirms(); // [[firmId, firmName]...]
    const defaultFirm =
      await SilverfinToolkit.firmCredentials.getDefaultFirmId();
    const optionsToSelect: vscode.QuickPickItem[] = [];

    for (const firm of firmData) {
      let alreadyPicked = false;
      if (firm[0].toString() === defaultFirm.toString()) {
        alreadyPicked = true;
      }
      optionsToSelect.push({
        label: firm[0],
        description: firm[1],
        picked: alreadyPicked
      });
    }

    const selectedOption = await vscode.window.showQuickPick(optionsToSelect, {
      placeHolder: "Which firm do you want to use?",
      title: "Select a firm",
      canPickMany: true,
      matchOnDescription: true
    });

    this.extensionLogger.log("Selected firm", selectedOption);

    return selectedOption;
  }

  private async runEachSilverfinAction(
    firmId: Number,
    commandChoiceLabel: string,
    templates: vscode.QuickPickItem[]
  ) {
    this.extensionLogger.log("Start command run", {
      commandChoiceLabel,
      templates,
      firmId
    });

    const commandType = Object.keys(this.commandLabelMapper).find(
      (key) => this.commandLabelMapper[key] === commandChoiceLabel
    );

    for (const template of templates) {
      const templateType = Object.keys(this.templateTypeMapper).find(
        (key) => this.templateTypeMapper[key] === template.description
      );
      const templateHandle = template.label;

      if (!templateType || !templateHandle || !commandType) {
        this.extensionLogger.log("Could not run command. Parameter missing", {
          templateType,
          templateHandle,
          commandType
        });
        return false;
      }

      let commandToRun;
      let commandArgs;
      let resultRun;

      if (commandType === "getTemplateId") {
        commandToRun = SilverfinToolkit.toolkit.getTemplateId;
        commandArgs = [String(firmId), templateType, templateHandle];
      } else {
        commandToRun = this.commandMapper[commandType][templateType];
        commandArgs = [String(firmId), templateHandle];
      }

      this.extensionLogger.log("Run command", {
        commandChoiceLabel,
        templateType,
        templateHandle
      });

      resultRun = await this.callSilverfinApi(commandToRun, ...commandArgs);

      const userMessage = `${commandChoiceLabel}: ${templateHandle} (${this.templateTypeMapper[templateType]}) in firm ${firmId}`;
      if (resultRun) {
        this.userLogger.log(userMessage + " - Success");
      } else {
        this.userLogger.log(userMessage + " - Failed");
      }
    }
  }

  private checkIfCommandIsSharedPart(command: string) {
    return (
      command === this.commandLabelMapper.addSharedPart ||
      command === this.commandLabelMapper.removeSharedPart
    );
  }

  /**
   * Register the command `silverfin-development-toolkit.templateCommandsInBulk` to run the `runCommandOnTemplatesInBulk` method.
   * The command is available in the Command Palette.
   * @returns void
   */
  private registerEvents() {
    const extensionContext = ExtensionContext.get();
    extensionContext.subscriptions.push(
      vscode.commands.registerCommand(
        "silverfin-development-toolkit.templateCommandsInBulk",
        async () => {
          await this.runCommandOnTemplatesInBulk();
        }
      )
    );
  }

  private commandMapper: { [index: string]: { [index: string]: any } } = {
    create: {
      reconciliationText: SilverfinToolkit.toolkit.newReconciliation,
      sharedPart: SilverfinToolkit.toolkit.newSharedPart,
      accountTemplate: SilverfinToolkit.toolkit.newAccountTemplate,
      exportFile: SilverfinToolkit.toolkit.newExportFile
    },
    import: {
      reconciliationText: SilverfinToolkit.toolkit.fetchReconciliationByHandle,
      sharedPart: SilverfinToolkit.toolkit.fetchSharedPartByName,
      accountTemplate: SilverfinToolkit.toolkit.fetchAccountTemplateByName,
      exportFile: SilverfinToolkit.toolkit.fetchExportFileByName
    },
    update: {
      reconciliationText:
        SilverfinToolkit.toolkit.publishReconciliationByHandle,
      sharedPart: SilverfinToolkit.toolkit.publishSharedPartByName,
      accountTemplate: SilverfinToolkit.toolkit.publishAccountTemplateByName,
      exportFile: SilverfinToolkit.toolkit.publishExportFileByName
    }
  };

  private templateTypeMapper: { [index: string]: string } = {
    reconciliationText: "Reconciliation Text",
    sharedPart: "Shared Part",
    accountTemplate: "Account Template",
    exportFile: "Export File"
  };

  private commandLabelMapper: { [index: string]: string } = {
    create: "Create",
    import: "Import",
    update: "Update",
    getTemplateId: "Get template id",
    addSharedPart: "Add Shared Part",
    removeSharedPart: "Remove Shared Part"
  };

  // THIS WON'T WORK UNTIL SILVERFIN-CLI IS UPDATED
  // it does not return any value, it just logs to the console
  private async callSilverfinApi(command: FunctionType, ...args: string[]) {
    try {
      const result = await command(...args);
      this.extensionLogger.log("Command result", result);
      return result;
    } catch (error) {
      this.extensionLogger.log("Error running command", error);
      return false;
    }
  }
}

type FunctionType = (...args: string[]) => any;
