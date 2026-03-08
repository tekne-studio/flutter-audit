import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

export class AuditHistoryProvider implements vscode.TreeDataProvider<AuditHistoryItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<AuditHistoryItem | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(
    private workspaceRoot: string | undefined,
    private outputDirectory: string,
  ) {}

  refresh(): void {
    this._onDidChangeTreeData.fire(undefined);
  }

  updateWorkspaceRoot(root: string | undefined): void {
    this.workspaceRoot = root;
    this.refresh();
  }

  getTreeItem(element: AuditHistoryItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: AuditHistoryItem): AuditHistoryItem[] {
    if (!this.workspaceRoot) { return []; }

    const auditDir = path.join(this.workspaceRoot, this.outputDirectory);
    if (!fs.existsSync(auditDir)) { return []; }

    if (!element) {
      // Root: list timestamp directories
      const entries = fs.readdirSync(auditDir, { withFileTypes: true })
        .filter(e => e.isDirectory() && /^\d{4}-\d{2}-\d{2}/.test(e.name))
        .sort((a, b) => b.name.localeCompare(a.name)); // Newest first

      return entries.map(e => {
        const dirPath = path.join(auditDir, e.name);
        const hasSvg = fs.existsSync(path.join(dirPath, 'audit-graph.svg'));
        return new AuditHistoryItem(
          e.name,
          dirPath,
          hasSvg,
          vscode.TreeItemCollapsibleState.Collapsed,
        );
      });
    }

    // Children: list files in audit directory
    const files = fs.readdirSync(element.dirPath)
      .filter(f => !f.endsWith('.dot')) // Skip DOT intermediates
      .sort();

    return files.map(f => new AuditHistoryItem(
      f,
      path.join(element.dirPath, f),
      false,
      vscode.TreeItemCollapsibleState.None,
    ));
  }
}

export class AuditHistoryItem extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly dirPath: string,
    public readonly hasSvg: boolean,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState,
  ) {
    super(label, collapsibleState);

    if (collapsibleState === vscode.TreeItemCollapsibleState.None) {
      // File item — open on click
      this.command = {
        command: 'vscode.open',
        title: 'Open File',
        arguments: [vscode.Uri.file(dirPath)],
      };

      // Set icon based on file type
      if (label.endsWith('.svg')) {
        this.iconPath = new vscode.ThemeIcon('graph');
      } else if (label.endsWith('.json')) {
        this.iconPath = new vscode.ThemeIcon('json');
      } else if (label.endsWith('.html')) {
        this.iconPath = new vscode.ThemeIcon('globe');
      } else {
        this.iconPath = new vscode.ThemeIcon('file');
      }
    } else {
      // Directory item
      this.iconPath = new vscode.ThemeIcon('history');
      this.contextValue = hasSvg ? 'auditWithGraph' : 'audit';
    }
  }
}
