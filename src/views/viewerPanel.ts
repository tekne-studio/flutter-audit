import * as vscode from 'vscode';
import * as path from 'path';
import { AuditResult } from '../types';
import { getViewerHtml, generateNonce } from './viewerHtml';

export class ViewerPanel {
  private static currentPanel: ViewerPanel | undefined;
  private readonly panel: vscode.WebviewPanel;
  private readonly extensionUri: vscode.Uri;
  private disposables: vscode.Disposable[] = [];

  private constructor(
    panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
    workspaceRoot: string,
  ) {
    this.panel = panel;
    this.extensionUri = extensionUri;

    this.panel.webview.html = getViewerHtml(
      this.panel.webview,
      this.extensionUri,
      generateNonce(),
    );

    this.panel.webview.onDidReceiveMessage(
      (message) => this.handleMessage(message, workspaceRoot),
      null,
      this.disposables,
    );

    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
  }

  static createOrShow(
    extensionUri: vscode.Uri,
    workspaceRoot: string,
  ): ViewerPanel {
    const column = vscode.ViewColumn.Beside;

    if (ViewerPanel.currentPanel) {
      ViewerPanel.currentPanel.panel.reveal(column);
      return ViewerPanel.currentPanel;
    }

    const panel = vscode.window.createWebviewPanel(
      'flutterAuditViewer',
      'Flutter Audit',
      column,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.joinPath(extensionUri, 'webview'),
        ],
      },
    );

    ViewerPanel.currentPanel = new ViewerPanel(panel, extensionUri, workspaceRoot);
    return ViewerPanel.currentPanel;
  }

  sendAuditData(result: AuditResult) {
    this.panel.webview.postMessage({
      command: 'loadAudit',
      svg: result.svgContent,
      metrics: result.lakos,
      projectName: result.projectName,
      timestamp: result.timestamp,
      fileStats: {
        dartFiles: result.fileStats.dartFiles,
        generatedFiles: result.fileStats.generatedFiles,
        totalSloc: result.fileStats.totalSloc,
      },
    });
  }

  private handleMessage(message: any, workspaceRoot: string) {
    switch (message.command) {
      case 'openFile': {
        const filePath = path.join(workspaceRoot, 'lib', message.path);
        const uri = vscode.Uri.file(filePath);
        vscode.workspace.openTextDocument(uri).then(
          (doc) => vscode.window.showTextDocument(doc, vscode.ViewColumn.One),
          () => vscode.window.showWarningMessage(`File not found: ${message.path}`),
        );
        break;
      }
      case 'copyMetrics': {
        vscode.env.clipboard.writeText(message.text);
        vscode.window.showInformationMessage('Metrics copied to clipboard');
        break;
      }
    }
  }

  dispose() {
    ViewerPanel.currentPanel = undefined;
    this.panel.dispose();
    for (const d of this.disposables) {
      d.dispose();
    }
    this.disposables = [];
  }
}
