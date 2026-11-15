import { t } from "../i18n";
import { Component, type ReactNode } from "react";

export default class ErrorBoundary extends Component<{ children: ReactNode; label: string }, { error?: Error }> {
  state: { error?: Error } = {};
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error, info: { componentStack?: string | null }) { console.error(`[${this.props.label}]`, error?.message, error?.stack, info?.componentStack); }
  render() {
    if (this.state.error) {
      return (
        <div className="flex h-full w-full flex-col items-center justify-center gap-2 p-6 text-center text-sm text-red-200">
          <p>{t(this.props.label)}{t(" failed: ")}{this.state.error.message}</p>
          <button className="rounded border border-red-400/50 px-3 py-1 text-xs" onClick={() => this.setState({ error: undefined })}>{t("Retry")}</button>
        </div>
      );
    }
    return this.props.children;
  }
}
