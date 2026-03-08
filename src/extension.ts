import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { getWorkspaceRoot, isDartProject, getConfig } from './util/dartProject';
import { runAudit } from './audit/runner';
import { ViewerPanel } from './views/viewerPanel';
import { AuditHistoryProvider, AuditHistoryItem } from './views/historyProvider';
import { createStatusBarItem, showStatusBarProgress, resetStatusBar } from './views/statusBar';
import { AuditResult } from './types';

let lastAuditResult: AuditResult | undefined;

export function activate(context: vscode.ExtensionContext) {
  const config = getConfig();
  const root = getWorkspaceRoot();

  // Status bar
  const statusBarItem = createStatusBarItem();
  if (root && isDartProject(root)) {
    statusBarItem.show();
  }
  context.subscriptions.push(statusBarItem);

  // Tree view
  const historyProvider = new AuditHistoryProvider(root, config.outputDirectory);
  const treeView = vscode.window.createTreeView('flutterAudit.history', {
    treeDataProvider: historyProvider,
  });
  context.subscriptions.push(treeView);

  // Command: Run Audit
  context.subscriptions.push(
    vscode.commands.registerCommand('flutterAudit.run', async () => {
      const workspaceRoot = getWorkspaceRoot();
      if (!workspaceRoot) {
        vscode.window.showErrorMessage('No workspace folder open.');
        return;
      }

      if (!isDartProject(workspaceRoot)) {
        vscode.window.showErrorMessage('Not a Dart/Flutter project (no pubspec.yaml or lib/).');
        return;
      }

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
            return runAudit(workspaceRoot, currentConfig, progress, token);
          },
        );

        resetStatusBar(statusBarItem);
        historyProvider.refresh();

        if (lastAuditResult.svgContent && lastAuditResult.lakos) {
          const panel = ViewerPanel.createOrShow(context.extensionUri, workspaceRoot);
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
    }),
  );

  // Command: Open Viewer (re-show last or from history)
  context.subscriptions.push(
    vscode.commands.registerCommand('flutterAudit.openViewer', async () => {
      const workspaceRoot = getWorkspaceRoot();
      if (!workspaceRoot) {
        vscode.window.showErrorMessage('No workspace folder open.');
        return;
      }

      if (lastAuditResult?.svgContent) {
        const panel = ViewerPanel.createOrShow(context.extensionUri, workspaceRoot);
        panel.sendAuditData(lastAuditResult);
      } else {
        vscode.window.showInformationMessage('No audit data. Run an audit first.');
      }
    }),
  );

  // Command: Open Viewer from History
  context.subscriptions.push(
    vscode.commands.registerCommand('flutterAudit.openFromHistory', (item: AuditHistoryItem) => {
      const workspaceRoot = getWorkspaceRoot();
      if (!workspaceRoot) {
        vscode.window.showErrorMessage('No workspace folder open.');
        return;
      }

      const result = loadAuditFromDisk(item.dirPath);
      if (!result) {
        vscode.window.showWarningMessage('Could not load audit data from this directory.');
        return;
      }

      const panel = ViewerPanel.createOrShow(context.extensionUri, workspaceRoot);
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
      const newRoot = getWorkspaceRoot();
      historyProvider.updateWorkspaceRoot(newRoot);
      if (newRoot && isDartProject(newRoot)) {
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
