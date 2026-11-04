// npm sometimes installs the `electron` package without running its post-install step,
// which downloads the actual Electron binary. electron-vite then fails with "Electron uninstall".
// This runs before `npm run dev` / `npm run build` and fetches the binary when it is missing.
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join, dirname } from 'node:path'
import { spawnSync } from 'node:child_process'

const require = createRequire(import.meta.url)
const electronDir = dirname(require.resolve('electron/package.json'))
const pathTxt = join(electronDir, 'path.txt')
const binary = existsSync(pathTxt) ? join(electronDir, 'dist', readFileSync(pathTxt, 'utf8').trim()) : null

if (binary && existsSync(binary)) process.exit(0)

console.log('[lyricvideo] Electron binary missing – downloading it now (this happens once)…')
const res = spawnSync(process.execPath, [join(electronDir, 'install.js')], { stdio: 'inherit' })
if (res.status !== 0) {
  console.error('[lyricvideo] Electron download failed. Check your network and run: node node_modules/electron/install.js')
  process.exit(res.status ?? 1)
}
