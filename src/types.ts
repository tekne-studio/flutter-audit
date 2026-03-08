export interface LakosNode {
  id: string;
  label: string;
  cd: number;
  inDegree: number;
  outDegree: number;
  instability: number;
  sloc: number;
}

export interface LakosEdge {
  from: string;
  to: string;
  directive: string;
}

export interface LakosSubgraph {
  id: string;
  label: string;
  nodes: string[];
  subgraphs: LakosSubgraph[];
}

export interface LakosMetrics {
  isAcyclic: boolean;
  firstCycle: string[];
  numNodes: number;
  numEdges: number;
  avgDegree: number;
  ccd: number;
  acd: number;
  nccd: number;
  totalSloc: number;
  avgSloc: number;
  orphans: string[];
}

export interface LakosOutput {
  rootDir: string;
  nodes: Record<string, LakosNode>;
  edges: LakosEdge[];
  subgraphs: LakosSubgraph[];
  metrics: LakosMetrics;
}

export interface FileStats {
  dartFiles: number;
  generatedFiles: number;
  totalSloc: number;
  perDirectory: Map<string, number>;
}

export interface SizeLimitViolation {
  file: string;
  lines: number;
  limit: number;
  category: 'screen' | 'widget' | 'service';
}

export interface ImportViolation {
  file: string;
  line: number;
  importLine: string;
}

export interface AuditResult {
  projectName: string;
  timestamp: string;
  outputDir: string;
  lakos: LakosOutput | null;
  classification: ClassificationResult | null;
  fileStats: FileStats;
  sizeLimitViolations: SizeLimitViolation[];
  importViolations: ImportViolation[];
  analyzeOutput: string;
  svgContent: string | null;
  styledDot: string | null;
}

export interface LayerAssignment {
  layer: string;
  confidence: number;
  source: 'directory' | 'content' | 'graph';
  color: string;
}

export interface ClassificationResult {
  nodes: Record<string, LayerAssignment>;
  clusters: Record<string, LayerAssignment>;
  layers: Record<string, { color: string; nodeCount: number }>;
}

export interface DartFileSignals {
  importsFlutterUI: boolean;
  extendsWidget: boolean;
  extendsStateManager: boolean;
  hasAbstractClasses: boolean;
  implementsDataAccess: boolean;
  importsDataPackages: boolean;
  hasMainFunction: boolean;
}

export interface SizeLimits {
  screens: number;
  widgets: number;
  services: number;
}

export interface ExtensionConfig {
  layoutEngine: string;
  sizeLimits: SizeLimits;
  outputDirectory: string;
  generatedFilePatterns: string[];
}
