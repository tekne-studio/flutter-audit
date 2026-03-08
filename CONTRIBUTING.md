# Contributing to Flutter Audit

Thanks for your interest in contributing! This guide will help you get started.

## Development Setup

```bash
git clone https://github.com/tekne-studio/flutter-audit.git
cd flutter-audit
npm install
npm run watch
```

Press **F5** in VS Code to launch the Extension Development Host with the extension loaded.

### Project Structure

```
src/
├── extension.ts          # Entry point, command registration
├── types.ts              # Shared type definitions
├── audit/
│   ├── runner.ts          # Orchestrates the full audit pipeline
│   ├── layerClassifier.ts # Auto-detects architectural layers (3 strategies)
│   ├── fileStats.ts       # File counting, SLOC analysis
│   ├── dotStyler.ts       # Adds layer colors to DOT graph
│   └── renderer.ts        # Graphviz WASM rendering (DOT → SVG)
├── views/
│   ├── viewerPanel.ts    # WebView panel for the interactive graph
│   ├── viewerHtml.ts     # HTML template for the viewer
│   ├── historyProvider.ts # Sidebar tree view (Project > Timestamp > Files)
│   └── statusBar.ts      # Status bar integration
├── util/
│   ├── dartProject.ts    # Multi-project detection (DartProject, findDartProjects)
│   └── process.ts        # Child process helpers
webview/
├── main.js               # Interactive graph (runs in WebView)
└── style.css             # Dark theme styles
```

### Scripts

| Command | Description |
|---------|-------------|
| `npm run watch` | Build in watch mode with sourcemaps |
| `npm run compile` | Production build (minified) |
| `npm run lint` | Run ESLint |
| `npm run test` | Run tests |
| `npm run package` | Create `.vsix` package |

## How to Contribute

### Reporting Bugs

Open an issue using the **Bug Report** template. Include:
- Steps to reproduce
- Expected vs actual behavior
- Your VS Code version and OS

### Suggesting Features

Open an issue using the **Feature Request** template. Describe the use case and why it would be useful.

### Submitting Code

1. Fork the repository
2. Create a branch from `main`: `git checkout -b feat/my-feature`
3. Make your changes
4. Run `npm run lint` and `npm run compile` to verify
5. Commit using [conventional commits](https://www.conventionalcommits.org/):
   - `feat: add export to PNG` (triggers minor release)
   - `fix: handle empty graph` (triggers patch release)
   - `docs: update configuration section`
   - `refactor: simplify DOT generation`
6. Open a Pull Request against `main`

### Commit Convention

We use **conventional commits** for automatic versioning and changelog generation:

| Prefix | Release | Example |
|--------|---------|---------|
| `feat:` | Minor | `feat: add export to PNG` |
| `fix:` | Patch | `fix: handle empty graph` |
| `refactor:` | Patch | `refactor: simplify DOT gen` |
| `perf:` | Patch | `perf: reduce render time` |
| `docs:` | None | `docs: update README` |
| `chore:` | None | `chore: update deps` |

### Code Style

- TypeScript strict mode
- ESLint enforced (run `npm run lint`)
- Imports use `package:` style where applicable
- Keep files focused: screens < 400 lines, widgets < 300 lines

## Release Process

Releases are fully automated. When a PR is merged to `main`:

1. **semantic-release** analyzes commit messages
2. Bumps the version in `package.json`
3. Generates `CHANGELOG.md`
4. Creates a GitHub Release with `.vsix` attached
5. Publishes to the VS Code Marketplace

No manual versioning or tagging needed.

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
