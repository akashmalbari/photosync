import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import fsSync from 'node:fs'
import express from 'express'
import compression from 'compression'
import dotenv from 'dotenv'
import sharp from 'sharp'
import archiver from 'archiver'
import {
  decodePhotoId,
  fileExists,
  listPhotos,
  mediaTypeFor,
  moveToTrash,
  photoRecord,
  resolveLibraryPath,
  sanitizeNewName,
} from './library.mjs'

dotenv.config()

const app = express()
const port = Number(process.env.PORT || 4173)
const host = process.env.HOST || '0.0.0.0'
const libraryPath = process.env.PHOTO_LIBRARY_PATH ? path.resolve(process.env.PHOTO_LIBRARY_PATH) : null
const password = process.env.LIBRARY_PASSWORD || ''
const authToken = password ? crypto.createHash('sha256').update(`lantern:${password}`).digest('hex') : ''

app.disable('x-powered-by')
app.use(compression())
app.use(express.json({ limit: '1mb' }))
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('Referrer-Policy', 'no-referrer')
  next()
})

function configured(req, res, next) {
  if (!libraryPath) return res.status(503).json({ error: 'Photo folder is not configured. Run npm run setup on the Mac Mini.' })
  next()
}

function authorized(req, res, next) {
  if (!password) return next()
  const cookies = Object.fromEntries(String(req.get('cookie') || '').split(';').map((value) => value.trim().split('=')))
  const supplied = req.get('X-Library-Password')
  if (supplied !== password && cookies.lantern_access !== authToken) {
    return res.status(401).json({ error: 'Library password required' })
  }
  next()
}

function apiError(res, error, fallback = 'That action could not be completed') {
  const known = ['Invalid', 'Enter a', 'File name', 'Keep the', 'already exists', 'not found']
  const message = known.some((prefix) => error.message?.includes(prefix)) ? error.message : fallback
  return res.status(message.includes('not found') ? 404 : 400).json({ error: message })
}

app.get('/api/status', async (_req, res) => {
  let ready = false
  let writable = false
  if (libraryPath) {
    try {
      await fs.access(libraryPath)
      ready = true
      await fs.access(libraryPath, fsSync.constants.W_OK)
      writable = true
    } catch {}
  }
  res.json({
    configured: Boolean(libraryPath), ready, writable,
    libraryName: libraryPath ? path.basename(libraryPath) : null,
    protected: Boolean(password),
    hostName: os.hostname(),
  })
})

app.post('/api/unlock', (req, res) => {
  if (!password || req.body.password === password) {
    res.setHeader('Set-Cookie', `lantern_access=${authToken}; Path=/; HttpOnly; SameSite=Strict; Max-Age=2592000`)
    return res.status(204).end()
  }
  res.status(401).json({ error: 'That password is not correct' })
})

app.post('/api/lock', (_req, res) => {
  res.setHeader('Set-Cookie', 'lantern_access=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0')
  res.status(204).end()
})

app.use(['/api/photos', '/media'], authorized)

app.get('/api/photos', configured, async (req, res) => {
  try {
    const query = String(req.query.search || '').trim().toLocaleLowerCase()
    const sort = ['name', 'size', 'modifiedAt'].includes(req.query.sort) ? req.query.sort : 'modifiedAt'
    const direction = req.query.order === 'asc' ? 1 : -1
    let photos = await listPhotos(libraryPath)
    if (query) photos = photos.filter((photo) => `${photo.name} ${photo.folder}`.toLocaleLowerCase().includes(query))
    photos.sort((a, b) => {
      if (sort === 'name') return a.name.localeCompare(b.name, undefined, { numeric: true }) * direction
      return ((a[sort] > b[sort]) - (a[sort] < b[sort])) * direction
    })
    const totalBytes = photos.reduce((sum, photo) => sum + photo.size, 0)
    res.setHeader('Cache-Control', 'no-store')
    res.json({ photos, total: photos.length, totalBytes })
  } catch (error) {
    apiError(res, error, 'The photo folder could not be read')
  }
})

