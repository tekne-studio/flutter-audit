// @ts-check
// Flutter Audit — Interactive Viewer (WebView)
// Communicates with extension host via postMessage.

/** @type {ReturnType<typeof acquireVsCodeApi>} */
const vscode = acquireVsCodeApi();

// ============================================
// CLASSIFICATION (received from extension)
// ============================================
/** @type {any} */
let classification = null;

function classify(id) {
  if (!classification || !classification.nodes[id]) return 'other';
  return classification.nodes[id].layer;
}

function nodeColor(id) {
  if (!classification || !classification.nodes[id]) return '#666';
  return classification.nodes[id].color;
}

// ============================================
// STATE
// ============================================
let viewBox = { x: 0, y: 0, w: 0, h: 0 };
let originalViewBox = null;
let isPanning = false;
let startPoint = { x: 0, y: 0 };
let selectedId = null;

/** @type {Record<string, any>} */
let nodeMetrics = {};
/** @type {Record<string, Element>} */
const nodeById = {};
/** @type {Array<{from: string, to: string, el: Element}>} */
const edgeList = [];
/** @type {Record<string, Array<{from: string, el: Element}>>} */
const incomingMap = {};
/** @type {Record<string, Array<{to: string, el: Element}>>} */
const outgoingMap = {};

/** @type {NodeListOf<Element>} */
let nodeGroups;
/** @type {NodeListOf<Element>} */
let edgeGroups;
/** @type {NodeListOf<Element>} */
let clusterGroups;
/** @type {SVGSVGElement | null} */
let svg = null;

// ============================================
// LISTEN FOR DATA FROM EXTENSION
// ============================================
window.addEventListener('message', (event) => {
  const message = event.data;
  if (message.command === 'loadAudit') {
    classification = message.classification || null;
    loadAudit(message.svg, message.metrics, message.projectName);
  }
});

function loadAudit(svgContent, metricsData, projectName) {
  const container = document.getElementById('container');
  if (!container) return;

  // Insert SVG
  container.innerHTML = svgContent;
  svg = container.querySelector('svg');
  if (!svg) return;

  // Parse metrics
  if (metricsData && metricsData.nodes) {
    Object.entries(metricsData.nodes).forEach(([id, data]) => {
      if (!id.includes('.freezed.') && !id.includes('.g.dart')) {
        nodeMetrics[id] = data;
      }
    });
  }

  // Query SVG elements
  nodeGroups = svg.querySelectorAll('g.node');
  edgeGroups = svg.querySelectorAll('g.edge');
  clusterGroups = svg.querySelectorAll('g.cluster');

  // Build maps
  nodeGroups.forEach((g) => {
    const title = g.querySelector('title');
    if (title) {
      const id = title.textContent.trim();
      nodeById[id] = g;
      if (!incomingMap[id]) incomingMap[id] = [];
      if (!outgoingMap[id]) outgoingMap[id] = [];
    }
  });

  // Parse edges
  edgeGroups.forEach((g) => {
    const title = g.querySelector('title');
    if (!title) return;
    const text = title.textContent.trim();
    const parts = text.split('->');
    if (parts.length !== 2) return;
    const from = parts[0].trim();
    const to = parts[1].trim();
    const edge = { from, to, el: g };
    edgeList.push(edge);
    if (incomingMap[to]) incomingMap[to].push(edge);
    if (outgoingMap[from]) outgoingMap[from].push(edge);
  });

  // Store original edge colors
  edgeGroups.forEach((g) => {
    const pathEl = g.querySelector('path');
    const polygon = g.querySelector('polygon');
    if (pathEl) pathEl.dataset.origStroke = pathEl.getAttribute('stroke') || '';
    if (polygon) polygon.dataset.origStroke = polygon.getAttribute('stroke') || '';
  });

  // Info bar
  const globalMetrics = metricsData?.metrics || metricsData?.globalMetrics || {};
  const infoEl = document.getElementById('info');
  if (infoEl) {
    infoEl.innerHTML =
      `${Object.keys(nodeById).length} files \u00b7 ${edgeList.length} imports \u00b7 ` +
      `NCCD: ${(globalMetrics.nccd || 0).toFixed(2)} \u00b7 ` +
      `Click node to inspect \u00b7 Scroll to zoom`;
  }

  // Update legend dynamically
  updateLegend();

  // Init viewBox
  initViewBox();

  // Bind node events
  nodeGroups.forEach((g) => {
    const title = g.querySelector('title');
    if (!title) return;
    const id = title.textContent.trim();

    g.style.cursor = 'pointer';

    g.addEventListener('click', (e) => {
      e.stopPropagation();
      selectNode(id);
    });

    g.addEventListener('mouseenter', (e) => showTooltip(e, id));
    g.addEventListener('mousemove', (e) => moveTooltip(e));
    g.addEventListener('mouseleave', () => hideTooltip());
  });

  // Click background to deselect
  svg.addEventListener('click', (e) => {
    if (!e.target.closest('g.node')) {
      resetHighlight();
      closePanel();
    }
  });

  // Pan events
  svg.addEventListener('pointerdown', (e) => {
    if (e.target.closest('g.node')) return;
    isPanning = true;
    startPoint = { x: e.clientX, y: e.clientY };
    svg.setPointerCapture(e.pointerId);
  });
  svg.addEventListener('pointermove', (e) => {
    if (!isPanning || !svg) return;
    const rect = svg.getBoundingClientRect();
    const dx = (e.clientX - startPoint.x) / rect.width * viewBox.w;
    const dy = (e.clientY - startPoint.y) / rect.height * viewBox.h;
    viewBox.x -= dx;
    viewBox.y -= dy;
    startPoint = { x: e.clientX, y: e.clientY };
    updateViewBox();
  });
  svg.addEventListener('pointerup', () => { isPanning = false; });

  // Wheel zoom
  container.addEventListener('wheel', (e) => {
    e.preventDefault();
    if (!svg) return;
    const factor = e.deltaY > 0 ? 1.15 : 0.87;
    const rect = svg.getBoundingClientRect();
    const mx = (e.clientX - rect.left) / rect.width;
    const my = (e.clientY - rect.top) / rect.height;
    const px = viewBox.x + mx * viewBox.w;
    const py = viewBox.y + my * viewBox.h;
    viewBox.w *= factor;
    viewBox.h *= factor;
    viewBox.x = px - mx * viewBox.w;
    viewBox.y = py - my * viewBox.h;
    updateViewBox();
  }, { passive: false });

  // Initial fit
  setTimeout(zoomFit, 100);
}

