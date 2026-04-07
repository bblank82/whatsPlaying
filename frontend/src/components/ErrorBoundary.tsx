import React from 'react';

interface Props { children: React.ReactNode; fallback?: React.ReactNode; }
interface State { hasError: boolean; }

export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('ErrorBoundary caught:', error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback ?? (
        <div style={{
          background: 'rgba(255,69,58,0.12)',
          border: '1px solid rgba(255,69,58,0.3)',
          borderRadius: 12,
          padding: '20px 16px',
          color: 'rgba(255,255,255,0.5)',
          fontSize: 13,
          textAlign: 'center',
        }}>
          Something went wrong displaying this card.
        </div>
      );
    }
    return this.props.children;
  }
}
