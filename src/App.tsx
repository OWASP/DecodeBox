import { useEffect } from 'react';
import { useStore } from './store/useStore';
import { t } from './i18n/en';
import { useAnalysis } from './hooks/useAnalysis';
import { useHotkeys } from './hooks/useHotkeys';
import { Header } from './components/layout/Header';
import { Workspace } from './components/layout/Workspace';
import { ActivityBar } from './components/layout/ActivityBar';
import { useIsDesktop } from './hooks/useMediaQuery';
import { StatusBar } from './components/layout/StatusBar';
import { CtfView } from './components/ctf/CtfView';
import { HelpDialog } from './components/ui/HelpDialog';
import { ShareDialog } from './components/ui/ShareDialog';
import { RecipeLibrary } from './components/ui/RecipeLibrary';
import { DownloadDialog } from './components/ui/DownloadDialog';

export default function App() {
  const loadOperations = useStore((s) => s.loadOperations);
  const restoreFromUrl = useStore((s) => s.restoreFromUrl);
  const dialog = useStore((s) => s.dialog);
  const view = useStore((s) => s.view);
  const isDesktop = useIsDesktop();

  useEffect(() => {
    void loadOperations().then(() => restoreFromUrl());
  }, [loadOperations, restoreFromUrl]);

  useAnalysis();
  useHotkeys();

  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      <a
        href="#decodebox-input"
        className="sr-only rounded-control border border-accent-line bg-surface px-3 py-2 text-xs2 font-medium text-text focus:not-sr-only focus:absolute focus:inset-s-2 focus:top-2 focus:z-50"
      >
        {t.layout.skipToInput}
      </a>
      <Header />

      <div className="flex min-h-0 min-w-0 flex-1">
        {isDesktop && <ActivityBar />}
        {view === 'workspace' && <Workspace />}
        {view === 'ctf' && <CtfView />}
      </div>

      <StatusBar />
      {dialog === 'help' && <HelpDialog />}
      {dialog === 'share' && <ShareDialog />}
      {dialog === 'library' && <RecipeLibrary />}
      {dialog === 'download' && <DownloadDialog />}
    </div>
  );
}