// ============================================
// LEGEND
// ============================================
function updateLegend() {
  const legendItems = document.getElementById('legend-items');
  if (!legendItems || !classification) return;

  const sortedLayers = Object.entries(classification.layers)
    .sort((a, b) => b[1].nodeCount - a[1].nodeCount);

  let html = '';
  for (const [name, info] of sortedLayers) {
    html += `<div class="legend-item"><div class="legend-swatch" style="background:${info.color}"></div> ${name}</div>`;
  }
  legendItems.innerHTML = html;
}

// ============================================
// ZOOM & PAN
// ============================================
function initViewBox() {
  if (!svg) return;
  const vb = svg.getAttribute('viewBox');
  if (vb) {
    const [x, y, w, h] = vb.split(/[\s,]+/).map(Number);
    viewBox = { x, y, w, h };
  } else {
    const w = parseFloat(svg.getAttribute('width') || '') || window.innerWidth;
    const h = parseFloat(svg.getAttribute('height') || '') || window.innerHeight;
    viewBox = { x: 0, y: 0, w, h };
    svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  }
  originalViewBox = { ...viewBox };
  svg.removeAttribute('width');
  svg.removeAttribute('height');
  svg.style.width = '100%';
  svg.style.height = '100%';
}

function updateViewBox() {
  if (svg) {
    svg.setAttribute('viewBox', `${viewBox.x} ${viewBox.y} ${viewBox.w} ${viewBox.h}`);
  }
}

function zoomBy(factor) {
  const cx = viewBox.x + viewBox.w / 2;
  const cy = viewBox.y + viewBox.h / 2;
  viewBox.w /= factor;
  viewBox.h /= factor;
  viewBox.x = cx - viewBox.w / 2;
  viewBox.y = cy - viewBox.h / 2;
  updateViewBox();
}

function zoomFit() {
  if (originalViewBox) {
    viewBox = { ...originalViewBox };
    updateViewBox();
  }
}

