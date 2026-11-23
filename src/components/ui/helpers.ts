import type { Severity } from '../../engine';

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

export function modShortcut(key: string): string {
  const mac = /Mac|iPhone|iPad|iPod/.test(
    (typeof navigator !== 'undefined' && (navigator.platform || navigator.userAgent)) || '',
  );
  return `${mac ? '⌘' : 'Ctrl'} ${key}`;
}

export function altKeyLabel(): string {
  const mac = /Mac|iPhone|iPad|iPod/.test(
    (typeof navigator !== 'undefined' && (navigator.platform || navigator.userAgent)) || '',
  );
  return mac ? 'Option' : 'Alt';
}

export function confidenceColor(confidence: number): string {
  if (confidence >= 0.9) return 'var(--green)';
  if (confidence >= 0.6) return 'var(--amber)';
  return 'var(--text-faint)';
}

const SEVERITY_RANK: Record<Severity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  info: 4,
};

export function bySeverity(a: { severity: Severity }, b: { severity: Severity }): number {
  return SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
}
