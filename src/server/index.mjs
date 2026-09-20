import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import fsSync from 'node:fs'
import { Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import express from 'express'
import compression from 'compression'
import dotenv from 'dotenv'
import sharp from 'sharp'
import archiver from 'archiver'
import {
  decodePhotoId,
  findPhotoByHash,
  fileExists,
  IMAGE_EXTENSIONS,
  localNetworkHostName,
  listPhotos,
  mediaTypeFor,
  moveToTrash,
  photoRecord,
  readSyncIndex,
  resolveLibraryPath,
  sanitizeNewName,
  sanitizeUploadName,
  syncAssetKey,
  uniqueFilePath,
  writeSyncIndex,
} from './library.mjs'

dotenv.config()

const app = express()
const port = Number(process.env.PORT || 4173)
const host = process.env.HOST || '0.0.0.0'
const libraryPath = process.env.PHOTO_LIBRARY_PATH ? path.resolve(process.env.PHOTO_LIBRARY_PATH) : null
const password = process.env.LIBRARY_PASSWORD || ''
const authToken = password ? crypto.createHash('sha256').update(`lantern:${password}`).digest('hex') : ''
const networkHostName = localNetworkHostName(os.hostname())
const syncFolder = process.env.SYNC_FOLDER || 'iPhone Uploads'
const maxUploadBytes = Math.max(10, Number(process.env.MAX_UPLOAD_MB || 500)) * 1024 * 1024
let syncIndexQueue = Promise.resolve()

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
  const known = ['Invalid', 'Enter a', 'File name', 'Keep the', 'Unsupported', 'Upload', 'Sync', 'already exists', 'not found']
  const message = known.some((prefix) => error.message?.includes(prefix)) ? error.message : fallback
  return res.status(error.statusCode || (message.includes('not found') ? 404 : 400)).json({ error: message })
}

function withSyncIndex(operation) {
  const result = syncIndexQueue.then(operation, operation)
  syncIndexQueue = result.catch(() => {})
  return result
}

function requireText(value, label, maxLength = 500) {
  const text = String(value || '').trim()
  if (!text || text.length > maxLength || text.includes('\0')) throw new Error(`Invalid ${label}`)
  return text
}

function validateDigest(value) {
  const digest = String(value || '').toLowerCase()
  if (!/^[a-f0-9]{64}$/.test(digest)) throw new Error('Invalid photo fingerprint')
  return digest
}

function uploadFolderFor(createdAt) {
  const date = new Date(createdAt)
  const safeDate = Number.isNaN(date.getTime()) ? new Date() : date
  const year = String(safeDate.getUTCFullYear())
  const month = String(safeDate.getUTCMonth() + 1).padStart(2, '0')
  return resolveLibraryPath(libraryPath, path.join(syncFolder, year, month))
}

function syncRecord({ deviceId, assetId, assetVersion, relativePath, digest, size, createdAt }) {
  return {
    deviceId, assetId, assetVersion, path: relativePath, hash: digest, size,
    createdAt: createdAt || null,
    syncedAt: new Date().toISOString(),
  }
}

