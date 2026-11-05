/*
  Фотон для macOS — та же студия, что в браузере, в окне приложения.

  Сборка сайта (dist) лежит внутри приложения и отдаётся по своему адресу
  photon://app, а не file://: у страницы постоянное происхождение (сцена
  в localStorage переживает перезапуск) и безопасный контекст для WebCodecs.
  Движок тот же Chromium, что в Chrome: свет считается так же, как на сайте.

  Окно без заголовка: кнопки окна встают в плашку «Фотон», верхняя полоса
  тянет окно. Меню, диалоги открытия и сохранения — системные.
*/
const { app, BrowserWindow, Menu, net, protocol, screen, session, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const WEB = path.join(__dirname, 'web');
const DEV_URL = process.env.PHOTON_URL;
const ORIGIN = 'photon://app';

// Те же правила, что у сайта (deploy/nginx.conf).
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self'",
  "media-src 'self' blob: data:",
  "object-src 'none'",
  "base-uri 'self'",
].join('; ');

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
};

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'photon',
    privileges: { standard: true, secure: true, supportFetchAPI: true, codeCache: true },
  },
]);

async function serve(request) {
  const { pathname } = new URL(request.url);
  const rel = decodeURIComponent(pathname === '/' ? '/index.html' : pathname);
  const file = path.normalize(path.join(WEB, rel));
  if (!file.startsWith(WEB + path.sep) || !fs.existsSync(file)) {
    return new Response('Not found', { status: 404 });
  }
  const res = await net.fetch(pathToFileURL(file).toString());
  return new Response(res.body, {
    headers: {
      'Content-Type': TYPES[path.extname(file)] ?? 'application/octet-stream',
      'Content-Security-Policy': CSP,
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

// --- окно -------------------------------------------------------------------

const STATE = () => path.join(app.getPath('userData'), 'window.json');

function savedBounds() {
  try {
    const b = JSON.parse(fs.readFileSync(STATE(), 'utf8'));
    // Окно с отключённого монитора не открываем за краем экрана.
    const area = screen.getDisplayMatching(b).workArea;
    const visible =
      b.x < area.x + area.width && b.y < area.y + area.height && b.x + b.width > area.x;
    return visible ? b : null;
  } catch {
    return null;
  }
}

// Кнопки окна стоят в плашке «Фотон»: она в 12 px от края, высотой 44 px.
const TRAFFIC_LIGHTS = { x: 28, y: 27 };

function createWindow() {
  const bounds = savedBounds();
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    ...bounds,
    minWidth: 1000,
    minHeight: 640,
    title: 'Фотон',
    show: false,
    // Цвет доски: окно не мигает белым до первого кадра.
    backgroundColor: '#0c0c0c',
    titleBarStyle: 'hidden',
    trafficLightPosition: TRAFFIC_LIGHTS,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: false,
      // Живой свет не замирает, пока окно за другими.
      backgroundThrottling: false,
    },
  });
  if (bounds?.maximized) win.maximize();

  win.once('ready-to-show', () => win.show());
  win.on('close', () => {
    const b = win.getNormalBounds();
    fs.writeFileSync(STATE(), JSON.stringify({ ...b, maximized: win.isMaximized() }));
  });

  // В полноэкранном режиме кнопок окна нет — плашка возвращает свой отступ.
  const sendFullscreen = () => win.webContents.send('photon:fullscreen', win.isFullScreen());
  win.on('enter-full-screen', sendFullscreen);
  win.on('leave-full-screen', sendFullscreen);
  win.webContents.on('did-finish-load', sendFullscreen);

  // Страница никуда не уходит; внешние ссылки — в браузер по умолчанию.
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith(ORIGIN) && !(DEV_URL && url.startsWith(DEV_URL))) e.preventDefault();
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });

  // Вырезать, скопировать, вставить — в полях ввода, как в любом приложении.
  win.webContents.on('context-menu', (_e, params) => {
    if (!params.isEditable) return;
    Menu.buildFromTemplate([
      { role: 'cut', label: 'Вырезать' },
      { role: 'copy', label: 'Скопировать' },
      { role: 'paste', label: 'Вставить' },
      { type: 'separator' },
      { role: 'selectAll', label: 'Выбрать всё' },
    ]).popup({ window: win });
  });

  void win.loadURL(DEV_URL ?? `${ORIGIN}/index.html`);
  return win;
}

// --- меню -------------------------------------------------------------------

// Команды меню выполняет сама студия (window.photonDesktop.onCommand).
const command = (id) => () =>
  BrowserWindow.getFocusedWindow()?.webContents.send('photon:command', id);

function buildMenu() {
  const name = app.getName();
  return Menu.buildFromTemplate([
    {
      label: name,
      submenu: [
        { role: 'about', label: `О программе «${name}»` },
        { type: 'separator' },
        { role: 'services', label: 'Службы' },
        { type: 'separator' },
        { role: 'hide', label: `Скрыть «${name}»` },
        { role: 'hideOthers', label: 'Скрыть остальные' },
        { role: 'unhide', label: 'Показать все' },
        { type: 'separator' },
        { role: 'quit', label: `Завершить «${name}»` },
      ],
    },
    {
      label: 'Файл',
      submenu: [
        { label: 'Открыть JSON…', accelerator: 'Cmd+O', click: command('open') },
        { label: 'Сохранить JSON…', accelerator: 'Cmd+S', click: command('save') },
        { type: 'separator' },
        { label: 'Экспорт…', accelerator: 'Cmd+E', click: command('export') },
        { type: 'separator' },
        { role: 'close', label: 'Закрыть окно' },
      ],
    },
    {
      label: 'Правка',
      submenu: [
        { label: 'Отменить', accelerator: 'Cmd+Z', click: command('undo') },
        { label: 'Повторить', accelerator: 'Shift+Cmd+Z', click: command('redo') },
        { type: 'separator' },
        { role: 'cut', label: 'Вырезать' },
        { role: 'copy', label: 'Скопировать' },
        { role: 'paste', label: 'Вставить' },
        { role: 'selectAll', label: 'Выбрать всё' },
      ],
    },
    {
      label: 'Вид',
      submenu: [
        { role: 'togglefullscreen', label: 'Во весь экран' },
        { type: 'separator' },
        { role: 'toggleDevTools', label: 'Инструменты разработчика' },
      ],
    },
    {
      label: 'Окно',
      role: 'window',
      submenu: [
        { role: 'minimize', label: 'Свернуть' },
        { role: 'zoom', label: 'Изменить масштаб' },
        { type: 'separator' },
        { role: 'front', label: 'Все окна — на передний план' },
      ],
    },
    {
      label: 'Справка',
      role: 'help',
      submenu: [{ label: 'Правила света и клавиши', click: command('help') }],
    },
  ]);
}

// --- запуск -----------------------------------------------------------------

// Второй запуск не открывает вторую студию: сцена в localStorage одна.
if (!app.requestSingleInstanceLock()) app.quit();
else void app.whenReady().then(start);

function start() {
  protocol.handle('photon', serve);
  Menu.setApplicationMenu(buildMenu());
  app.setAboutPanelOptions({
    applicationName: app.getName(),
    applicationVersion: app.getVersion(),
    copyright: 'Студия света VK',
  });

  // Экспорт и JSON сохраняются через системное окно «Сохранить».
  session.defaultSession.on('will-download', (_e, item) => {
    item.setSaveDialogOptions({
      defaultPath: path.join(app.getPath('downloads'), item.getFilename()),
    });
  });

  let win = createWindow();
  app.on('second-instance', () => {
    if (win.isMinimized()) win.restore();
    win.focus();
  });
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) win = createWindow();
  });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
