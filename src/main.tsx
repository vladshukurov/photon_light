import { Component, StrictMode, type ErrorInfo, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';
import { TEXT_FONT_FAMILY } from './engine/text';

// Шрифт надписи нужен шейдеру ещё до того, как он встретится в интерфейсе.
void document.fonts?.load(`600 32px "${TEXT_FONT_FAMILY}"`);
class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Photon application error', error, info.componentStack);
  }
  render() {
    return this.state.failed ? (
      <div className="app-fallback">
        <h1>Не удалось открыть студию</h1>
        <p>Перезагрузите страницу. Последняя сохранённая сцена останется в браузере.</p>
        <button className="button accent" onClick={() => location.reload()}>
          Перезагрузить
        </button>
      </div>
    ) : (
      this.props.children
    );
  }
}
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
