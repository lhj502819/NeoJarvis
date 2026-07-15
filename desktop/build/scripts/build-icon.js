const { app, BrowserWindow } = require('electron')
const fs = require('fs')

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1024, height: 1024, show: false,
    webPreferences: { nodeIntegration: false, contextIsolation: true }
  })
  await win.loadFile('desktop/build/scripts/build-icon.html')
  // 等 canvas 完成(title 变 READY)
  for (let i = 0; i < 50; i++) {
    const t = await win.webContents.executeJavaScript('document.title')
    if (t === 'READY') break
    await new Promise(r => setTimeout(r, 200))
  }
  const dataUrl = await win.webContents.executeJavaScript('window._iconDataUrl')
  const base64 = dataUrl.replace(/^data:image\/png;base64,/, '')
  fs.writeFileSync('desktop/build/icon.png', Buffer.from(base64, 'base64'))
  console.log('OK saved:', 'desktop/build/icon.png')
  app.quit()
})
