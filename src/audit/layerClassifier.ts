import * as fs from 'fs';
import * as path from 'path';
import { LakosOutput, LakosSubgraph, LakosNode, ClassificationResult, LayerAssignment, DartFileSignals } from '../types';

const AUTO_PALETTE = [
  '#FF8800', '#00D9FF', '#CC00FF', '#00FF88',
  '#FF4466', '#FFDD00', '#4488FF', '#FF66CC',
  '#88FF44', '#FF6644', '#44DDAA', '#AA88FF',
];

const ENTRY_COLOR = '#CC00FF';

// ============================================
// MAIN ENTRY POINT
// ============================================

export async function classifyProject(
  lakos: LakosOutput,
  libPath: string,
  generatedPatterns: string[],
): Promise<ClassificationResult> {
  const nodeIds = Object.keys(lakos.nodes);

  // Strategy 1: Directory structure
  const dirAssignments = classifyByDirectory(nodeIds, lakos.subgraphs);

  // Strategy 2: File content analysis
  const contentAssignments = classifyByContent(nodeIds, libPath, generatedPatterns);

  // Strategy 3: Graph inference
  const graphAssignments = classifyByGraph(lakos.nodes);

  // Combine strategies
  const nodes = combineStrategies(nodeIds, dirAssignments, contentAssignments, graphAssignments);

  // Build layer summary and assign colors
  const layers = buildLayerSummary(nodes);

  // Classify clusters from subgraphs
  const clusters = classifyClusters(lakos.subgraphs, layers);

  return { nodes, clusters, layers };
}

// ============================================
// STRATEGY 1: DIRECTORY STRUCTURE
// ============================================

function classifyByDirectory(
  nodeIds: string[],
  _subgraphs: LakosSubgraph[],
): Map<string, LayerAssignment> {
  const assignments = new Map<string, LayerAssignment>();

  // Count files per directory segment to find qualifying layers
  const dirCounts = new Map<string, number>();
  for (const id of nodeIds) {
    const segments = id.split('/').filter(Boolean);
    // Skip the filename, look at directory segments
    for (let i = 0; i < segments.length - 1; i++) {
      const dir = segments[i];
      dirCounts.set(dir, (dirCounts.get(dir) ?? 0) + 1);
    }
  }

  // Assign each node to its deepest qualifying directory
  for (const id of nodeIds) {
    if (id === '/main.dart') {
      assignments.set(id, { layer: 'entry', confidence: 1.0, source: 'directory', color: '' });
      continue;
    }

    const segments = id.split('/').filter(Boolean);
    // Walk from deepest to shallowest directory to find the best layer
    let bestLayer = '';
    for (let i = segments.length - 2; i >= 0; i--) {
      const dir = segments[i];
      const count = dirCounts.get(dir) ?? 0;
      if (count >= 2) {
        bestLayer = dir;
        break;
      }
    }

    if (bestLayer) {
      assignments.set(id, { layer: bestLayer, confidence: 0.7, source: 'directory', color: '' });
    }
  }

  return assignments;
}

// ============================================
// STRATEGY 2: FILE CONTENT ANALYSIS
// ============================================

