import { afterEach, describe, expect, it, vi } from 'vitest';
import { altKeyLabel, modKeyLabel, modShortcut } from './helpers';

function setPlatform(platform: string) {
  vi.stubGlobal('navigator', { platform, userAgent: platform });
}

describe('platform-specific shortcut labels', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('shows macOS modifiers on Mac', () => {
    setPlatform('MacIntel');
    expect(modKeyLabel()).toBe('⌘');
    expect(altKeyLabel()).toBe('Option');
    expect(modShortcut('K')).toBe('⌘ K');
  });

  it('shows generic modifiers elsewhere', () => {
    setPlatform('Win32');
    expect(modKeyLabel()).toBe('Ctrl');
    expect(altKeyLabel()).toBe('Alt');
    expect(modShortcut('K')).toBe('Ctrl K');
  });
});