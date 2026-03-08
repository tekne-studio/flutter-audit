import * as fs from 'fs';
import * as path from 'path';
import { FileStats, SizeLimitViolation, ImportViolation, SizeLimits } from '../types';

function walkDartFiles(dir: string, generatedPatterns: string[]): { handwritten: string[]; generated: string[] } {
  const handwritten: string[] = [];
  const generated: string[] = [];

  function isGenerated(filePath: string): boolean {
    return generatedPatterns.some(p => {
      const suffix = p.replace('**', '');
      return filePath.endsWith(suffix);
    });
  }

  function walk(current: string) {
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (!['build', '.dart_tool', '.idea', '.vscode', 'android', 'ios', 'web', 'linux', 'macos', 'windows', '.git'].includes(entry.name)) {
          walk(fullPath);
        }
      } else if (entry.name.endsWith('.dart')) {
        if (isGenerated(entry.name)) {
          generated.push(fullPath);
        } else {
          handwritten.push(fullPath);
        }
      }
    }
  }

  walk(dir);
  return { handwritten, generated };
}

function countSloc(filePath: string): number {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    return content.split('\n').filter(line => {
      const trimmed = line.trim();
      return trimmed.length > 0 && !trimmed.startsWith('//');
    }).length;
  } catch {
    return 0;
  }
}

export function collectFileStats(
  libDir: string,
  generatedPatterns: string[],
): FileStats {
  const { handwritten, generated } = walkDartFiles(libDir, generatedPatterns);

  let totalSloc = 0;
  const perDirectory = new Map<string, number>();

  for (const file of handwritten) {
    totalSloc += countSloc(file);
    const dir = path.dirname(file);
    const relDir = path.relative(libDir, dir);
    perDirectory.set(relDir, (perDirectory.get(relDir) ?? 0) + 1);
  }

  return {
    dartFiles: handwritten.length,
    generatedFiles: generated.length,
    totalSloc,
    perDirectory,
  };
}

export function checkSizeLimits(
  libDir: string,
  generatedPatterns: string[],
  limits: SizeLimits,
): SizeLimitViolation[] {
  const { handwritten } = walkDartFiles(libDir, generatedPatterns);
  const violations: SizeLimitViolation[] = [];

  for (const file of handwritten) {
    const lineCount = fs.readFileSync(file, 'utf-8').split('\n').length;
    const name = path.basename(file);
    const relPath = path.relative(libDir, file);

    if (name.endsWith('_screen.dart') && lineCount > limits.screens) {
      violations.push({ file: relPath, lines: lineCount, limit: limits.screens, category: 'screen' });
    } else if (file.includes('/widgets/') && lineCount > limits.widgets) {
      violations.push({ file: relPath, lines: lineCount, limit: limits.widgets, category: 'widget' });
    } else if (
      (name.endsWith('_repository.dart') || name.endsWith('_service.dart')
        || name.endsWith('_use_case.dart') || name.endsWith('_notifier.dart'))
      && lineCount > limits.services
    ) {
      violations.push({ file: relPath, lines: lineCount, limit: limits.services, category: 'service' });
    }
  }

  return violations;
}

export function checkImports(
  libDir: string,
  generatedPatterns: string[],
): ImportViolation[] {
  const { handwritten } = walkDartFiles(libDir, generatedPatterns);
  const violations: ImportViolation[] = [];

  for (const file of handwritten) {
    const content = fs.readFileSync(file, 'utf-8');
    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      if (lines[i].match(/^import\s+['"]\.\./)) {
        violations.push({
          file: path.relative(libDir, file),
          line: i + 1,
          importLine: lines[i].trim(),
        });
      }
    }
  }

  return violations;
}
