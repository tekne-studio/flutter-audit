import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { AuditResult, LakosOutput, ExtensionConfig, FileStats, SizeLimitViolation, SizeLimits, ImportViolation } from '../types';
import { spawnAsync } from '../util/process';
import { readProjectName } from '../util/dartProject';
import { styleDot } from './dotStyler';
import { renderDotToSvg } from './renderer';
import { collectFileStats, checkSizeLimits, checkImports } from './fileStats';

const LAKOS_IGNORE = '**.freezed.dart,**.g.dart,**.gr.dart';

interface ProgressReporter {
  report(value: { message?: string; increment?: number }): void;
}

export async function runAudit(
  workspaceRoot: string,
  config: ExtensionConfig,
  progress: ProgressReporter,
  token: vscode.CancellationToken,
): Promise<AuditResult> {
  const libDir = path.join(workspaceRoot, 'lib');
  const projectName = readProjectName(workspaceRoot);
  const timestamp = formatTimestamp(new Date());
  const outputDir = path.join(workspaceRoot, config.outputDirectory, timestamp);

  fs.mkdirSync(outputDir, { recursive: true });

  // Step 1: Verify lakos
  progress.report({ message: 'Checking lakos...', increment: 5 });
  const hasLakos = await checkLakos(workspaceRoot);

  // Step 2: File stats
  progress.report({ message: 'Counting files and lines...', increment: 10 });
  throwIfCancelled(token);
  const fileStats = collectFileStats(libDir, config.generatedFilePatterns);
  writeFileStats(outputDir, fileStats);

  // Step 3: Lakos DOT + JSON
  let lakos: LakosOutput | null = null;
  let rawDot: string | null = null;

  if (hasLakos) {
    progress.report({ message: 'Generating dependency graph...', increment: 15 });
    throwIfCancelled(token);

    const dotResult = await spawnAsync(
      'dart', ['run', 'lakos', '-f', 'dot', '-m', '-i', LAKOS_IGNORE, 'lib/'],
      workspaceRoot, token,
    );
    if (dotResult.exitCode === 0 && dotResult.stdout.trim()) {
      rawDot = dotResult.stdout;
      fs.writeFileSync(path.join(outputDir, 'audit-graph.dot'), rawDot);
    }

    progress.report({ message: 'Collecting metrics...', increment: 10 });
    throwIfCancelled(token);

    const jsonResult = await spawnAsync(
      'dart', ['run', 'lakos', '-f', 'json', '-m', '--node-metrics', '-i', LAKOS_IGNORE, 'lib/'],
      workspaceRoot, token,
    );
    if (jsonResult.exitCode === 0 && jsonResult.stdout.trim()) {
      lakos = JSON.parse(jsonResult.stdout) as LakosOutput;
      fs.writeFileSync(path.join(outputDir, 'audit-deps.json'), jsonResult.stdout);
    }
  } else {
    progress.report({ message: 'lakos not found, skipping dependency graph...', increment: 25 });
  }

  // Step 4: Style DOT + render SVG
  let styledDot: string | null = null;
  let svgContent: string | null = null;

  if (rawDot) {
    progress.report({ message: 'Styling graph...', increment: 10 });
    throwIfCancelled(token);

    styledDot = styleDot(rawDot, {
      colors: config.layerColors,
      patterns: config.layerPatterns,
      projectName,
    });
    fs.writeFileSync(path.join(outputDir, 'audit-graph-styled.dot'), styledDot);

    progress.report({ message: 'Rendering SVG (WASM)...', increment: 15 });
    throwIfCancelled(token);

    try {
      svgContent = await renderDotToSvg(styledDot, config.layoutEngine);
      fs.writeFileSync(path.join(outputDir, 'audit-graph.svg'), svgContent);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      vscode.window.showWarningMessage(`SVG rendering failed: ${msg}`);
    }
  }

  // Step 5: Circular dependencies
  if (hasLakos) {
    progress.report({ message: 'Checking circular dependencies...', increment: 5 });
    throwIfCancelled(token);

    const circularResult = await spawnAsync(
      'dart', ['run', 'lakos', '--no-cycles-allowed', '-i', LAKOS_IGNORE, 'lib/'],
      workspaceRoot, token,
    );
    const circularOutput = circularResult.stdout + circularResult.stderr;
    const hasCycles = /cycle|circular/i.test(circularOutput);
    fs.writeFileSync(
      path.join(outputDir, 'audit-circular.txt'),
      hasCycles ? circularOutput : 'No circular dependencies found.',
    );
  }

  // Step 6: Dart analyze
  progress.report({ message: 'Running dart analyze...', increment: 10 });
  throwIfCancelled(token);

  const analyzeResult = await spawnAsync('dart', ['analyze', 'lib/'], workspaceRoot, token);
  const analyzeOutput = analyzeResult.stdout + analyzeResult.stderr;
  fs.writeFileSync(path.join(outputDir, 'audit-analyze.txt'), analyzeOutput);

  // Step 7: Size limits
  progress.report({ message: 'Checking file size limits...', increment: 5 });
  throwIfCancelled(token);

  const sizeLimitViolations = checkSizeLimits(libDir, config.generatedFilePatterns, config.sizeLimits);
  writeSizeLimits(outputDir, sizeLimitViolations, config.sizeLimits);

  // Step 8: Import check
  progress.report({ message: 'Checking import conventions...', increment: 5 });
  throwIfCancelled(token);

  const importViolations = checkImports(libDir, config.generatedFilePatterns);
  writeImportCheck(outputDir, importViolations);

  // Step 9: Summary
  progress.report({ message: 'Writing summary...', increment: 5 });
  if (lakos) {
    writeSummary(outputDir, lakos);
  }

  progress.report({ message: 'Audit complete!', increment: 5 });

  return {
    projectName,
    timestamp,
    outputDir,
    lakos,
    fileStats,
    sizeLimitViolations,
    importViolations,
    analyzeOutput,
    svgContent,
    styledDot,
  };
}

