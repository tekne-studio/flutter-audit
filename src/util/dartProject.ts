import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { ExtensionConfig, SizeLimits } from '../types';

export interface DartProject {
  name: string;
  root: string;
}

export function findDartProjects(): DartProject[] {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders) return [];

  const projects: DartProject[] = [];
  const seen = new Set<string>();

  for (const folder of folders) {
    const folderPath = folder.uri.fsPath;

    // Check workspace folder itself
    if (isDartProject(folderPath) && !seen.has(folderPath)) {
      seen.add(folderPath);
      projects.push({ name: readProjectName(folderPath), root: folderPath });
    }

    // Check immediate subdirectories
    try {
      const entries = fs.readdirSync(folderPath, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
        const candidate = path.join(folderPath, entry.name);
        if (isDartProject(candidate) && !seen.has(candidate)) {
          seen.add(candidate);
          projects.push({ name: readProjectName(candidate), root: candidate });
        }
      }
    } catch {
      // ignore read errors
    }
  }

  return projects;
}

export function getWorkspaceRoot(): string | undefined {
  const projects = findDartProjects();
  return projects[0]?.root;
}

export function isDartProject(root: string): boolean {
  return fs.existsSync(path.join(root, 'pubspec.yaml'))
    && fs.existsSync(path.join(root, 'lib'));
}

export function readProjectName(root: string): string {
  const pubspec = path.join(root, 'pubspec.yaml');
  try {
    const content = fs.readFileSync(pubspec, 'utf-8');
    const match = content.match(/^name:\s*['"]?([^'"\n]+)['"]?/m);
    return match?.[1]?.trim() ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

export function readDartSdk(root: string): string {
  const pubspec = path.join(root, 'pubspec.yaml');
  try {
    const content = fs.readFileSync(pubspec, 'utf-8');
    const match = content.match(/sdk:\s*['"]?([^'"\n]+)['"]?/m);
    return match?.[1]?.trim() ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

export function getConfig(): ExtensionConfig {
  const config = vscode.workspace.getConfiguration('flutterAudit');

  return {
    layoutEngine: config.get<string>('layoutEngine', 'fdp'),
    sizeLimits: config.get<SizeLimits>('sizeLimits', {
      screens: 400,
      widgets: 300,
      services: 350,
    }),
    outputDirectory: config.get<string>('outputDirectory', 'audit'),
    generatedFilePatterns: config.get<string[]>('generatedFilePatterns', [
      '**.freezed.dart',
      '**.g.dart',
      '**.gr.dart',
    ]),
  };
}