// ============================================
// CLICK & HIGHLIGHT
// ============================================
function selectNode(id) {
  selectedId = id;
  const incoming = incomingMap[id] || [];
  const outgoing = outgoingMap[id] || [];
  const connectedIds = new Set([
    id,
    ...incoming.map((e) => e.from),
    ...outgoing.map((e) => e.to),
  ]);

  nodeGroups.forEach((g) => {
    const nid = g.querySelector('title')?.textContent.trim();
    g.style.opacity = connectedIds.has(nid) ? '1' : '0.12';
  });

  clusterGroups.forEach((g) => { g.style.opacity = '0.3'; });

  edgeGroups.forEach((g) => {
    const title = g.querySelector('title')?.textContent.trim() || '';
    const parts = title.split('->');
    if (parts.length !== 2) return;
    const from = parts[0].trim();
    const to = parts[1].trim();
    const isConnected = from === id || to === id;
    g.style.opacity = isConnected ? '1' : '0.05';

    const pathEl = g.querySelector('path');
    const polygon = g.querySelector('polygon');
    if (isConnected) {
      const color = from === id ? nodeColor(id) : nodeColor(from);
      if (pathEl) { pathEl.setAttribute('stroke', color); pathEl.setAttribute('stroke-width', '3'); }
      if (polygon) { polygon.setAttribute('stroke', color); polygon.setAttribute('fill', color); }
    }
  });

  showPanel(id, incoming, outgoing);
}

function resetHighlight() {
  selectedId = null;
  if (!nodeGroups) return;

  nodeGroups.forEach((g) => { g.style.opacity = '1'; });
  clusterGroups.forEach((g) => { g.style.opacity = '1'; });
  edgeGroups.forEach((g) => {
    g.style.opacity = '1';
    const pathEl = g.querySelector('path');
    const polygon = g.querySelector('polygon');
    if (pathEl) {
      pathEl.setAttribute('stroke', pathEl.dataset.origStroke || '');
      pathEl.setAttribute('stroke-width', '1.2');
    }
    if (polygon) {
      polygon.setAttribute('stroke', polygon.dataset.origStroke || '');
      polygon.setAttribute('fill', polygon.dataset.origStroke || '');
    }
  });
}

// ============================================
// TOOLTIP
// ============================================
function showTooltip(event, id) {
  const m = nodeMetrics[id] || {};
  const color = nodeColor(id);
  const tt = document.getElementById('tooltip');
  if (!tt) return;
  tt.innerHTML = `
    <div class="tt-label" style="color:${color}">${m.label || id.split('/').pop()}</div>
    <div class="tt-path">${id}</div>
    <div class="tt-row"><span class="tt-key">SLOC</span><span class="tt-val">${m.sloc || '?'}</span></div>
    <div class="tt-row"><span class="tt-key">Layer</span><span class="tt-val" style="color:${color}">${classify(id)}</span></div>
    <div class="tt-row"><span class="tt-key">Imports</span><span class="tt-val">${m.outDegree || 0}</span></div>
    <div class="tt-row"><span class="tt-key">Imported by</span><span class="tt-val">${m.inDegree || 0}</span></div>
    <div class="tt-row"><span class="tt-key">Instability</span><span class="tt-val">${(m.instability || 0).toFixed(2)}</span></div>
  `;
  tt.style.display = 'block';
  moveTooltip(event);
}

function moveTooltip(event) {
  const tt = document.getElementById('tooltip');
  if (!tt) return;
  let x = event.clientX + 16;
  let y = event.clientY - 10;
  if (x + 300 > window.innerWidth) x = event.clientX - 316;
  if (y + 180 > window.innerHeight) y = event.clientY - 190;
  tt.style.left = x + 'px';
  tt.style.top = y + 'px';
}

function hideTooltip() {
  const tt = document.getElementById('tooltip');
  if (tt) tt.style.display = 'none';
}

