import type { LucideIcon } from 'lucide-react';
import { FileCode2, FolderTree, HelpCircle, Link2, Save, Search } from 'lucide-react';
import { useStore } from '../../store/useStore';
import type { Activity } from '../../store/useStore';
import { t } from '../../i18n/en';


type Item = {
  id: Activity;
  icon: LucideIcon;
  label: string;
};

const VIEWS: Item[] = [
  { id: 'operations', icon: FileCode2, label: t.activity.operations },
  { id: 'search', icon: Search, label: t.activity.search },
  { id: 'detection', icon: FolderTree, label: t.activity.detection },
];

function RailButton({
  icon: Icon,
  label,
  active,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-current={active ? 'true' : undefined}
      title={label}
      data-active={active}
      className="db-rail-item relative grid h-12 w-12 shrink-0 place-items-center outline-hidden transition-colors duration-100"
    >
      {active && (
        <span
          aria-hidden="true"
          className="absolute inset-y-1 inset-s-0 w-[2px] rounded-e-sm"
          style={{ backgroundColor: 'var(--accent)' }}
        />
      )}
      <Icon size={20} strokeWidth={1.6} aria-hidden="true" />
    </button>
  );
}

export function ActivityBar() {
  const activity = useStore((s) => s.activity);
  const setActivity = useStore((s) => s.setActivity);
  const sidebarOpen = useStore((s) => s.sidebarOpen);
  const setSidebarOpen = useStore((s) => s.setSidebarOpen);
  const setDialog = useStore((s) => s.setDialog);

  return (
    <nav
      aria-label={t.activity.title}
      className="db-rail flex w-12 shrink-0 flex-col justify-between border-e border-line"
    >
      <div className="flex flex-col">
        {VIEWS.map((item) => (
          <RailButton
            key={item.id}
            icon={item.icon}
            label={item.label}
            active={activity === item.id}
            onClick={() => {
              if (activity === item.id && item.id !== 'search') {
                setSidebarOpen(!sidebarOpen);
                return;
              }
              setActivity(item.id);
              setSidebarOpen(true);
            }}
          />
        ))}
      </div>

      <div className="flex flex-col">
        <RailButton
          icon={Save}
          label={t.activity.recipes}
          active={false}
          onClick={() => setDialog('library')}
        />
        <RailButton
          icon={Link2}
          label={t.activity.share}
          active={false}
          onClick={() => setDialog('share')}
        />
        <RailButton
          icon={HelpCircle}
          label={t.activity.help}
          active={false}
          onClick={() => setDialog('help')}
        />
      </div>
    </nav>
  );
}
