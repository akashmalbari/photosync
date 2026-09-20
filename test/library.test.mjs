import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
  decodePhotoId, encodePhotoId, findPhotoByHash, hashFile, isInside, localNetworkHostName,
  readSyncIndex, resolveLibraryPath, sanitizeNewName, sanitizeUploadName, syncAssetKey,
  uniqueFilePath, writeSyncIndex,
} from '../src/server/library.mjs'

test('photo IDs round-trip unicode paths', () => {
  const value = 'Trips/José/IMG 001.jpg'
  assert.equal(decodePhotoId(encodePhotoId(value)), value)
})

test('library paths cannot escape the configured folder', () => {
  const root = path.resolve('/tmp/photos')
  assert.equal(resolveLibraryPath(root, 'Trips/photo.jpg'), path.join(root, 'Trips/photo.jpg'))
  assert.throws(() => resolveLibraryPath(root, '../private.jpg'), /outside the library/)
  assert.equal(isInside(root, path.join(root, 'nested')), true)
  assert.equal(isInside(root, path.resolve('/tmp/photos-copy')), false)
})

test('renaming keeps the original extension', () => {
  assert.equal(sanitizeNewName('Summer day', '.jpg'), 'Summer day.jpg')
  assert.equal(sanitizeNewName('Summer day.JPG', '.jpg'), 'Summer day.JPG')
  assert.throws(() => sanitizeNewName('Summer day.png', '.jpg'), /Keep the .jpg/)
  assert.throws(() => sanitizeNewName('../photo', '.jpg'), /cannot contain/)
  assert.throws(() => sanitizeNewName('.hidden', '.jpg'), /cannot start/)
})

test('local network hostname has exactly one .local suffix', () => {
  assert.equal(localNetworkHostName('akashs-mac-mini'), 'akashs-mac-mini.local')
  assert.equal(localNetworkHostName('akashs-mac-mini.local'), 'akashs-mac-mini.local')
  assert.equal(localNetworkHostName('akashs-mac-mini.local.local'), 'akashs-mac-mini.local')
})

test('phone upload names only allow supported image formats', () => {
  assert.equal(sanitizeUploadName('IMG_1234.HEIC'), 'IMG_1234.HEIC')
  assert.throws(() => sanitizeUploadName('notes.pdf'), /Unsupported image format/)
  assert.throws(() => sanitizeUploadName('../IMG_1234.jpg'), /cannot contain/)
})

test('sync helpers find identical photos and persist their index', async (context) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'lantern-sync-test-'))
  context.after(() => fs.rm(root, { recursive: true, force: true }))
  const original = path.join(root, 'IMG_0001.jpg')
  await fs.writeFile(original, 'same-photo-bytes')
  const stat = await fs.stat(original)
  const digest = await hashFile(original)
  const match = await findPhotoByHash(root, digest, stat.size)
  assert.equal(match.name, 'IMG_0001.jpg')

  const unique = await uniqueFilePath(root, 'IMG_0001.jpg')
  assert.equal(path.basename(unique), 'IMG_0001 (2).jpg')

  const index = await readSyncIndex(root)
  const key = syncAssetKey('phone-1', 'asset-1')
  index.assets[key] = { assetVersion: '1', path: match.path }
  await writeSyncIndex(root, index)
  assert.equal((await readSyncIndex(root)).assets[key].path, 'IMG_0001.jpg')
})
