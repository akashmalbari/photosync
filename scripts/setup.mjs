import path from 'node:path'
import fs from 'node:fs/promises'
import readline from 'node:readline/promises'
import { stdin as input, stdout as output } from 'node:process'

const rl = readline.createInterface({ input, output })

console.log('\nLantern Photos setup')
console.log('Choose the folder that holds your photo library.')
console.log('Tip: you can drag a folder from Finder into this window.\n')

let answer = await rl.question('Photo folder: ')
rl.close()
answer = answer.trim().replace(/^['"]|['"]$/g, '').replace(/\\ /g, ' ')

if (!answer) {
  console.error('\nNo folder was selected. Nothing changed.')
  process.exit(1)
}

const folder = path.resolve(answer)
let stat
try {
  stat = await fs.stat(folder)
} catch {
  console.error(`\nThat folder does not exist: ${folder}`)
  process.exit(1)
}

if (!stat.isDirectory()) {
  console.error('\nPlease choose a folder, not a file.')
  process.exit(1)
}

const escaped = folder.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
await fs.writeFile('.env', `PHOTO_LIBRARY_PATH="${escaped}"\nPORT=4173\nHOST=0.0.0.0\n`, { mode: 0o600 })
console.log(`\nReady. Lantern Photos will use:\n${folder}`)
console.log('\nNext: run "npm run build" and then "npm start".\n')
