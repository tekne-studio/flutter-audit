import { LayerColors, LayerPatterns } from '../types';

const DEFAULT_NODE_FILL = '#1A1A1A';
const DEFAULT_NODE_TEXT = '#E0E0E0';
const DEFAULT_EDGE_COLOR = '#404040';
const DEFAULT_CLUSTER_BG = '#0D0D0D';
const DEFAULT_FONT = 'JetBrains Mono';

export interface DotStylerOptions {
  colors: LayerColors;
  patterns: LayerPatterns;
  projectName: string;
  font?: string;
}

export function classifyNode(nodeId: string, patterns: LayerPatterns): string {
  if (nodeId === '/main.dart') {
    return 'entry';
  }
  for (const [layer, pattern] of Object.entries(patterns)) {
    if (nodeId.includes(pattern)) {
      return layer;
    }
  }
  return 'core';
}

function isGenerated(nodeId: string): boolean {
  return nodeId.includes('.freezed.dart')
    || nodeId.includes('.g.dart')
    || nodeId.includes('.gr.dart');
}

function classifyCluster(clusterId: string, colors: LayerColors): string {
  if (clusterId.includes('presentation')) { return colors.presentation; }
  if (clusterId.includes('application')) { return colors.application; }
  if (clusterId.includes('infrastructure')) { return colors.infrastructure; }
  if (clusterId.includes('domain')) { return colors.domain; }
  if (clusterId.includes('core')) { return colors.core; }
  if (clusterId.includes('app')) { return colors.app; }
  if (clusterId.includes('features')) { return '#444444'; }
  return '#333333';
}

export function styleDot(inputText: string, options: DotStylerOptions): string {
  const { colors, patterns, projectName } = options;
  const font = options.font ?? DEFAULT_FONT;
  const lines = inputText.trim().split('\n');
  const output: string[] = [];

  // Collect generated node IDs to filter edges
  const generatedNodes = new Set<string>();
  for (const line of lines) {
    const m = line.match(/^\s*(".*?")\s*\[/);
    if (m && isGenerated(m[1])) {
      generatedNodes.add(m[1]);
    }
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const stripped = line.trim();

    // Replace opening graph line
    if (stripped.startsWith('digraph')) {
      output.push(`digraph "${projectName}" {`);
      output.push(`  bgcolor="#0A0A0A";`);
      output.push(`  graph [`);
      output.push(`    style="rounded"`);
      output.push(`    fontname="${font}"`);
      output.push(`    fontsize=12`);
      output.push(`    fontcolor="${DEFAULT_NODE_TEXT}"`);
      output.push(`    penwidth=2.0`);
      output.push(`    color="#333333"`);
      output.push(`    splines=spline`);
      output.push(`    overlap=prism`);
      output.push(`    sep="+20"`);
      output.push(`    K=1.2`);
      output.push(`    pad=0.5`);
      output.push(`    margin=0`);
      output.push(`  ];`);
      output.push(`  node [`);
      output.push(`    shape=rect`);
      output.push(`    style="filled,rounded"`);
      output.push(`    fontname="${font}"`);
      output.push(`    fontsize=10`);
      output.push(`    fontcolor="${DEFAULT_NODE_TEXT}"`);
      output.push(`    fillcolor="${DEFAULT_NODE_FILL}"`);
      output.push(`    penwidth=2.0`);
      output.push(`    margin="0.45,0.15"`);
      output.push(`  ];`);
      output.push(`  edge [`);
      output.push(`    color="${DEFAULT_EDGE_COLOR}"`);
      output.push(`    penwidth=1.2`);
      output.push(`    arrowsize=0.6`);
      output.push(`  ];`);
      continue;
    }

    // Skip lakos default graph/node/edge lines
    if (stripped.startsWith('graph [') && i <= 3) { continue; }
    if (stripped.startsWith('node [') && i <= 4) { continue; }
    if (stripped.startsWith('edge [') && i <= 5) { continue; }

    // Skip generated node definitions
    const nodeMatch = stripped.match(/^\s*(".*?")\s*\[/);
    if (nodeMatch && generatedNodes.has(nodeMatch[1])) { continue; }

    // Skip metrics node
    if (stripped.startsWith('"metrics"')) { continue; }

    // Skip edges involving generated nodes
    const edgeMatch = stripped.match(/^\s*(".*?")\s*->\s*(".*?")/);
    if (edgeMatch) {
      const src = edgeMatch[1];
      const dst = edgeMatch[2];
      if (generatedNodes.has(src) || generatedNodes.has(dst)) { continue; }

      const cat = classifyNode(src.replace(/"/g, ''), patterns);
      const edgeColor = colors[cat] ?? DEFAULT_EDGE_COLOR;
      output.push(`  ${src} -> ${dst} [color="${edgeColor}40"];`);
      continue;
    }

    // Style node definitions
    if (nodeMatch && !generatedNodes.has(nodeMatch[1])) {
      const nodeId = nodeMatch[1];
      const nodePath = nodeId.replace(/"/g, '');
      const cat = classifyNode(nodePath, patterns);
      const borderColor = colors[cat] ?? '#666666';

      const labelMatch = stripped.match(/label="([^"]*)"/);
      const label = labelMatch?.[1] ?? nodePath.split('/').pop() ?? nodePath;

      output.push(`  ${nodeId} [label="${label}" color="${borderColor}"];`);
      continue;
    }

    // Style subgraph/cluster definitions
    if (stripped.startsWith('subgraph')) {
      const clusterMatch = stripped.match(/subgraph\s+"([^"]*)"/);
      if (clusterMatch) {
        const clusterId = clusterMatch[1];
        output.push(`  subgraph "${clusterId}" {`);
        continue;
      }
      output.push(line);
      continue;
    }

    // Style cluster labels
    const labelMatch = stripped.match(/^\s*label="([^"]*)"/);
    if (labelMatch) {
      const labelText = labelMatch[1];
      // Find parent cluster to determine color
      let parentCluster = '';
      for (let j = output.length - 1; j >= 0; j--) {
        const cm = output[j].match(/subgraph\s+"([^"]*)"/);
        if (cm) {
          parentCluster = cm[1];
          break;
        }
      }
      const borderColor = classifyCluster(parentCluster, colors);
      output.push(`    label="${labelText}\\n"`);
      output.push(`    fontname="${font}"`);
      output.push(`    fontsize=13`);
      output.push(`    fontcolor="${DEFAULT_NODE_TEXT}"`);
      output.push(`    style="rounded,dashed"`);
      output.push(`    color="${borderColor}"`);
      output.push(`    bgcolor="${DEFAULT_CLUSTER_BG}"`);
      output.push(`    penwidth=2.0`);
      output.push(`    margin=20`);
      continue;
    }

    // Skip generated file references inside subgraphs
    const bareRef = stripped.match(/^\s*(".*?")\s*;/);
    if (bareRef && generatedNodes.has(bareRef[1])) { continue; }

    // Everything else passes through
    output.push(line);
  }

  return output.join('\n') + '\n';
}
