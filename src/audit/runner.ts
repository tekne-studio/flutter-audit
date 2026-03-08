import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { AuditResult, LakosOutput, ExtensionConfig, ClassificationResult, FileStats, SizeLimitViolation, SizeLimits, ImportViolation } from '../types';
import { spawnAsync } from '../util/process';
import { readProjectName } from '../util/dartProject';
import { styleDot } from './dotStyler';
import { renderDotToSvg } from './renderer';
import { collectFileStats, checkSizeLimits, checkImports } from './fileStats';
import { classifyProject } from './layerClassifier';

const LAKOS_IGNORE = '**.freezed.dart,**.g.dart,**.gr.dart';

interface ProgressReporter {
  report(value: { message?: string; increment?: number }): void;
}

interface Logger {
  appendLine(value: string): void;
}

const noopLogger: Logger = { appendLine: () => {} };

export async function runAudit(
  workspaceRoot: string,
  config: ExtensionConfig,
  progress: ProgressReporter,
  token: vscode.CancellationToken,
  log: Logger = noopLogger,
): Promise<AuditResult> {
  const libDir = path.join(workspaceRoot, 'lib');
  const projectName = readProjectName(workspaceRoot);
  const timestamp = formatTimestamp(new Date());
  const outputDir = path.join(workspaceRoot, config.outputDirectory, timestamp);

  fs.mkdirSync(outputDir, { recursive: true });
  log.appendLine(`[Step 0] Output directory: ${outputDir}`);

  // Step 1: Verify lakos
  progress.report({ message: 'Checking lakos...', increment: 5 });
  const hasLakos = checkLakos(workspaceRoot);
  log.appendLine(`[Step 1] lakos found in pubspec.yaml: ${hasLakos}`);

  // Step 2: File stats
  progress.report({ message: 'Counting files and lines...', increment: 10 });
  throwIfCancelled(token);
  const fileStats = collectFileStats(libDir, config.generatedFilePatterns);
  writeFileStats(outputDir, fileStats);
  log.appendLine(`[Step 2] File stats: ${fileStats.dartFiles} dart files, ${fileStats.generatedFiles} generated, ${fileStats.totalSloc} SLOC`);

  // Step 3: Lakos DOT + JSON
  let lakos: LakosOutput | null = null;
  let rawDot: string | null = null;
  let lakosAvailable = hasLakos;

  if (!lakosAvailable) {
    progress.report({ message: 'lakos not found...', increment: 5 });
    log.appendLine(`[Step 3] lakos not in dev_dependencies`);

    const action = await vscode.window.showWarningMessage(
      'lakos is not installed. The dependency graph requires lakos. Add it now?',
      'Add lakos',
      'Skip',
    );
    if (action === 'Add lakos') {
      log.appendLine(`[Step 3] Installing lakos...`);
      const addResult = await spawnAsync('dart', ['pub', 'add', '--dev', 'lakos'], workspaceRoot, token);
      if (addResult.exitCode === 0) {
        log.appendLine(`[Step 3] lakos installed successfully. Continuing with graph generation...`);
        lakosAvailable = true;
      } else {
        log.appendLine(`[Step 3] Failed to install lakos: ${addResult.stderr}`);
        vscode.window.showErrorMessage(`Failed to add lakos: ${addResult.stderr}`);
      }
    }
  }

  if (lakosAvailable) {
    progress.report({ message: 'Generating dependency graph...', increment: 15 });
    throwIfCancelled(token);

    log.appendLine(`[Step 3] Running: dart run lakos -f dot -m -i "${LAKOS_IGNORE}" lib/`);
    const dotResult = await spawnAsync(
      'dart', ['run', 'lakos', '-f', 'dot', '-m', '-i', LAKOS_IGNORE, 'lib/'],
      workspaceRoot, token,
    );
    log.appendLine(`[Step 3] lakos DOT exit code: ${dotResult.exitCode}`);
    if (dotResult.stdout.includes('digraph')) {
      rawDot = dotResult.stdout;
      fs.writeFileSync(path.join(outputDir, 'audit-graph.dot'), rawDot);
      log.appendLine(`[Step 3] DOT output saved (${rawDot.length} chars)`);
      if (dotResult.exitCode !== 0) {
        log.appendLine(`[Step 3] lakos exited with ${dotResult.exitCode} (likely cycles detected — output is still valid)`);
      }
    } else {
      const allOutput = (dotResult.stdout + dotResult.stderr).trim();
      log.appendLine(`[Step 3] lakos DOT FAILED (exit ${dotResult.exitCode})`);
      if (allOutput) {
        log.appendLine(`[Step 3] lakos output: ${allOutput}`);
      }
      vscode.window.showWarningMessage(`lakos failed (exit ${dotResult.exitCode}). Check the Flutter Audit output for details.`);
    }

    progress.report({ message: 'Collecting metrics...', increment: 10 });
    throwIfCancelled(token);

    log.appendLine(`[Step 3] Running: dart run lakos -f json -m --node-metrics -i "${LAKOS_IGNORE}" lib/`);
    const jsonResult = await spawnAsync(
      'dart', ['run', 'lakos', '-f', 'json', '-m', '--node-metrics', '-i', LAKOS_IGNORE, 'lib/'],
      workspaceRoot, token,
    );
    log.appendLine(`[Step 3] lakos JSON exit code: ${jsonResult.exitCode}`);
    if (jsonResult.stdout.includes('"nodes"')) {
      lakos = JSON.parse(jsonResult.stdout) as LakosOutput;
      fs.writeFileSync(path.join(outputDir, 'audit-deps.json'), jsonResult.stdout);
      log.appendLine(`[Step 3] JSON parsed: ${Object.keys(lakos.nodes).length} nodes, ${lakos.edges.length} edges`);
      if (jsonResult.exitCode !== 0) {
        log.appendLine(`[Step 3] lakos exited with ${jsonResult.exitCode} (likely cycles detected — output is still valid)`);
      }
    } else {
      const allOutput = (jsonResult.stdout + jsonResult.stderr).trim();
      log.appendLine(`[Step 3] lakos JSON FAILED (exit ${jsonResult.exitCode})`);
      if (allOutput) {
        log.appendLine(`[Step 3] lakos output: ${allOutput}`);
      }
    }
  } else {
    progress.report({ message: 'Skipping dependency graph...', increment: 20 });
    log.appendLine(`[Step 3] SKIPPED — lakos not available`);
  }

  // Step 4: Classify layers + Style DOT + render SVG
  let classification: ClassificationResult | null = null;
  let styledDot: string | null = null;
  let svgContent: string | null = null;

  if (rawDot && lakos) {
    progress.report({ message: 'Classifying architectural layers...', increment: 5 });
    throwIfCancelled(token);

    classification = await classifyProject(lakos, libDir, config.generatedFilePatterns);
    const layerNames = Object.keys(classification.layers);
    log.appendLine(`[Step 4] Classification complete: ${layerNames.length} layers detected [${layerNames.join(', ')}]`);

    progress.report({ message: 'Styling graph...', increment: 5 });
    throwIfCancelled(token);

    styledDot = styleDot(rawDot, {
      classification,
      projectName,
    });
    fs.writeFileSync(path.join(outputDir, 'audit-graph-styled.dot'), styledDot);
    log.appendLine(`[Step 4] Styled DOT saved (${styledDot.length} chars)`);

    progress.report({ message: 'Rendering SVG (WASM)...', increment: 15 });
    throwIfCancelled(token);

    try {
      svgContent = await renderDotToSvg(styledDot, config.layoutEngine);
      fs.writeFileSync(path.join(outputDir, 'audit-graph.svg'), svgContent);
      log.appendLine(`[Step 4] SVG rendered (${svgContent.length} chars, engine: ${config.layoutEngine})`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.appendLine(`[Step 4] SVG rendering FAILED: ${msg}`);
      vscode.window.showWarningMessage(`SVG rendering failed: ${msg}`);
    }
  } else {
    log.appendLine(`[Step 4] SKIPPED — no DOT/JSON data available`);
  }

  // Step 5: Circular dependencies
  if (lakosAvailable) {
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
    log.appendLine(`[Step 5] Circular dependencies: ${hasCycles ? 'FOUND' : 'none'}`);
  }

  // Step 6: Dart analyze
  progress.report({ message: 'Running dart analyze...', increment: 10 });
  throwIfCancelled(token);

  const analyzeResult = await spawnAsync('dart', ['analyze', 'lib/'], workspaceRoot, token);
  const analyzeOutput = analyzeResult.stdout + analyzeResult.stderr;
  fs.writeFileSync(path.join(outputDir, 'audit-analyze.txt'), analyzeOutput);
  log.appendLine(`[Step 6] dart analyze exit code: ${analyzeResult.exitCode}`);

  // Step 7: Size limits
  progress.report({ message: 'Checking file size limits...', increment: 5 });
  throwIfCancelled(token);

  const sizeLimitViolations = checkSizeLimits(libDir, config.generatedFilePatterns, config.sizeLimits);
  writeSizeLimits(outputDir, sizeLimitViolations, config.sizeLimits);
  log.appendLine(`[Step 7] Size limit violations: ${sizeLimitViolations.length}`);

  // Step 8: Import check
  progress.report({ message: 'Checking import conventions...', increment: 5 });
  throwIfCancelled(token);

  const importViolations = checkImports(libDir, config.generatedFilePatterns);
  writeImportCheck(outputDir, importViolations);
  log.appendLine(`[Step 8] Import violations: ${importViolations.length}`);

  // Step 9: Summary
  progress.report({ message: 'Writing summary...', increment: 5 });
  if (lakos) {
    writeSummary(outputDir, lakos);
  }

  log.appendLine(`[Done] Audit complete. Output: ${outputDir}`);
  progress.report({ message: 'Audit complete!', increment: 5 });

  return {
    projectName,
    timestamp,
    outputDir,
    lakos,
    classification,
    fileStats,
    sizeLimitViolations,
    importViolations,
    analyzeOutput,
    svgContent,
    styledDot,
  };
}

function checkLakos(cwd: string): boolean {
  try {
    const pubspec = fs.readFileSync(path.join(cwd, 'pubspec.yaml'), 'utf-8');
    return /^\s+lakos:/m.test(pubspec);
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
