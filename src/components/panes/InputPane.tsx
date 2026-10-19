import { useRef, useState } from 'react';
import { FileUp, X } from 'lucide-react';
import { useStore } from '../../store/useStore';
import { encodeInput, formatBytes, INPUT_ENCODINGS } from '../../engine';
import { t } from '../../i18n/en';
import { cx } from '../ui/helpers';
import { IconButton } from '../ui/primitives';
import { EntropyStrip } from './EntropyStrip';
import { Pane } from './Pane';

export function InputPane() {
  const input = useStore((s) => s.input);
  const inputEncoding = useStore((s) => s.inputEncoding);
  const setInput = useStore((s) => s.setInput);
  const setInputEncoding = useStore((s) => s.setInputEncoding);
  const clearInput = useStore((s) => s.clearInput);
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const loadFile = async (file: File | undefined) => {
    if (!file) return;
    const bytes = new Uint8Array(await file.arrayBuffer());
    let text = '';
    const chunk = 8192;
    for (let i = 0; i < bytes.length; i += chunk) {
      text += String.fromCharCode(...bytes.subarray(i, i + chunk));
    }
    setInput(text, 'Raw bytes');
  };

  return (
    <Pane
      title={t.input.title}
      step={1}
      meta={
        <span className="flex items-center gap-2 font-mono text-micro text-faint">
          <span>{formatBytes(encodeInput(input, inputEncoding).length)}</span>
          {input.length > 0 && <span>{t.status.lines(input.split('\n').length)}</span>}
        </span>
      }
      actions={
        <>
          <IconButton label={t.input.loadFile} onClick={() => fileInput.current?.click()}>
            <FileUp size={13} aria-hidden="true" />
          </IconButton>
          <IconButton label={t.input.clear} onClick={clearInput} disabled={input.length === 0}>
            <X size={13} aria-hidden="true" />
          </IconButton>
        </>
      }
    >
      <input
        ref={fileInput}
        type="file"
        className="sr-only"
        onChange={(e) => void loadFile(e.target.files?.[0])}
      />

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          void loadFile(e.dataTransfer.files[0]);
        }}
        className="relative flex min-h-0 flex-1 flex-col"
      >
        <textarea
          id="decodebox-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          spellCheck={false}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          aria-label={t.input.title}
          placeholder={t.input.placeholder}
          className="min-h-0 w-full flex-1 resize-none bg-transparent p-3 font-mono text-[0.875rem] leading-[1.75] outline-hidden placeholder:text-faint"
        />

        {dragging && (
          <div className="pointer-events-none absolute inset-0 grid place-items-center bg-bg/90">
            <span className="rounded-control border border-accent-line bg-accent-soft px-3 py-1.5 font-mono text-micro text-text">
              {t.input.drop}
            </span>
          </div>
        )}

        <EntropyStrip />

        <div className="flex shrink-0 items-center gap-2 border-t border-line px-3 py-1.5">
          <label htmlFor="input-encoding" className="text-micro text-faint">
            {t.input.encoding}
          </label>
          <select
            id="input-encoding"
            value={inputEncoding}
            title={t.input.encodingHint}
            onChange={(e) => setInputEncoding(e.target.value)}
            className={cx(
              'max-w-[16rem] rounded-control border border-line bg-surface-2 px-2 py-0.5',
              'font-mono text-micro text-muted outline-hidden',
              'focus-visible:border-accent-line',
            )}
          >
            {INPUT_ENCODINGS.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </div>

      </div>
    </Pane>
  );
}
