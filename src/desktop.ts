/*
  Фотон в приложении для macOS (desktop/). Окно даёт мост photonDesktop:
  команды системного меню и полноэкранный режим. В браузере моста нет —
  студия работает как обычно.
*/
export type DesktopCommand = 'open' | 'save' | 'export' | 'undo' | 'redo' | 'help';

interface DesktopBridge {
  platform: string;
  onCommand(callback: (command: DesktopCommand) => void): () => void;
  onFullscreen(callback: (fullscreen: boolean) => void): () => void;
}

export const desktop = (window as unknown as { photonDesktop?: DesktopBridge }).photonDesktop;

/** Помечает документ для стилей окна: кнопки окна в плашке, полоса для перетаскивания. */
export function markDesktop() {
  if (!desktop) return;
  const root = document.documentElement;
  root.dataset.desktop = desktop.platform;
  desktop.onFullscreen((full) => {
    root.dataset.fullscreen = String(full);
  });
}