async function checkLakos(cwd: string): Promise<boolean> {
  try {
    const result = await spawnAsync('dart', ['run', 'lakos', '--version'], cwd);
    return result.exitCode === 0;
  } catch {
    return false;
  }
}

function throwIfCancelled(token: vscode.CancellationToken) {
  if (token.isCancellationRequested) {
    throw new Error('Audit cancelled');
  }
}

function formatTimestamp(date: Date): string {
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}-${pad(date.getHours())}-${pad(date.getMinutes())}`;
}

function writeFileStats(outputDir: string, stats: FileStats) {
  const lines = [
    '=== File Statistics ===',
    '',
    `Hand-written .dart files: ${stats.dartFiles}`,
    `Generated files (.freezed/.g): ${stats.generatedFiles}`,
    `Total SLOC (non-blank, non-comment): ${stats.totalSloc}`,
    '',
    '=== Files per directory ===',
    '',
  ];
  const sorted = [...stats.perDirectory.entries()].sort((a, b) => b[1] - a[1]);
  for (const [dir, count] of sorted) {
    lines.push(`  ${count.toString().padStart(4)} ${dir}`);
  }
  fs.writeFileSync(path.join(outputDir, 'audit-stats.txt'), lines.join('\n'));
}

function writeSizeLimits(outputDir: string, violations: SizeLimitViolation[], limits: SizeLimits) {
  const lines = [
    '=== Files Exceeding Size Limits ===',
    '',
    `Screens > ${limits.screens} lines:`,
  ];
  const screens = violations.filter(v => v.category === 'screen');
  if (screens.length === 0) { lines.push('  All screens under limit'); }
  else { screens.forEach(v => lines.push(`  ${v.file} (${v.lines} lines)`)); }

  lines.push('', `Widgets > ${limits.widgets} lines:`);
  const widgets = violations.filter(v => v.category === 'widget');
  if (widgets.length === 0) { lines.push('  All widgets under limit'); }
  else { widgets.forEach(v => lines.push(`  ${v.file} (${v.lines} lines)`)); }

  lines.push('', `Services/Repos/Notifiers > ${limits.services} lines:`);
  const services = violations.filter(v => v.category === 'service');
  if (services.length === 0) { lines.push('  All services/repos/notifiers under limit'); }
  else { services.forEach(v => lines.push(`  ${v.file} (${v.lines} lines)`)); }

  fs.writeFileSync(path.join(outputDir, 'audit-limits.txt'), lines.join('\n'));
}

function writeImportCheck(outputDir: string, violations: ImportViolation[]) {
  const lines = [
    '=== Import Convention Violations ===',
    '',
    'Relative imports (should use package:):',
  ];
  if (violations.length === 0) {
    lines.push('  All imports use package: style');
  } else {
    for (const v of violations) {
      lines.push(`  ${v.file}:${v.line}: ${v.importLine}`);
    }
  }
  fs.writeFileSync(path.join(outputDir, 'audit-imports.txt'), lines.join('\n'));
}

function writeSummary(outputDir: string, lakos: LakosOutput) {
  const m = lakos.metrics;
  const lines = [
    '=== Dependency Metrics ===',
    '',
    `Nodes (files): ${m.numNodes}`,
    `Edges (imports): ${m.numEdges}`,
    `CCD (Cumulative Component Dependency): ${m.ccd}`,
    `ACD (Average Component Dependency): ${m.acd.toFixed(2)}`,
    `NCCD (Normalized CCD): ${m.nccd.toFixed(2)}`,
    '',
    'NCCD interpretation:',
    '  < 1.0 = horizontal (good, loosely coupled)',
    '  1.0   = balanced tree',
    '  > 1.0 = vertical (tightly coupled)',
    '  > 2.0 = likely has cycles',
    '',
    '=== Top 10 Most Depended-On Files ===',
    '',
  ];

  const nodes = Object.values(lakos.nodes);
  const byInDegree = [...nodes].sort((a, b) => b.inDegree - a.inDegree).slice(0, 10);
  for (const n of byInDegree) {
    lines.push(`  ${n.inDegree.toString().padStart(3)} imports <- ${n.id} (${n.sloc} SLOC)`);
  }

  lines.push('', '=== Top 10 Most Coupled Files (highest outDegree) ===', '');
  const byOutDegree = [...nodes].sort((a, b) => b.outDegree - a.outDegree).slice(0, 10);
  for (const n of byOutDegree) {
    lines.push(`  ${n.outDegree.toString().padStart(3)} imports -> ${n.id} (${n.sloc} SLOC)`);
  }

  fs.writeFileSync(path.join(outputDir, 'audit-summary.txt'), lines.join('\n'));
}
