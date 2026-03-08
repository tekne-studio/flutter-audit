import * as vscode from 'vscode';

export function getViewerHtml(
  webview: vscode.Webview,
  extensionUri: vscode.Uri,
  nonce: string,
): string {
  const styleUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, 'webview', 'style.css'),
  );
  const scriptUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, 'webview', 'main.js'),
  );

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}'; img-src ${webview.cspSource} data:;">
<link rel="stylesheet" href="${styleUri}">
<title>Flutter Audit</title>
</head>
<body>

<div id="container">
  <div id="loading">
    <div class="loading-text">Waiting for audit data...</div>
  </div>
</div>

<div id="tooltip"></div>

<div id="panel">
  <button class="p-close" id="panel-close">&times;</button>
  <div id="panel-content"></div>
</div>

<div id="controls">
  <button id="btn-zoom-in" title="Zoom in">+</button>
  <button id="btn-zoom-out" title="Zoom out">&minus;</button>
  <button id="btn-zoom-fit" title="Fit to screen">&#x2922;</button>
  <button id="btn-clear" title="Clear selection">&#x25CB;</button>
</div>

<div id="legend">
  <h4>Layers</h4>
  <div class="legend-item"><div class="legend-swatch" style="background:#00D9FF"></div> domain / app</div>
  <div class="legend-item"><div class="legend-swatch" style="background:#FF8800"></div> presentation</div>
  <div class="legend-item"><div class="legend-swatch" style="background:#CC00FF"></div> application</div>
  <div class="legend-item"><div class="legend-swatch" style="background:#00FF88"></div> infrastructure</div>
  <div class="legend-item"><div class="legend-swatch" style="background:#888888"></div> core</div>
</div>

<div id="info"></div>

<div id="search-box">
  <input type="text" placeholder="Search nodes..." id="search-input">
</div>

<script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
}

export function generateNonce(): string {
  const array = new Uint8Array(16);
  for (let i = 0; i < array.length; i++) {
    array[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(array, b => b.toString(16).padStart(2, '0')).join('');
}
