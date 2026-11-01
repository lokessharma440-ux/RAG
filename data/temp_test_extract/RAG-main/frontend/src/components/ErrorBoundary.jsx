import React from 'react';

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('ErrorBoundary caught an error:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          padding: '40px 24px',
          maxWidth: '600px',
          margin: '40px auto',
          backgroundColor: '#ffffff',
          border: '1px solid #fecaca',
          borderRadius: '10px',
          textAlign: 'center',
          boxShadow: '0 4px 12px rgba(0,0,0,0.05)'
        }}>
          <h3 style={{ fontSize: '18px', fontWeight: 700, color: '#991b1b', marginBottom: '8px' }}>
            Unable to display this view
          </h3>
          <p style={{ fontSize: '13px', color: '#4b5563', marginBottom: '20px' }}>
            {this.state.error?.message || 'An unexpected rendering error occurred.'}
          </p>
          <button
            type="button"
            onClick={() => {
              this.setState({ hasError: false, error: null });
              if (this.props.onReset) this.props.onReset();
            }}
            style={{
              backgroundColor: '#111827',
              color: '#ffffff',
              border: 'none',
              padding: '8px 16px',
              borderRadius: '6px',
              fontSize: '13px',
              fontWeight: 600,
              cursor: 'pointer'
            }}
          >
            Back to Dashboard
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
