import { AlertCircle, Check, CircleDot, Layers, Loader2, Timer, Zap } from 'lucide-react';
import { useStore } from '../../store/useStore';
import { encodeInput, formatBytes } from '../../engine';
import { t } from '../../i18n/en';
import { cx } from '../ui/helpers';


function Item({
  icon: Icon,
  children,
  onClick,
  label,
  spin,
}: {
  icon?: typeof Zap;
  children: React.ReactNode;
  onClick?: () => void;
  label?: string;
  spin?: boolean;
}) {
  const content = (
    <>
      {Icon && (
        <Icon
          size={12}
          aria-hidden="true"
          className={cx('shrink-0', spin && 'animate-spin')}
          strokeWidth={2}
        />
      )}
      {children}
    </>
  );

  const shared =
    'flex h-full items-center gap-1 whitespace-nowrap px-2 text-[11px] leading-none';

  if (!onClick) return <span className={shared}>{content}</span>;

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={cx(shared, 'db-status-item transition-colors')}
    >
      {content}
    </button>
  );
}

export function StatusBar() {
  const result = useStore((s) => s.bakeResult);
  const baking = useStore((s) => s.baking);
  const analysing = useStore((s) => s.analysing);
  const steps = useStore((s) => s.steps);
  const pausedAt = useStore((s) => s.pausedAt);
  const autoBake = useStore((s) => s.autoBake);
  const setAutoBake = useStore((s) => s.setAutoBake);
  const input = useStore((s) => s.input);
  const inputEncoding = useStore((s) => s.inputEncoding);

  const busy = baking || analysing;
  const failed = Boolean(result?.error);
  const enabled = steps.filter((s) => !s.disabled).length;

  return (
    <footer
      aria-label={t.status.region}
      className="db-status flex h-[22px] shrink-0 select-none items-stretch font-sans"
    >
      <Item
        icon={busy ? Loader2 : failed ? AlertCircle : pausedAt !== null ? CircleDot : Check}
        spin={busy}
      >
        {busy
          ? t.status.working
          : failed
            ? t.status.failed
            : pausedAt !== null
              ? t.status.paused
              : t.status.ready}
      </Item>

      <Item icon={AlertCircle}>
        {failed ? t.status.errors(1) : t.status.errors(0)}
      </Item>

      <Item icon={Layers}>
        {t.status.steps}: {enabled}/{steps.length}
      </Item>

      <Item
        icon={Zap}
        onClick={() => setAutoBake(!autoBake)}
        label={t.recipe.autoBakeHint}
      >
        {t.status.autoRun}: {autoBake ? t.status.on : t.status.off}
      </Item>

      <span className="ms-auto flex items-stretch">
        <Item>
          {t.status.input}: {formatBytes(encodeInput(input, inputEncoding).length)}
        </Item>

        {result && !result.error && (
          <Item>
            {t.status.output}: {formatBytes(result.byteLength)}
          </Item>
        )}

        {result && !result.error && (
          <Item icon={Timer}>{result.durationMs.toFixed(1)} ms</Item>
        )}

        <Item>{inputEncoding}</Item>
      </span>
    </footer>
  );
}
