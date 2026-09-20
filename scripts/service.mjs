import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

if (process.platform !== 'darwin') {
  console.error('The background service helper is for macOS only.')
  process.exit(1)
}

const action = process.argv[2]
const label = 'com.lantern.photos'
const agentsFolder = path.join(os.homedir(), 'Library', 'LaunchAgents')
const plistPath = path.join(agentsFolder, `${label}.plist`)
const projectPath = process.cwd()
const nodePath = process.execPath
const logPath = path.join(os.homedir(), 'Library', 'Logs', 'Lantern Photos.log')
const domain = `gui/${process.getuid()}`

function launchctl(...args) {
  return spawnSync('/bin/launchctl', args, { stdio: 'ignore' })
}

function xmlEscape(value) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}

if (action === 'remove') {
  launchctl('bootout', domain, plistPath)
  await fs.rm(plistPath, { force: true })
  console.log('\nLantern Photos will no longer start automatically.\n')
  process.exit(0)
}

if (action !== 'install') {
  console.error('Use: npm run service:install or npm run service:remove')
  process.exit(1)
}

try {
  await fs.access(path.join(projectPath, '.env'))
  await fs.access(path.join(projectPath, 'dist', 'index.html'))
} catch {
  console.error('\nFinish setup and build the app first: npm run setup && npm run build\n')
  process.exit(1)
}

await fs.mkdir(agentsFolder, { recursive: true })
const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${label}</string>
  <key>ProgramArguments</key>
  <array><string>${xmlEscape(nodePath)}</string><string>${xmlEscape(path.join(projectPath, 'src', 'server', 'index.mjs'))}</string></array>
  <key>WorkingDirectory</key><string>${xmlEscape(projectPath)}</string>
  <key>EnvironmentVariables</key><dict><key>NODE_ENV</key><string>production</string></dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>StandardOutPath</key><string>${xmlEscape(logPath)}</string>
  <key>StandardErrorPath</key><string>${xmlEscape(logPath)}</string>
</dict>
</plist>
`

launchctl('bootout', domain, plistPath)
await fs.writeFile(plistPath, plist, { mode: 0o644 })
const loaded = launchctl('bootstrap', domain, plistPath)
if (loaded.status !== 0) {
  console.error(`\nThe service could not be started. You can still use "npm start".\n`)
  process.exit(1)
}
launchctl('kickstart', '-k', `${domain}/${label}`)
console.log('\nLantern Photos is now running and will start when you log in.\n')
