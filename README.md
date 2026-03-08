# Flutter Audit

Interactive dependency graph visualization and architecture audit for Flutter/Dart projects.

**Flutter Audit** analyzes your project's internal file dependencies, renders an interactive graph with architectural layer coloring, and runs a comprehensive code quality audit — all inside VS Code.

## Features

- **Interactive Dependency Graph** — Force-directed graph with zoom, pan, search, and click-to-inspect. Nodes are colored by architectural layer (presentation, application, domain, infrastructure, core).
- **Click to Navigate** — Click any node in the graph to open the corresponding file in the editor.
- **Coupling Metrics** — NCCD, CCD, ACD, in-degree, out-degree, instability per file. Powered by [lakos](https://pub.dev/packages/lakos).
- **Circular Dependency Detection** — Identifies import cycles that violate clean architecture.
- **File Size Limits** — Configurable line count limits for screens, widgets, services, and notifiers.
- **Import Convention Check** — Detects relative imports that should use `package:` style.
- **Dart Analyze Integration** — Runs `dart analyze` and saves results.
- **Audit History** — Each audit is timestamped and browsable from the sidebar.
- **No System Dependencies** — Graphviz rendering runs via WebAssembly ([@hpcc-js/wasm-graphviz](https://github.com/nicolo-ribaudo/nicolo-ribaudo-hpcc-wasm-graphviz)). No `brew install` needed.

## Requirements

- **VS Code** 1.85+
- **Dart SDK** (comes with Flutter)
- **lakos** as a dev_dependency in your project:

```yaml
# pubspec.yaml
dev_dependencies:
  lakos: ^2.0.6
```

Optional (for richer audit):
```yaml
dev_dependencies:
  dependency_validator: ^5.0.4
```

## Quick Start

1. Install the extension from the VS Code Marketplace
2. Open a Flutter/Dart project
3. Press `Cmd+Shift+A` (macOS) or `Ctrl+Shift+A` (Windows/Linux)
4. The audit runs and opens the interactive graph viewer

## Commands

| Command | Shortcut | Description |
|---|---|---|
| `Flutter Audit: Run Audit` | `Cmd+Shift+A` | Run full audit and open viewer |
| `Flutter Audit: Open Viewer` | — | Re-open last audit result |
| `Flutter Audit: Show History` | — | Focus the audit history sidebar |

## Graph Viewer

The graph viewer is a dark-themed interactive visualization:

- **Scroll** to zoom in/out
- **Drag** to pan
- **Click a node** to highlight its dependencies and show metrics in the side panel
- **`/`** to focus the search bar
- **`Esc`** to clear selection
- **"Open in Editor"** button in the side panel navigates to the file

### Layer Colors

| Layer | Color | Pattern |
|---|---|---|
| presentation | Orange `#FF8800` | `/presentation/` |
| application | Purple `#CC00FF` | `/application/` |
| domain | Cyan `#00D9FF` | `/domain/` |
| infrastructure | Green `#00FF88` | `/infrastructure/` |
| core | Grey `#888888` | `/core/` |

## Configuration

All settings are under `flutterAudit.*` in VS Code settings:

| Setting | Default | Description |
|---|---|---|
| `layerColors` | *(see above)* | Colors per architectural layer |
| `layerPatterns` | *(see above)* | Directory patterns for layer classification |
| `layoutEngine` | `fdp` | Graphviz layout engine (`fdp`, `dot`, `neato`, `circo`) |
| `sizeLimits` | `{screens: 400, widgets: 300, services: 350}` | Max lines per file type |
| `outputDirectory` | `audit` | Where to save audit artifacts |
| `generatedFilePatterns` | `[**.freezed.dart, **.g.dart, **.gr.dart]` | Generated files to exclude |

## Audit Output

Each run creates a timestamped directory:

```
audit/2026-03-08-14-33/
├── audit-graph.svg          # Rendered dependency graph
├── audit-graph-styled.dot   # Styled DOT source
├── audit-graph.dot          # Raw lakos DOT output
├── audit-deps.json          # Full metrics (nodes, edges, coupling)
├── audit-summary.txt        # Top coupled files, NCCD
├── audit-stats.txt          # File counts, SLOC per directory
├── audit-circular.txt       # Circular dependency report
├── audit-analyze.txt        # dart analyze results
├── audit-limits.txt         # Size limit violations
└── audit-imports.txt        # Relative import violations
```

## Architecture Support

Flutter Audit works best with **clean architecture** / **feature-based** Flutter projects:

```
lib/
├── app/             # Routing, theme, DI
├── core/            # Shared utilities, error handling
├── features/
│   ├── auth/
│   │   ├── application/      # Use cases
│   │   ├── domain/           # Models, ports
│   │   ├── infrastructure/   # Adapters, API clients
│   │   └── presentation/     # Screens, widgets, notifiers
│   └── ...
└── main.dart
```

The layer patterns are fully configurable — adapt them to your project structure.

## Contributing

Contributions are welcome! See [CONTRIBUTING.md](CONTRIBUTING.md) for setup instructions, project structure, and guidelines.

## License

MIT — [Tekne Studio](https://github.com/tekne-studio)
