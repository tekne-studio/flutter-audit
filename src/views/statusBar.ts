import * as vscode from 'vscode';

export function createStatusBarItem(): vscode.StatusBarItem {
  const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);
  item.command = 'flutterAudit.run';
  item.text = '$(graph) Audit';
  item.tooltip = 'Run Flutter Audit';
  return item;
}

export function showStatusBarProgress(item: vscode.StatusBarItem): void {
  item.text = '$(loading~spin) Auditing...';
  item.tooltip = 'Audit in progress...';
}

export function resetStatusBar(item: vscode.StatusBarItem): void {
  item.text = '$(graph) Audit';
  item.tooltip = 'Run Flutter Audit';
}
