import { useMemo, useState } from 'react';
import { ArrowUp, Check, Copy, Download, Maximize2, Minimize2, WrapText } from 'lucide-react';
import { useStore } from '../../store/useStore';
import { fileSignatureOf, formatBytes, imageMimeOf, renderText } from '../../engine';
import { hexdumpOf } from '../../engine';
import { Watermark } from '../layout/Watermark';
import { t } from '../../i18n/en';
import { cx } from '../ui/helpers';
import { IconButton } from '../ui/primitives';
import { JsonView } from '../result/JsonView';
import { DetectionStrip } from './DetectionStrip';
import { HashBand } from './HashBand';
import { Pane } from './Pane';

function isJson(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return false;
  try {
    JSON.parse(trimmed);
    return true;
  } catch {
    return false;
  }
}

export function OutputPane() {
  const steps = useStore((s) => s.steps);
  const result = useStore((s) => s.bakeResult);
  const chain = useStore((s) => s.chain);
  const activeLayerId = useStore((s) => s.activeLayerId);
  const moveOutputToInput = useStore((s) => s.moveOutputToInput);
  const stale = useStore((s) => s.stale);
  const pausedAt = useStore((s) => s.pausedAt);
  const maximised = useStore((s) => s.outputMaximised);
  const setMaximised = useStore((s) => s.setOutputMaximised);

  const [wrap, setWrap] = useState(true);
  const [copied, setCopied] = useState(false);

  const activeLayer = chain.find((l) => l.id === activeLayerId) ?? chain[chain.length - 1];
  const output = steps.length > 0 ? (result?.output ?? '') : (activeLayer?.output ?? '');
  const source = steps.length > 0 ? 'recipe' : 'detection';

  const shown = renderText(output);

  const dataUri = /^data:image\/[a-z0-9.+-]+;base64,/i.test(shown.trim());
  const rawImage = dataUri ? null : imageMimeOf(output);
  const isImage = dataUri || rawImage !== null;
  const imageSource = dataUri
    ? shown.trim()
    : rawImage
      ? `data:${rawImage};base64,${btoa(output)}`
      : '';
  const json = !isImage && isJson(shown);
  const pretty = json ? JSON.stringify(JSON.parse(shown.trim()), null, 2) : shown;

  type View = 'raw' | 'hexdump';
  const [view, setView] = useState<View>('raw');

  const shownAs = useMemo(() => (view === 'hexdump' ? hexdumpOf(shown) : shown), [view, shown]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(shown);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
    }
  };

  const download = () => {
    const bytes = new Uint8Array(output.length);
    for (let i = 0; i < output.length; i++) bytes[i] = output.charCodeAt(i) & 0xff;

    const signature = fileSignatureOf(output);
    const extension = signature ? signature.extension : json ? 'json' : 'txt';

    const blob = new Blob([bytes], { type: signature?.mime ?? 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `decodebox-output.${extension}`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Pane
      title={t.output.title}
      step={3}
      meta={
        output.length > 0 && (
          <>
            <span className="rounded-chip border border-line px-1.5 py-px font-mono text-[10px] uppercase tracking-wider text-muted">
              {isImage ? 'image' : json ? 'json' : 'text'}
            </span>
            <span className="font-mono text-micro tabular-nums text-faint">
              {formatBytes(output.length)}
              {!isImage && ` · ${t.status.lines(shown.split('\n').length)}`}
            </span>
            {pausedAt !== null && (
              <span
                className="rounded-chip px-1.5 py-px font-mono text-[10px] uppercase tracking-wider"
                style={{ backgroundColor: 'var(--amber-wash)', color: 'var(--amber)' }}
              >
                {t.output.paused}
              </span>
            )}
            {stale && source === 'recipe' && (
              <span
                title={t.output.staleHint}
                className="rounded-chip px-1.5 py-px font-mono text-[10px] uppercase tracking-wider"
                style={{ backgroundColor: 'var(--amber-wash)', color: 'var(--amber)' }}
              >
                {t.output.stale}
              </span>
            )}
            {source === 'detection' && (
              <span
                title={t.output.fromDetectionHint}
                className="rounded-chip px-1.5 py-px font-mono text-[10px] uppercase tracking-wider"
                style={{ backgroundColor: 'var(--accent-soft)', color: 'var(--accent-text)' }}
              >
                {t.output.fromDetection}
              </span>
            )}
          </>
        )
      }
      actions={
        <>
          <IconButton
            label={maximised ? t.output.restore : t.output.maximise}
            onClick={() => setMaximised(!maximised)}
            className="max-md:hidden"
          >
            {maximised ? (
              <Minimize2 size={13} aria-hidden="true" />
            ) : (
              <Maximize2 size={13} aria-hidden="true" />
            )}
          </IconButton>
          <IconButton
            label={t.output.wrap}
            onClick={() => setWrap((w) => !w)}
            className={wrap ? 'text-text' : undefined}
          >
            <WrapText size={13} aria-hidden="true" />
          </IconButton>
          <IconButton
            label={t.output.toInput}
            onClick={() => moveOutputToInput(output)}
            disabled={output.length === 0}
          >
            <ArrowUp size={13} aria-hidden="true" />
          </IconButton>
          <button
            type="button"
            onClick={copy}
            disabled={output.length === 0}
            aria-label={copied ? t.output.copied : t.output.copy}
            title={t.output.copy}
            className={cx(
              'inline-flex h-8 items-center gap-1.5 rounded-control px-2 text-micro font-medium',
              'transition-colors duration-150 ease-smooth',
              'disabled:pointer-events-none disabled:opacity-40',
              copied
                ? 'text-text'
                : 'border border-line text-muted hover:border-line-strong hover:bg-surface-3 hover:text-text',
            )}
            style={copied ? { borderColor: 'var(--green)', borderWidth: 1, borderStyle: 'solid' } : undefined}
          >
            {copied ? (
              <Check size={13} aria-hidden="true" style={{ color: 'var(--green)' }} />
            ) : (
              <Copy size={13} aria-hidden="true" />
            )}
            <span className="max-lg:hidden">{copied ? t.output.copied : t.output.copyShort}</span>
          </button>
          <IconButton
            label={t.output.download}
            onClick={download}
            disabled={output.length === 0}
          >
            <Download size={13} aria-hidden="true" />
          </IconButton>
        </>
      }
    >
      <HashBand />
      <DetectionStrip />

      {output.length > 0 && !isImage && (
        <div
          role="tablist"
          aria-label={t.output.views}
          className="flex shrink-0 items-center gap-0.5 border-b border-line bg-surface px-2 py-1"
        >
          {(['raw', 'hexdump'] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              role="tab"
              aria-selected={view === mode}
              onClick={() => setView(mode)}
              className={cx(
                'rounded-sm px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider transition-colors',
                view === mode
                  ? 'bg-accent-soft text-text'
                  : 'text-faint hover:bg-surface-3 hover:text-muted',
              )}
              style={view === mode ? { color: 'var(--accent-text)' } : undefined}
            >
              {t.output.viewNames[mode]}
            </button>
          ))}

          {view !== 'raw' && (
            <span className="ms-2 font-mono text-[10px] text-faint">{t.output.viewNote}</span>
          )}
        </div>
      )}

      {result?.error && (
        <div
          className="shrink-0 border-b border-line px-3 py-2 font-mono text-micro"
          style={{ color: 'var(--red)' }}
        >
          {t.recipe.stepFailed(result.error.stepIndex + 1)}: {result.error.message}
        </div>
      )}

      <div className="min-h-0 w-full min-w-0 flex-1 overflow-auto bg-surface">
        {output.length === 0 ? <Watermark /> : isImage ? (
          <div className="flex min-h-full flex-col items-center justify-center gap-3 p-4">
            <img
              src={imageSource}
              alt={t.output.imageAlt}
              className="max-h-full max-w-full rounded-control border border-line object-contain"
              style={{ imageRendering: 'auto' }}
            />
            <p className="font-mono text-micro text-faint">{t.output.imageNote}</p>
          </div>
        ) : (
          <pre
            className={cx(
              'p-3 font-mono text-[0.9375rem] leading-[1.7] text-text',
              view === 'raw' && wrap ? 'whitespace-pre-wrap break-all' : 'whitespace-pre',
            )}
          >
            {view === 'raw' ? json ? <JsonView source={pretty} /> : pretty : shownAs}
          </pre>
        )}
      </div>
    </Pane>
  );
}