async function registerSyncedAsset(details, photo) {
  await withSyncIndex(async () => {
    const index = await readSyncIndex(libraryPath)
    index.assets[syncAssetKey(details.deviceId, details.assetId)] = syncRecord({
      ...details,
      relativePath: photo.path,
      size: photo.size,
    })
    await writeSyncIndex(libraryPath, index)
  })
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
    hostName: networkHostName,
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

app.use(['/api/photos', '/api/sync', '/media'], authorized)

app.get('/api/sync/status', configured, async (_req, res) => {
  try {
    const index = await readSyncIndex(libraryPath)
    res.json({
      ready: true,
      indexedAssets: Object.keys(index.assets).length,
      destination: syncFolder,
      maxUploadBytes,
    })
  } catch (error) {
    apiError(res, error, 'Sync status could not be read')
  }
})

app.post('/api/sync/check', configured, async (req, res) => {
  try {
    const deviceId = requireText(req.body.deviceId, 'device identifier', 120)
    const assets = Array.isArray(req.body.assets) ? req.body.assets.slice(0, 500) : []
    if (!assets.length) return res.json({ missing: [] })
    const index = await readSyncIndex(libraryPath)
    const missing = []
    for (const asset of assets) {
      const assetId = requireText(asset.assetId, 'asset identifier')
      const assetVersion = requireText(asset.assetVersion, 'asset version', 120)
      const existing = index.assets[syncAssetKey(deviceId, assetId)]
      let isCurrent = false
      if (existing && existing.assetVersion === assetVersion) {
        try {
          const stat = await fs.stat(resolveLibraryPath(libraryPath, existing.path))
          isCurrent = stat.size === existing.size
        } catch {}
      }
      if (!isCurrent) {
        missing.push(assetId)
      }
    }
    res.json({ missing })
  } catch (error) {
    apiError(res, error, 'The sync comparison could not be completed')
  }
})

app.post('/api/sync/content-check', configured, async (req, res) => {
  try {
    const deviceId = requireText(req.body.deviceId, 'device identifier', 120)
    const assetId = requireText(req.body.assetId, 'asset identifier')
    const assetVersion = requireText(req.body.assetVersion, 'asset version', 120)
    const digest = validateDigest(req.body.hash)
    const size = Number(req.body.size)
    if (!Number.isSafeInteger(size) || size <= 0 || size > maxUploadBytes) throw new Error('Invalid photo size')
    const duplicate = await findPhotoByHash(libraryPath, digest, size)
    if (!duplicate) return res.json({ needed: true })
    await registerSyncedAsset({ deviceId, assetId, assetVersion, digest, createdAt: req.body.createdAt }, duplicate)
    res.json({ needed: false, status: 'already-present', photo: duplicate })
  } catch (error) {
    apiError(res, error, 'The photo could not be compared with the library')
  }
})

app.post('/api/sync/upload', configured, async (req, res) => {
  let temporaryPath = ''
  try {
    const deviceId = requireText(req.get('X-Device-ID'), 'device identifier', 120)
    const assetId = decodeURIComponent(requireText(req.get('X-Asset-ID'), 'asset identifier'))
    const assetVersion = requireText(req.get('X-Asset-Version'), 'asset version', 120)
    const expectedDigest = validateDigest(req.get('X-Photo-SHA256'))
    const createdAt = req.get('X-Created-At') || ''
    const rawName = decodeURIComponent(requireText(req.get('X-File-Name'), 'file name', 700))
    const fileName = sanitizeUploadName(rawName)
    const declaredSize = Number(req.get('content-length'))
    if (Number.isFinite(declaredSize) && declaredSize > maxUploadBytes) {
      const error = new Error(`Upload exceeds the ${Math.round(maxUploadBytes / 1024 / 1024)} MB limit`)
      error.statusCode = 413
      throw error
    }

    const temporaryFolder = path.join(libraryPath, '.lantern-uploading')
    await fs.mkdir(temporaryFolder, { recursive: true })
    temporaryPath = path.join(temporaryFolder, `${crypto.randomUUID()}${path.extname(fileName).toLowerCase()}`)
    const hash = crypto.createHash('sha256')
    let received = 0
    const meter = new Transform({
      transform(chunk, _encoding, callback) {
        received += chunk.length
        if (received > maxUploadBytes) return callback(new Error(`Upload exceeds the ${Math.round(maxUploadBytes / 1024 / 1024)} MB limit`))
        hash.update(chunk)
        callback(null, chunk)
      },
    })
    await pipeline(req, meter, fsSync.createWriteStream(temporaryPath, { flags: 'wx', mode: 0o600 }))
    if (!received) throw new Error('Upload was empty')
    const digest = hash.digest('hex')
    if (digest !== expectedDigest) throw new Error('Upload fingerprint did not match')

    const metadata = await sharp(temporaryPath, { animated: false, limitInputPixels: 150_000_000 }).metadata()
    if (!metadata.format || !IMAGE_EXTENSIONS.has(path.extname(fileName).toLowerCase())) throw new Error('Unsupported image format')

    const duplicate = await findPhotoByHash(libraryPath, digest, received)
    if (duplicate) {
      await fs.rm(temporaryPath, { force: true })
      temporaryPath = ''
      await registerSyncedAsset({ deviceId, assetId, assetVersion, digest, createdAt }, duplicate)
      return res.json({ status: 'already-present', photo: duplicate })
    }

    const key = syncAssetKey(deviceId, assetId)
    const index = await readSyncIndex(libraryPath)
    const previous = index.assets[key]
    const destinationFolder = uploadFolderFor(createdAt)
    await fs.mkdir(destinationFolder, { recursive: true })
    let destination
    if (previous?.path && path.extname(previous.path).toLowerCase() === path.extname(fileName).toLowerCase()) {
      const previousPath = resolveLibraryPath(libraryPath, previous.path)
      const sharedByAnotherAsset = Object.entries(index.assets).some(([otherKey, record]) => otherKey !== key && record.path === previous.path)
      if (!sharedByAnotherAsset && await fileExists(previousPath)) {
        await moveToTrash(libraryPath, previous.path)
        destination = previousPath
      }
    }
    destination ||= await uniqueFilePath(destinationFolder, fileName)
    await fs.rename(temporaryPath, destination)
    temporaryPath = ''
    const captureDate = new Date(createdAt)
    if (!Number.isNaN(captureDate.getTime())) await fs.utimes(destination, captureDate, captureDate)
    const stat = await fs.stat(destination)
    const photo = photoRecord(path.relative(libraryPath, destination), stat)
    await registerSyncedAsset({ deviceId, assetId, assetVersion, digest, createdAt }, photo)
    res.status(201).json({ status: previous ? 'updated' : 'uploaded', photo })
  } catch (error) {
    if (temporaryPath) await fs.rm(temporaryPath, { force: true }).catch(() => {})
    apiError(res, error, 'The photo could not be synced')
  }
})

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
  console.log(`  Home network: http://${networkHostName}:${port}`)
  if (!libraryPath) console.log(`\nRun \"npm run setup\" to choose your photo folder.`)
  else console.log(`  Photo folder: ${libraryPath}`)
})
