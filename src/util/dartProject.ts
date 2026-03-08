import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { ExtensionConfig, LayerColors, LayerPatterns, SizeLimits } from '../types';

export function getWorkspaceRoot(): string | undefined {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
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
    layerColors: config.get<LayerColors>('layerColors', {
      presentation: '#FF8800',
      application: '#CC00FF',
      domain: '#00D9FF',
      infrastructure: '#00FF88',
      core: '#888888',
      app: '#00D9FF',
      entry: '#CC00FF',
    }),
    layerPatterns: config.get<LayerPatterns>('layerPatterns', {
      presentation: '/presentation/',
      application: '/application/',
      domain: '/domain/',
      infrastructure: '/infrastructure/',
      core: '/core/',
      app: '/app/',
    }),
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