// ============================================
// PANEL
// ============================================
function showPanel(id, incoming, outgoing) {
  const m = nodeMetrics[id] || {};
  const color = nodeColor(id);
  const cat = classify(id);
  const featureMatch = id.match(/^\/features\/([^/]+)\//);
  const feature = featureMatch?.[1] || (id.startsWith('/core/') ? 'core' : id.startsWith('/app/') ? 'app' : 'root');

  let html = `
    <h2 style="color:${color}">${m.label || id.split('/').pop()}</h2>
    <div class="p-path">${id}</div>
    <div class="p-section">
      <h3>Metrics</h3>
      <div class="p-metric"><span>SLOC</span><span>${m.sloc || '?'}</span></div>
      <div class="p-metric"><span>Layer</span><span style="color:${color}">${cat}</span></div>
      <div class="p-metric"><span>Feature</span><span>${feature}</span></div>
      <div class="p-metric"><span>In-degree</span><span>${m.inDegree || 0}</span></div>
      <div class="p-metric"><span>Out-degree</span><span>${m.outDegree || 0}</span></div>
      <div class="p-metric"><span>Instability</span><span>${(m.instability || 0).toFixed(2)}</span></div>
      <div class="p-metric"><span>Component Dep.</span><span>${m.cd || 0}</span></div>
    </div>
    <div class="p-section">
      <button class="p-open-file" data-path="${id}">Open in Editor</button>
    </div>
  `;

  if (incoming.length > 0) {
    html += `<div class="p-section"><h3>Imported by (${incoming.length})</h3><ul class="p-list">`;
    incoming.forEach((e) => {
      const c = nodeColor(e.from);
      const label = nodeMetrics[e.from]?.label || e.from.split('/').pop();
      html += `<li data-navigate="${e.from}"><div class="dot" style="background:${c}"></div>${label}</li>`;
    });
    html += `</ul></div>`;
  }

  if (outgoing.length > 0) {
    html += `<div class="p-section"><h3>Imports (${outgoing.length})</h3><ul class="p-list">`;
    outgoing.forEach((e) => {
      const c = nodeColor(e.to);
      const label = nodeMetrics[e.to]?.label || e.to.split('/').pop();
      html += `<li data-navigate="${e.to}"><div class="dot" style="background:${c}"></div>${label}</li>`;
    });
    html += `</ul></div>`;
  }

  const panelContent = document.getElementById('panel-content');
  if (panelContent) panelContent.innerHTML = html;

  const panel = document.getElementById('panel');
  if (panel) panel.classList.add('open');

  // Bind navigation clicks (using event delegation)
  if (panelContent) {
    panelContent.querySelectorAll('[data-navigate]').forEach((el) => {
      el.addEventListener('click', () => {
        const targetId = el.getAttribute('data-navigate');
        if (targetId) navigateTo(targetId);
      });
    });

    // Bind "Open in Editor" button
    panelContent.querySelectorAll('.p-open-file').forEach((el) => {
      el.addEventListener('click', () => {
        const filePath = el.getAttribute('data-path');
        if (filePath) {
          vscode.postMessage({ command: 'openFile', path: filePath });
        }
      });
    });
  }
}

function closePanel() {
  const panel = document.getElementById('panel');
  if (panel) panel.classList.remove('open');
}

function navigateTo(id) {
  const g = nodeById[id];
  if (!g) return;
  selectNode(id);
  const bbox = g.getBBox();
  const cx = bbox.x + bbox.width / 2;
  const cy = bbox.y + bbox.height / 2;
  viewBox.x = cx - viewBox.w / 2;
  viewBox.y = cy - viewBox.h / 2;
  updateViewBox();
}

// ============================================
// SEARCH
// ============================================
const searchInput = document.getElementById('search-input');
if (searchInput) {
  searchInput.addEventListener('input', () => {
    const q = searchInput.value.toLowerCase().trim();
    if (!q) { resetHighlight(); return; }
    if (!nodeGroups) return;

    const matchIds = new Set();
    Object.keys(nodeById).forEach((id) => {
      const label = nodeMetrics[id]?.label || id;
      if (label.toLowerCase().includes(q) || id.toLowerCase().includes(q)) {
        matchIds.add(id);
      }
    });

    nodeGroups.forEach((g) => {
      const nid = g.querySelector('title')?.textContent.trim();
      g.style.opacity = matchIds.has(nid) ? '1' : '0.12';
    });
    edgeGroups.forEach((g) => { g.style.opacity = '0.05'; });
    clusterGroups.forEach((g) => { g.style.opacity = '0.3'; });
  });

  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      searchInput.value = '';
      resetHighlight();
      searchInput.blur();
    }
  });
}

// ============================================
// KEYBOARD SHORTCUTS
// ============================================
document.addEventListener('keydown', (e) => {
  if (e.key === '/' && document.activeElement !== searchInput) {
    e.preventDefault();
    if (searchInput) searchInput.focus();
  }
  if (e.key === 'Escape') {
    resetHighlight();
    closePanel();
  }
});

// ============================================
// BUTTON BINDINGS (no inline onclick)
// ============================================
document.getElementById('btn-zoom-in')?.addEventListener('click', () => zoomBy(1.4));
document.getElementById('btn-zoom-out')?.addEventListener('click', () => zoomBy(0.7));
document.getElementById('btn-zoom-fit')?.addEventListener('click', () => zoomFit());
document.getElementById('btn-clear')?.addEventListener('click', () => resetHighlight());
document.getElementById('panel-close')?.addEventListener('click', () => closePanel());
