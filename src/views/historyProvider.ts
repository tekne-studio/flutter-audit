import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { DartProject } from '../util/dartProject';

type ItemKind = 'project' | 'timestamp' | 'file';

export class AuditHistoryProvider implements vscode.TreeDataProvider<AuditHistoryItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<AuditHistoryItem | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(
    private projects: DartProject[],
    private outputDirectory: string,
  ) {}

  refresh(): void {
    this._onDidChangeTreeData.fire(undefined);
  }

  updateProjects(projects: DartProject[]): void {
    this.projects = projects;
    this.refresh();
  }

  getTreeItem(element: AuditHistoryItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: AuditHistoryItem): AuditHistoryItem[] {
    if (!element) {
      // Root level
      if (this.projects.length === 0) return [];

      // Single project: skip project level, show timestamps directly
      if (this.projects.length === 1) {
        return this.getTimestampItems(this.projects[0]);
      }

      // Multiple projects: show project nodes
      return this.projects.map(p => {
        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '';
        const relPath = path.relative(workspaceRoot, p.root) || '.';
        return new AuditHistoryItem(
          `${p.name} (${relPath})`,
          p.root,
          'project',
          vscode.TreeItemCollapsibleState.Expanded,
          p.root,
        );
      });
    }

    if (element.kind === 'project') {
      const project = this.projects.find(p => p.root === element.dirPath);
      if (!project) return [];
      return this.getTimestampItems(project);
    }

    if (element.kind === 'timestamp') {
      return this.getFileItems(element);
    }

    return [];
  }

  private getTimestampItems(project: DartProject): AuditHistoryItem[] {
    const auditDir = path.join(project.root, this.outputDirectory);
    if (!fs.existsSync(auditDir)) return [];

    const entries = fs.readdirSync(auditDir, { withFileTypes: true })
      .filter(e => e.isDirectory() && /^\d{4}-\d{2}-\d{2}/.test(e.name))
      .sort((a, b) => b.name.localeCompare(a.name));

    return entries.map(e => {
      const dirPath = path.join(auditDir, e.name);
      const hasSvg = fs.existsSync(path.join(dirPath, 'audit-graph.svg'));
      return new AuditHistoryItem(
        e.name,
        dirPath,
        'timestamp',
        vscode.TreeItemCollapsibleState.Collapsed,
        project.root,
        hasSvg,
      );
    });
  }

  private getFileItems(element: AuditHistoryItem): AuditHistoryItem[] {
    const files = fs.readdirSync(element.dirPath)
      .filter(f => !f.endsWith('.dot'))
      .sort();

    return files.map(f => new AuditHistoryItem(
      f,
      path.join(element.dirPath, f),
      'file',
      vscode.TreeItemCollapsibleState.None,
      element.projectRoot,
    ));
  }
}

export class AuditHistoryItem extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly dirPath: string,
    public readonly kind: ItemKind,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly projectRoot?: string,
    public readonly hasSvg?: boolean,
  ) {
    super(label, collapsibleState);

    switch (kind) {
      case 'project':
        this.iconPath = new vscode.ThemeIcon('package');
        this.contextValue = 'dartProject';
        break;

      case 'timestamp':
        this.iconPath = new vscode.ThemeIcon('history');
        this.contextValue = hasSvg ? 'auditWithGraph' : 'audit';
        break;

      case 'file':
        this.command = {
          command: 'vscode.open',
          title: 'Open File',
          arguments: [vscode.Uri.file(dirPath)],
        };
        if (label.endsWith('.svg')) {
          this.iconPath = new vscode.ThemeIcon('graph');
        } else if (label.endsWith('.json')) {
          this.iconPath = new vscode.ThemeIcon('json');
        } else if (label.endsWith('.html')) {
          this.iconPath = new vscode.ThemeIcon('globe');
        } else {
          this.iconPath = new vscode.ThemeIcon('file');
        }
        break;
    }
  }
}
