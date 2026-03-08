import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { findDartProjects, getConfig, DartProject } from './util/dartProject';
import { runAudit } from './audit/runner';
import { ViewerPanel } from './views/viewerPanel';
import { AuditHistoryProvider, AuditHistoryItem } from './views/historyProvider';
import { createStatusBarItem, showStatusBarProgress, resetStatusBar } from './views/statusBar';
import { AuditResult } from './types';

let lastAuditResult: AuditResult | undefined;

export function activate(context: vscode.ExtensionContext) {
  const config = getConfig();
  const projects = findDartProjects();

  // Status bar
  const statusBarItem = createStatusBarItem();
  if (projects.length > 0) {
    statusBarItem.show();
  }
  context.subscriptions.push(statusBarItem);

  // Tree view
  const historyProvider = new AuditHistoryProvider(projects, config.outputDirectory);
  const treeView = vscode.window.createTreeView('flutterAudit.history', {
    treeDataProvider: historyProvider,
  });
  context.subscriptions.push(treeView);

  // Shared: run audit on a specific project root
  async function executeAudit(projectRoot: string) {
    const currentConfig = getConfig();
    showStatusBarProgress(statusBarItem);

    try {
      lastAuditResult = await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: 'Flutter Audit',
          cancellable: true,
        },
        async (progress, token) => {
          return runAudit(projectRoot, currentConfig, progress, token);
        },
      );

      resetStatusBar(statusBarItem);
      historyProvider.refresh();

      if (lastAuditResult.svgContent && lastAuditResult.lakos) {
        const panel = ViewerPanel.createOrShow(context.extensionUri, projectRoot);
        panel.sendAuditData(lastAuditResult);
      }

      // Summary notification
      const m = lastAuditResult.lakos?.metrics;
      const msg = m
        ? `Audit complete: ${m.numNodes} files, ${m.numEdges} imports, NCCD: ${m.nccd.toFixed(2)}`
        : `Audit complete: ${lastAuditResult.fileStats.dartFiles} files, ${lastAuditResult.fileStats.totalSloc} SLOC`;

      const action = await vscode.window.showInformationMessage(msg, 'Open Folder');
      if (action === 'Open Folder') {
        vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(lastAuditResult.outputDir));
      }
    } catch (err) {
      resetStatusBar(statusBarItem);
      if (err instanceof Error && err.message === 'Audit cancelled') {
        vscode.window.showInformationMessage('Audit cancelled.');
      } else {
        const msg = err instanceof Error ? err.message : String(err);
        vscode.window.showErrorMessage(`Audit failed: ${msg}`);
      }
    }
  }

  // Pick a project (QuickPick if multiple, direct if single)
  async function pickProject(): Promise<string | undefined> {
    const currentProjects = findDartProjects();

    if (currentProjects.length === 0) {
      vscode.window.showErrorMessage('No Dart/Flutter projects found in workspace.');
      return undefined;
    }

    if (currentProjects.length === 1) {
      return currentProjects[0].root;
    }

    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '';
    const items = currentProjects.map(p => ({
      label: p.name,
      description: path.relative(workspaceRoot, p.root) || '.',
      root: p.root,
    }));

    const picked = await vscode.window.showQuickPick(items, {
      placeHolder: 'Select a project to audit',
    });

    return picked?.root;
  }

  // Command: Run Audit (with QuickPick if multiple projects)
  context.subscriptions.push(
    vscode.commands.registerCommand('flutterAudit.run', async () => {
      const projectRoot = await pickProject();
      if (projectRoot) {
        await executeAudit(projectRoot);
      }
    }),
  );

  // Command: Run Audit for a specific project (from tree item)
  context.subscriptions.push(
    vscode.commands.registerCommand('flutterAudit.runForProject', async (item: AuditHistoryItem) => {
      if (item?.projectRoot) {
        await executeAudit(item.projectRoot);
      }
    }),
  );

  // Command: Open Viewer (re-show last or from history)
  context.subscriptions.push(
    vscode.commands.registerCommand('flutterAudit.openViewer', async () => {
      if (lastAuditResult?.svgContent) {
        const projectRoot = lastAuditResult.outputDir.split(path.sep).slice(0, -2).join(path.sep);
        const panel = ViewerPanel.createOrShow(context.extensionUri, projectRoot);
        panel.sendAuditData(lastAuditResult);
      } else {
        vscode.window.showInformationMessage('No audit data. Run an audit first.');
      }
    }),
  );

  // Command: Open Viewer from History
  context.subscriptions.push(
    vscode.commands.registerCommand('flutterAudit.openFromHistory', (item: AuditHistoryItem) => {
      const result = loadAuditFromDisk(item.dirPath);
      if (!result) {
        vscode.window.showWarningMessage('Could not load audit data from this directory.');
        return;
      }

      const projectRoot = item.projectRoot ?? item.dirPath;
      const panel = ViewerPanel.createOrShow(context.extensionUri, projectRoot);
      panel.sendAuditData(result);
    }),
  );

  // Command: Show History
  context.subscriptions.push(
    vscode.commands.registerCommand('flutterAudit.showHistory', () => {
      treeView.reveal(undefined as any, { focus: true });
    }),
  );

  // Watch for workspace changes
  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      const newProjects = findDartProjects();
      historyProvider.updateProjects(newProjects);
      if (newProjects.length > 0) {
        statusBarItem.show();
      } else {
        statusBarItem.hide();
      }
    }),
  );
}

export function deactivate() {}

function loadAuditFromDisk(dirPath: string): AuditResult | null {
  const svgPath = path.join(dirPath, 'audit-graph.svg');
  const jsonPath = path.join(dirPath, 'audit-deps.json');

  if (!fs.existsSync(svgPath)) { return null; }

  const svgContent = fs.readFileSync(svgPath, 'utf-8');
  const lakos = fs.existsSync(jsonPath)
    ? JSON.parse(fs.readFileSync(jsonPath, 'utf-8'))
    : null;

  return {
    projectName: '',
    timestamp: path.basename(dirPath),
    outputDir: dirPath,
    lakos,
    fileStats: { dartFiles: 0, generatedFiles: 0, totalSloc: 0, perDirectory: new Map() },
    sizeLimitViolations: [],
    importViolations: [],
    analyzeOutput: '',
    svgContent,
    styledDot: null,
  };
}
