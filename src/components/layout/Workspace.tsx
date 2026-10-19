import { Maximize2, Minimize2 } from 'lucide-react';
import { useStore } from '../../store/useStore';
import { OperationsPane } from '../panes/OperationsPane';
import { InputPane } from '../panes/InputPane';
import { OutputPane } from '../panes/OutputPane';
import { Pipeline } from '../panes/Pipeline';
import { DetectionSidebar } from '../panes/DetectionSidebar';
import { EditorTabs } from './EditorTabs';
import { Splitter } from './Splitter';
import { MobileTabs } from './MobileTabs';
import { useIsDesktop } from '../../hooks/useMediaQuery';
import { t } from '../../i18n/en';

export function Workspace() {
  const paneWidths = useStore((s) => s.paneWidths);
  const setPaneWidth = useStore((s) => s.setPaneWidth);
  const paneHeights = useStore((s) => s.paneHeights);
  const setPaneHeight = useStore((s) => s.setPaneHeight);
  const mobilePane = useStore((s) => s.mobilePane);
  const maximised = useStore((s) => s.outputMaximised);
  const setOutputMaximised = useStore((s) => s.setOutputMaximised);
  const activity = useStore((s) => s.activity);
  const sidebarOpen = useStore((s) => s.sidebarOpen);
  const setSidebarOpen = useStore((s) => s.setSidebarOpen);
  const steps = useStore((s) => s.steps);
  const isDesktop = useIsDesktop();

  if (!isDesktop) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex min-h-0 flex-1 flex-col">
          {mobilePane === 'operations' && <OperationsPane />}
          {mobilePane === 'recipe' && <Pipeline />}
          {mobilePane === 'input' && <InputPane />}
          {mobilePane === 'output' && <OutputPane />}
        </div>
        <MobileTabs />
      </div>
    );
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1">
      {sidebarOpen && (
        <>
          <div
            style={{ flex: `0 0 ${paneWidths.operations}px` }}
            className="flex min-h-0 min-w-0 flex-col overflow-hidden bg-surface"
          >
            {activity === 'detection' ? <DetectionSidebar /> : <OperationsPane />}
          </div>
          <Splitter
            value={paneWidths.operations}
            min={170}
            max={480}
            label={t.layout.resizeOperations}
            onChange={(w) => setPaneWidth('operations', w)}
          />
        </>
      )}

      <div className="flex min-h-0 min-w-0 flex-1">
        {!maximised && (
          <>
            <div
              style={{ flex: `0 0 ${paneWidths.recipe}px` }}
              className="flex min-h-0 min-w-0 flex-col overflow-hidden bg-bg"
            >
              <EditorTabs
                tabs={[
                  {
                    id: 'recipe',
                    name: 'recipe.yaml',
                    kind: 'yaml',
                    dirty: steps.length > 0,
                  },
                ]}
                active="recipe"
                onSelect={() => undefined}
              />
              <Pipeline />
            </div>
            <Splitter
              value={paneWidths.recipe}
              min={220}
              max={680}
              label={t.layout.resizeRecipe}
              onChange={(w) => setPaneWidth('recipe', w)}
            />
          </>
        )}

        <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-bg">
          {!maximised && (
            <>
              <div
                className="flex min-h-0 min-w-0 flex-col overflow-hidden"
                style={{ flex: `0 0 ${paneHeights.input}px` }}
              >
                <EditorTabs
                  tabs={[{ id: 'input', name: 'input.txt', kind: 'txt' }]}
                  active="input"
                  onSelect={() => undefined}
                />
                <InputPane />
              </div>
              <Splitter
                axis="vertical"
                value={paneHeights.input}
                min={90}
                max={760}
                label={t.layout.resizeInput}
                onChange={(height) => setPaneHeight('input', height)}
              />
            </>
          )}

          <div className="flex min-h-0 min-w-0 flex-1 basis-0 flex-col overflow-hidden">
            <EditorTabs
              tabs={[{ id: 'output', name: 'output.hex', kind: 'hex' }]}
              active="output"
              onSelect={() => undefined}
              actions={
                <button
                  type="button"
                  onClick={() => setOutputMaximised(!maximised)}
                  aria-label={maximised ? t.layout.restore : t.layout.maximiseOutput}
                  title={maximised ? t.layout.restore : t.layout.maximiseOutput}
                  aria-pressed={maximised}
                  className="grid h-6 w-6 place-items-center rounded-xs text-faint transition-colors hover:bg-surface-3 hover:text-text"
                >
                  {maximised ? (
                    <Minimize2 size={13} aria-hidden="true" />
                  ) : (
                    <Maximize2 size={13} aria-hidden="true" />
                  )}
                </button>
              }
            />
            <OutputPane />
          </div>
        </div>
      </div>

      {!sidebarOpen && (
        <button
          type="button"
          onClick={() => setSidebarOpen(true)}
          aria-label={t.layout.showOperations}
          title={t.layout.showOperations}
          className="sr-only"
        >
          {t.layout.showOperations}
        </button>
      )}
    </div>
  );
}
