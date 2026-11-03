'use strict';
// More libuv threads = more parallel lstat() calls. Must be set before any fs call.
process.env.UV_THREADPOOL_SIZE ||= '16';

const { app, BrowserWindow, dialog, shell } = require('electron');
const os = require('node:os');
const { start } = require('../lib/server');

let win;

// Native implementations: no osascript, no "control Finder" permission prompt.
const actions = {
  reveal: async (p) => shell.showItemInFolder(p),
  trash: (p) => shell.trashItem(p),
  pick: async () => {
    const r = await dialog.showOpenDialog(win, { properties: ['openDirectory'], message: 'Dossier à analyser' });
    return r.canceled ? null : r.filePaths[0];
  },
};

app.whenReady().then(async () => {
  // port 0 = any free port, so the app never conflicts with anything.
  const { url } = await start({ startPath: os.homedir(), port: 0, actions });
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 900,
    minHeight: 560,
    title: 'MacDirStat',
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#0b0d12',
    show: false,
  });
  win.once('ready-to-show', () => win.show());
  win.loadURL(`${url}/?app`);
});

app.on('window-all-closed', () => app.quit());
