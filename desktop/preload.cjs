// Ponte mínima do app de PC (RFC-024): só estas funções, nunca o ipcRenderer inteiro.
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('pulseDesktop', {
  platform: 'desktop',
  machineId: () => ipcRenderer.invoke('pulse:machineId'),
  exit: () => ipcRenderer.send('pulse:exit'),
})