app.get('/api/photos/:id/thumbnail', configured, async (req, res) => {
  try {
    const relativePath = decodePhotoId(req.params.id)
    const filePath = resolveLibraryPath(libraryPath, relativePath)
    const size = Math.min(Math.max(Number(req.query.size) || 640, 160), 1600)
    const stat = await fs.stat(filePath)
    res.setHeader('Content-Type', 'image/jpeg')
    res.setHeader('Cache-Control', 'private, max-age=86400')
    res.setHeader('ETag', `\"${stat.size}-${stat.mtimeMs}-${size}\"`)
    if (req.get('if-none-match') === `\"${stat.size}-${stat.mtimeMs}-${size}\"`) return res.status(304).end()
    sharp(filePath, { animated: false, limitInputPixels: 100_000_000 })
      .rotate()
      .resize(size, size, { fit: 'inside', withoutEnlargement: true })
      .flatten({ background: '#eee9de' })
      .jpeg({ quality: 82, mozjpeg: true })
      .on('error', () => res.status(422).end())
      .pipe(res)
  } catch (error) {
    apiError(res, error, 'A preview could not be created')
  }
})

app.get('/media/:id', configured, async (req, res) => {
  try {
    const relativePath = decodePhotoId(req.params.id)
    const filePath = resolveLibraryPath(libraryPath, relativePath)
    const fileName = path.basename(relativePath)
    res.type(mediaTypeFor(path.extname(filePath)))
    if (req.query.download === '1') res.attachment(fileName)
    res.sendFile(filePath)
  } catch (error) {
    apiError(res, error, 'The photo could not be opened')
  }
})

app.patch('/api/photos/:id', configured, async (req, res) => {
  try {
    const relativePath = decodePhotoId(req.params.id)
    const source = resolveLibraryPath(libraryPath, relativePath)
    const currentExtension = path.extname(source)
    const nextName = sanitizeNewName(req.body.name, currentExtension)
    const destination = path.join(path.dirname(source), nextName)
    if (destination !== source && await fileExists(destination)) throw new Error('A file with that name already exists')
    await fs.rename(source, destination)
    const stat = await fs.stat(destination)
    res.json({ photo: photoRecord(path.relative(libraryPath, destination), stat) })
  } catch (error) {
    apiError(res, error, 'The photo could not be renamed')
  }
})

app.delete('/api/photos/:id', configured, async (req, res) => {
  try {
    const relativePath = decodePhotoId(req.params.id)
    await moveToTrash(libraryPath, relativePath)
    res.status(204).end()
  } catch (error) {
    apiError(res, error, 'The photo could not be moved to Recently Deleted')
  }
})

app.post('/api/photos/bulk-delete', configured, async (req, res) => {
  const ids = Array.isArray(req.body.ids) ? req.body.ids.slice(0, 500) : []
  if (!ids.length) return res.status(400).json({ error: 'Choose at least one photo' })
  const deleted = []
  const failed = []
  for (const id of ids) {
    try {
      const relativePath = decodePhotoId(id)
      await moveToTrash(libraryPath, relativePath)
      deleted.push(id)
    } catch {
      failed.push(id)
    }
  }
  res.json({ deleted, failed })
})

app.post('/api/photos/download-zip', configured, async (req, res) => {
  const ids = Array.isArray(req.body.ids) ? req.body.ids.slice(0, 500) : []
  if (!ids.length) return res.status(400).json({ error: 'Choose at least one photo' })
  res.attachment(`lantern-photos-${new Date().toISOString().slice(0, 10)}.zip`)
  res.type('application/zip')
  const archive = archiver('zip', { zlib: { level: 5 } })
  archive.on('error', () => res.destroy())
  archive.pipe(res)
  for (const id of ids) {
    try {
      const relativePath = decodePhotoId(id)
      const filePath = resolveLibraryPath(libraryPath, relativePath)
      archive.file(filePath, { name: relativePath })
    } catch {}
  }
  await archive.finalize()
})

if (process.env.NODE_ENV === 'production') {
  const distPath = path.resolve('dist')
  app.use(express.static(distPath, { maxAge: '1h', index: false }))
  app.get('*splat', (_req, res) => res.sendFile(path.join(distPath, 'index.html')))
}

app.listen(port, host, (error) => {
  if (error) {
    console.error(`Lantern Photos could not start: ${error.message}`)
    process.exitCode = 1
    return
  }
  console.log(`\nLantern Photos is ready:`)
  console.log(`  This Mac:     http://localhost:${port}`)
  console.log(`  Home network: http://${os.hostname()}.local:${port}`)
  if (!libraryPath) console.log(`\nRun \"npm run setup\" to choose your photo folder.`)
  else console.log(`  Photo folder: ${libraryPath}`)
})