function extractSignals(filePath: string): DartFileSignals {
  const signals: DartFileSignals = {
    importsFlutterUI: false,
    extendsWidget: false,
    extendsStateManager: false,
    hasAbstractClasses: false,
    implementsDataAccess: false,
    importsDataPackages: false,
    hasMainFunction: false,
  };

  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n').slice(0, 50);
    const text = lines.join('\n');

    signals.importsFlutterUI = /import\s+['"]package:flutter\/(material|widgets|cupertino)\.dart['"]/.test(text);
    signals.extendsWidget = /extends\s+(StatelessWidget|StatefulWidget|State<|HookWidget|ConsumerWidget)/.test(text);
    signals.extendsStateManager = /extends\s+(ChangeNotifier|StateNotifier|Cubit|Bloc|Notifier|AsyncNotifier)/.test(text);
    signals.hasAbstractClasses = /abstract\s+(class|interface)/.test(text);
    signals.implementsDataAccess = /implements\s+\w*(Repository|DataSource|Dao|Gateway)/.test(text);
    signals.importsDataPackages = /import\s+['"]package:(http|dio|sqflite|hive|shared_preferences|cloud_firestore|firebase_database|drift|isar|realm|graphql)\//.test(text);
    signals.hasMainFunction = /void\s+main\s*\(/.test(text);
  } catch {
    // file read error — return empty signals
  }

  return signals;
}

function inferRoleFromSignals(signals: DartFileSignals): { role: string; confidence: number } | null {
  if (signals.hasMainFunction) {
    return { role: 'entry', confidence: 0.6 };
  }
  if (signals.extendsWidget || (signals.importsFlutterUI && !signals.extendsStateManager)) {
    return { role: 'ui', confidence: 0.6 };
  }
  if (signals.extendsStateManager) {
    return { role: 'state', confidence: 0.5 };
  }
  if (signals.implementsDataAccess || signals.importsDataPackages) {
    return { role: 'data', confidence: 0.5 };
  }
  if (signals.hasAbstractClasses && !signals.importsFlutterUI) {
    return { role: 'contract', confidence: 0.4 };
  }
  return null;
}

function classifyByContent(
  nodeIds: string[],
  libPath: string,
  generatedPatterns: string[],
): Map<string, LayerAssignment> {
  const assignments = new Map<string, LayerAssignment>();

  function isGenerated(filePath: string): boolean {
    return generatedPatterns.some(p => {
      const suffix = p.replace('**', '');
      return filePath.endsWith(suffix);
    });
  }

  for (const id of nodeIds) {
    const filePath = path.join(libPath, id);
    if (isGenerated(filePath)) continue;

    const signals = extractSignals(filePath);
    const result = inferRoleFromSignals(signals);
    if (result) {
      assignments.set(id, {
        layer: result.role,
        confidence: result.confidence,
        source: 'content',
        color: '',
      });
    }
  }

  return assignments;
}

// ============================================
// STRATEGY 3: GRAPH INFERENCE
// ============================================

function classifyByGraph(nodes: Record<string, LakosNode>): Map<string, LayerAssignment> {
  const assignments = new Map<string, LayerAssignment>();
  const nodeList = Object.values(nodes);
  if (nodeList.length === 0) return assignments;

  // Calculate median in-degree and out-degree
  const inDegrees = nodeList.map(n => n.inDegree).sort((a, b) => a - b);
  const outDegrees = nodeList.map(n => n.outDegree).sort((a, b) => a - b);
  const medianIn = inDegrees[Math.floor(inDegrees.length / 2)];
  const medianOut = outDegrees[Math.floor(outDegrees.length / 2)];

  for (const node of nodeList) {
    const instability = node.instability;
    let role: string | null = null;

    if (instability < 0.2 && node.inDegree > medianIn) {
      role = 'stable';
    } else if (instability > 0.8 && node.outDegree > medianOut) {
      role = 'volatile';
    } else if (instability >= 0.3 && instability <= 0.7) {
      role = 'mediator';
    }

    if (role) {
      assignments.set(node.id, {
        layer: role,
        confidence: 0.3,
        source: 'graph',
        color: '',
      });
    }
  }

  return assignments;
}

// ============================================
// COMBINER
// ============================================

function combineStrategies(
  nodeIds: string[],
  dirAssignments: Map<string, LayerAssignment>,
  contentAssignments: Map<string, LayerAssignment>,
  graphAssignments: Map<string, LayerAssignment>,
): Record<string, LayerAssignment> {
  const result: Record<string, LayerAssignment> = {};

  for (const id of nodeIds) {
    const dir = dirAssignments.get(id);
    const content = contentAssignments.get(id);
    const graph = graphAssignments.get(id);

    // Collect all candidates
    const candidates: LayerAssignment[] = [];
    if (dir) candidates.push(dir);
    if (content) candidates.push(content);
    if (graph) candidates.push(graph);

    if (candidates.length === 0) {
      result[id] = { layer: 'other', confidence: 0, source: 'directory', color: '' };
      continue;
    }

    // Pick highest confidence
    candidates.sort((a, b) => b.confidence - a.confidence);
    const best = { ...candidates[0] };

    // Boost confidence when directory and content agree on semantic alignment
    if (dir && content) {
      best.confidence = Math.min(1.0, best.confidence + 0.1);
    }

    result[id] = best;
  }

  return result;
}

// ============================================
// COLOR ASSIGNMENT
// ============================================

function assignColor(index: number): string {
  if (index < AUTO_PALETTE.length) {
    return AUTO_PALETTE[index];
  }
  // Golden angle HSL rotation for overflow
  const hue = (index * 137.5) % 360;
  return hslToHex(hue, 70, 60);
}

function hslToHex(h: number, s: number, l: number): string {
  s /= 100;
  l /= 100;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round(255 * color).toString(16).padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

function buildLayerSummary(
  nodes: Record<string, LayerAssignment>,
): Record<string, { color: string; nodeCount: number }> {
  // Count nodes per layer
  const counts = new Map<string, number>();
  for (const assignment of Object.values(nodes)) {
    counts.set(assignment.layer, (counts.get(assignment.layer) ?? 0) + 1);
  }

  // Sort by node count descending (most populated first gets best color)
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);

  const layers: Record<string, { color: string; nodeCount: number }> = {};
  let colorIndex = 0;

  for (const [layer, count] of sorted) {
    const color = layer === 'entry' ? ENTRY_COLOR : assignColor(colorIndex++);
    layers[layer] = { color, nodeCount: count };
  }

  // Apply colors back to node assignments
  for (const assignment of Object.values(nodes)) {
    assignment.color = layers[assignment.layer]?.color ?? '#666666';
  }

  return layers;
}

// ============================================
// CLUSTER CLASSIFICATION
// ============================================

function classifyClusters(
  subgraphs: LakosSubgraph[],
  layers: Record<string, { color: string; nodeCount: number }>,
): Record<string, LayerAssignment> {
  const clusters: Record<string, LayerAssignment> = {};

  function walkSubgraphs(subs: LakosSubgraph[]) {
    for (const sg of subs) {
      // Extract the last directory segment from the cluster label
      const label = sg.label || sg.id;
      const dirName = label.split('/').filter(Boolean).pop() ?? label;

      const layerInfo = layers[dirName];
      clusters[sg.id] = {
        layer: dirName,
        confidence: layerInfo ? 0.7 : 0.3,
        source: 'directory',
        color: layerInfo?.color ?? '#333333',
      };

      if (sg.subgraphs.length > 0) {
        walkSubgraphs(sg.subgraphs);
      }
    }
  }

  walkSubgraphs(subgraphs);
  return clusters;
}
