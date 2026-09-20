import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { decodePhotoId, encodePhotoId, isInside, librariesFromEnvironment, localNetworkHostName, resolveLibraryPath, sanitizeNewName } from '../src/server/library.mjs'

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

test('photo sources are ordered, named, and de-duplicated', () => {
  const libraries = librariesFromEnvironment({
    PHOTO_LIBRARY_PATH_3: '/Volumes/Archive',
    PHOTO_LIBRARY_PATH: '/Users/example/Pictures',
    PHOTO_LIBRARY_NAME: 'Current photos',
    PHOTO_LIBRARY_PATH_2: '/Users/example/Pictures',
  })
  assert.deepEqual(libraries, [
    { id: 'source-1', name: 'Current photos', path: path.resolve('/Users/example/Pictures') },
    { id: 'source-3', name: 'Archive', path: path.resolve('/Volumes/Archive') },
  ])
})
