import fs from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'

export const IMAGE_EXTENSIONS = new Set([
  '.jpg', '.jpeg', '.png', '.webp', '.gif', '.avif', '.heic', '.heif', '.tif', '.tiff',
])

export const TRASH_FOLDER = '.photo-vault-trash'
export const SYNC_INDEX_FILE = '.lantern-sync-index.json'

export function localNetworkHostName(hostName) {
  const base = String(hostName || 'localhost').replace(/(?:\.local)+\.?$/i, '')
  return `${base}.local`
}

export function encodePhotoId(relativePath) {
  return Buffer.from(relativePath, 'utf8').toString('base64url')
}

export function decodePhotoId(id) {
  try {
    return Buffer.from(id, 'base64url').toString('utf8')
  } catch {
    throw new Error('Invalid photo identifier')
  }
}

export function isInside(root, candidate) {
  const relative = path.relative(root, candidate)
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
}

export function resolveLibraryPath(root, relativePath) {
  if (!relativePath || path.isAbsolute(relativePath) || relativePath.includes('\0')) {
    throw new Error('Invalid photo path')
  }
  const resolvedRoot = path.resolve(root)
  const resolved = path.resolve(resolvedRoot, relativePath)
  if (!isInside(resolvedRoot, resolved)) throw new Error('Photo path is outside the library')
  return resolved
}

export function sanitizeNewName(rawName, currentExtension = '') {
  const name = String(rawName ?? '').trim().normalize('NFC')
  if (!name || name === '.' || name === '..') throw new Error('Enter a file name')
  if (name.length > 220) throw new Error('File name is too long')
  if (/[\0/\\:]/.test(name)) throw new Error('File name cannot contain /, \\, or :')
  if (name.startsWith('.')) throw new Error('File name cannot start with a dot')

  const suppliedExtension = path.extname(name)
  if (!suppliedExtension && currentExtension) return `${name}${currentExtension}`
  if (currentExtension && suppliedExtension.toLowerCase() !== currentExtension.toLowerCase()) {
    throw new Error(`Keep the ${currentExtension} file extension`)
  }
  return name
}

export function sanitizeUploadName(rawName) {
  const name = sanitizeNewName(rawName)
  const extension = path.extname(name).toLowerCase()
  if (!IMAGE_EXTENSIONS.has(extension)) throw new Error('Unsupported image format')
  return name
}

export function mediaTypeFor(extension) {
  const types = {
    '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp',
    '.gif': 'image/gif', '.avif': 'image/avif', '.heic': 'image/heic', '.heif': 'image/heif',
    '.tif': 'image/tiff', '.tiff': 'image/tiff',
  }
  return types[extension.toLowerCase()] || 'application/octet-stream'
}

async function walk(folder, root, items, includeTrash = false) {
  const entries = await fs.readdir(folder, { withFileTypes: true })
  for (const entry of entries) {
    if (entry.name.startsWith('.') && (!includeTrash || entry.name !== TRASH_FOLDER)) continue
    const fullPath = path.join(folder, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === TRASH_FOLDER && !includeTrash) continue
      await walk(fullPath, root, items, includeTrash)
      continue
    }
    if (!entry.isFile() || !IMAGE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) continue
    const stat = await fs.stat(fullPath)
    const relativePath = path.relative(root, fullPath)
    items.push(photoRecord(relativePath, stat))
  }
}

export function photoRecord(relativePath, stat) {
  const name = path.basename(relativePath)
  const folder = path.dirname(relativePath)
  return {
    id: encodePhotoId(relativePath),
    name,
    path: relativePath,
    folder: folder === '.' ? '' : folder,
    extension: path.extname(name).slice(1).toUpperCase(),
    size: stat.size,
    modifiedAt: stat.mtime.toISOString(),
  }
}

export async function listPhotos(root) {
  const items = []
  await walk(root, root, items)
  return items
}

export function uniqueTrashName(relativePath) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const token = crypto.randomBytes(3).toString('hex')
  return `${stamp}__${token}__${path.basename(relativePath)}`
}

export async function moveToTrash(root, relativePath) {
  const source = resolveLibraryPath(root, relativePath)
  const trash = path.join(root, TRASH_FOLDER)
  await fs.mkdir(trash, { recursive: true })
  const destination = path.join(trash, uniqueTrashName(relativePath))
  await fs.rename(source, destination)
  return destination
}

export async function fileExists(filePath) {
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}

export async function hashFile(filePath) {
  const hash = crypto.createHash('sha256')
  const handle = await fs.open(filePath, 'r')
  try {
    for await (const chunk of handle.createReadStream()) hash.update(chunk)
    return hash.digest('hex')
  } finally {
    await handle.close().catch(() => {})
  }
}

export async function findPhotoByHash(root, digest, size, excludeRelativePath = '') {
  const photos = await listPhotos(root)
  for (const photo of photos) {
    if (photo.path === excludeRelativePath || photo.size !== size) continue
    const candidate = resolveLibraryPath(root, photo.path)
    if (await hashFile(candidate) === digest) return photo
  }
  return null
}

export async function uniqueFilePath(folder, fileName) {
  const extension = path.extname(fileName)
  const stem = path.basename(fileName, extension)
  let candidate = path.join(folder, fileName)
  let copy = 2
  while (await fileExists(candidate)) {
    candidate = path.join(folder, `${stem} (${copy})${extension}`)
    copy += 1
  }
  return candidate
}

export function syncAssetKey(deviceId, assetId) {
  return crypto.createHash('sha256').update(`${deviceId}\0${assetId}`).digest('hex')
}

export async function readSyncIndex(root) {
  const indexPath = path.join(root, SYNC_INDEX_FILE)
  try {
    const parsed = JSON.parse(await fs.readFile(indexPath, 'utf8'))
    if (!parsed || parsed.version !== 1 || typeof parsed.assets !== 'object') throw new Error('Invalid sync index')
    return parsed
  } catch (error) {
    if (error.code === 'ENOENT') return { version: 1, assets: {} }
    throw new Error('Sync index could not be read')
  }
}

export async function writeSyncIndex(root, index) {
  const destination = path.join(root, SYNC_INDEX_FILE)
  const temporary = path.join(root, `${SYNC_INDEX_FILE}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`)
  await fs.writeFile(temporary, `${JSON.stringify(index, null, 2)}\n`, { mode: 0o600 })
  await fs.rename(temporary, destination)
}
