import { Download, Keyboard, Moon, Search, Sun } from 'lucide-react';
import { GithubMark } from '../ui/GithubMark';
import { OwaspMark } from '../ui/OwaspMark';
import { useStore } from '../../store/useStore';
import { t } from '../../i18n/en';
import { cx } from '../ui/helpers';



function TitleButton({
  label,
  onClick,
  href,
  children,
}: {
  label: string;
  onClick?: () => void;
  href?: string;
  children: React.ReactNode;
}) {
  const className =
    'inline-grid h-[26px] w-[26px] place-items-center rounded-xs text-muted transition-colors duration-100 hover:bg-surface-3 hover:text-text';

  if (href) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noreferrer noopener"
        aria-label={label}
        title={label}
        className={className}
      >
        {children}
      </a>
    );
  }
  return (
    <button type="button" onClick={onClick} aria-label={label} title={label} className={className}>
      {children}
    </button>
  );
}

export function Header() {
  const theme = useStore((s) => s.theme);
  const setTheme = useStore((s) => s.setTheme);
  const setDialog = useStore((s) => s.setDialog);
  const focusSearch = useStore((s) => s.focusSearch);
  const steps = useStore((s) => s.steps);

  const isDark =
    theme === 'dark' ||
    (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);

  return (
    <header className="flex h-[35px] shrink-0 items-center gap-2 border-b border-line bg-surface-2 px-2">
      <div className="flex shrink-0 items-center gap-1.5">
        <OwaspMark size={15} style={{ color: 'var(--accent)' }} className="shrink-0" />
        <span className="truncate font-sans text-[12px] leading-none">
          <span style={{ color: 'var(--accent-text)' }}>OWASP</span>
          <span className="ms-1 text-text">DecodeBox</span>
        </span>
      </div>

      <button
        type="button"
        onClick={focusSearch}
        className={cx(
          'mx-auto hidden h-[22px] w-full max-w-[420px] items-center justify-center gap-2',
          'rounded-[5px] border border-line bg-surface text-[11px] text-faint',
          'transition-colors duration-100 hover:bg-surface-3 hover:text-muted sm:flex',
        )}
      >
        <Search size={11} aria-hidden="true" />
        <span className="truncate">
          {steps.length === 0 ? t.header.commandEmpty : t.header.commandSteps(steps.length)}
        </span>
        <kbd className="ms-1 rounded-xs border border-line px-1 font-mono text-[10px] leading-[14px]">
          {t.operations.shortcut}
        </kbd>
      </button>

      <div className="ms-auto flex shrink-0 items-center gap-0.5 sm:ms-0">
        <TitleButton label={t.header.download} onClick={() => setDialog('download')}>
          <Download size={14} aria-hidden="true" />
        </TitleButton>
        <TitleButton
          label={t.header.theme}
          onClick={() => setTheme(isDark ? 'light' : 'dark')}
        >
          {isDark ? <Sun size={14} aria-hidden="true" /> : <Moon size={14} aria-hidden="true" />}
        </TitleButton>
        <TitleButton label={t.header.help} onClick={() => setDialog('help')}>
          <Keyboard size={14} aria-hidden="true" />
        </TitleButton>
        <TitleButton label={t.header.github} href="https://github.com/OWASP/DecodeBox">
          <GithubMark size={14} aria-hidden="true" />
        </TitleButton>
      </div>
    </header>
  );
}
