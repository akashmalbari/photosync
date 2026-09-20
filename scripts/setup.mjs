import path from 'node:path'
import fs from 'node:fs/promises'
import readline from 'node:readline/promises'
import { stdin as input, stdout as output } from 'node:process'
import dotenv from 'dotenv'

const rl = readline.createInterface({ input, output })

console.log('\nLantern Photos setup')
console.log('Choose up to three folders that hold your photos.')
console.log('Tip: you can drag a folder from Finder into this window.\n')

function cleanAnswer(answer) {
  return answer.trim().replace(/^['"]|['"]$/g, '').replace(/\\ /g, ' ')
}

async function chooseFolder(number, optional = false) {
  const label = optional ? `Photo folder ${number} (optional — press Return to finish): ` : 'Photo folder 1: '
  const answer = cleanAnswer(await rl.question(label))
  if (!answer && optional) return null
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
    console.error(`\nPlease choose a folder, not a file: ${folder}`)
    process.exit(1)
  }
  return folder
}

const folders = []
for (let number = 1; number <= 3; number += 1) {
  const folder = await chooseFolder(number, number > 1)
  if (!folder) break
  if (folders.includes(folder)) {
    console.error(`\nThat folder was already selected: ${folder}`)
    process.exit(1)
  }
  folders.push(folder)
}
rl.close()

let existing = {}
try {
  existing = dotenv.parse(await fs.readFile('.env'))
} catch {}

const quote = (value) => JSON.stringify(String(value))
const lines = folders.map((folder, index) => `${index === 0 ? 'PHOTO_LIBRARY_PATH' : `PHOTO_LIBRARY_PATH_${index + 1}`}=${quote(folder)}`)
folders.forEach((_folder, index) => {
  const nameKey = index === 0 ? 'PHOTO_LIBRARY_NAME' : `PHOTO_LIBRARY_NAME_${index + 1}`
  if (existing[nameKey]) lines.push(`${nameKey}=${quote(existing[nameKey])}`)
})
lines.push(`PORT=${existing.PORT || 4173}`)
lines.push(`HOST=${existing.HOST || '0.0.0.0'}`)
if (existing.LIBRARY_PASSWORD) lines.push(`LIBRARY_PASSWORD=${quote(existing.LIBRARY_PASSWORD)}`)

await fs.writeFile('.env', `${lines.join('\n')}\n`, { mode: 0o600 })
console.log('\nReady. Lantern Photos will use:')
folders.forEach((folder, index) => console.log(`  ${index + 1}. ${folder}`))
console.log('\nNext: run "npm run build" and then "npm start".\n')
