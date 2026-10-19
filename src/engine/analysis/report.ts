import type { Analysis, AnalysisNode } from './types';


export function flatten(node: AnalysisNode): AnalysisNode[] {
  return [node, ...node.children.flatMap(flatten)];
}

export function toMarkdown(analysis: Analysis): string {
  const lines: string[] = ['# DecodeBox analysis', ''];

  const chain = flatten(analysis.root)
    .filter((node) => node.depth > 0)
    .map((node) => node.format);

  lines.push(
    `- **Structure:** ${chain.length > 0 ? [...new Set(chain)].join(', ') : 'plain text, no encoding detected'}`,
    `- **Layers explored:** ${analysis.nodes} (max depth ${analysis.maxDepth})`,
    `- **Findings:** ${analysis.findings.length}`,
    `- **Indicators:** ${analysis.indicators.length}`,
    '',
  );

  if (analysis.findings.length > 0) {
    lines.push('## Findings', '');
    for (const finding of analysis.findings) {
      lines.push(
        `### ${finding.severity.toUpperCase()} — ${finding.title}`,
        '',
        finding.detail,
        '',
        `- Found at: \`${finding.path}\``,
        `- Evidence: \`${finding.evidence.replace(/`/g, "'").slice(0, 160)}\``,
        ...(finding.reference ? [`- Reference: ${finding.reference}`] : []),
        '',
      );
    }
  }

  if (analysis.indicators.length > 0) {
    lines.push('## Indicators', '', '| Type | Value (defanged) | Found at |', '| --- | --- | --- |');
    for (const indicator of analysis.indicators) {
      const value = indicator.defanged.replace(/\|/g, '\\|').slice(0, 120);
      lines.push(`| ${indicator.kind} | \`${value}\` | ${indicator.path} |`);
    }
    lines.push('');
  }

  lines.push(
    '---',
    '',
    `Produced by OWASP DecodeBox. Everything above was computed in the browser; nothing was uploaded.`,
  );

  return lines.join('\n');
}
