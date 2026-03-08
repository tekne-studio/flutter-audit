let graphvizInstance: any = null;

async function getGraphviz(): Promise<any> {
  if (!graphvizInstance) {
    const { Graphviz } = await import('@hpcc-js/wasm-graphviz');
    graphvizInstance = await Graphviz.load();
  }
  return graphvizInstance;
}

export async function renderDotToSvg(
  styledDot: string,
  layout: string = 'fdp',
): Promise<string> {
  const graphviz = await getGraphviz();
  return graphviz.layout(styledDot, 'svg', layout);
}
