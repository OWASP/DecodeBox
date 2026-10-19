import { Component, type ErrorInfo, type ReactNode } from 'react';
import { t } from '../../i18n/en';
import { Button } from './primitives';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('DecodeBox crashed:', error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="grid min-h-screen place-items-center px-6 text-center">
        <div className="max-w-md">
          <h1 className="text-section font-semibold">{t.error.boundary}</h1>
          <p className="mt-2 text-muted">{t.error.boundaryDetail}</p>
          <p className="mt-4 wrap-break-word font-mono text-micro text-faint">{error.message}</p>
          <Button className="mt-6" onClick={() => window.location.reload()}>
            {t.error.reload}
          </Button>
        </div>
      </div>
    );
  }
}
