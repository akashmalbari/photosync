import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ArchiveRestore, ArrowDownToLine, Check, CheckCircle2, ChevronDown, Download,
  Folder, FolderOpen, HardDrive, Image as ImageIcon, Info, LayoutGrid, LoaderCircle,
  LockKeyhole, Menu, MoreHorizontal, Pencil, RefreshCw, Search, ShieldCheck,
  SlidersHorizontal, Trash2, X,
} from 'lucide-react'

const SORTS = [
  { value: 'modifiedAt:desc', label: 'Newest first' },
  { value: 'modifiedAt:asc', label: 'Oldest first' },
  { value: 'name:asc', label: 'Name A–Z' },
  { value: 'name:desc', label: 'Name Z–A' },
  { value: 'size:desc', label: 'Largest first' },
]

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const unit = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  return `${(bytes / (1024 ** unit)).toFixed(unit > 1 ? 1 : 0)} ${units[unit]}`
}

function formatDate(value, detail = false) {
  return new Intl.DateTimeFormat(undefined, detail
    ? { month: 'long', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }
    : { month: 'short', day: 'numeric', year: 'numeric' }
  ).format(new Date(value))
}

function libraryQuery(libraryId) {
  return `library=${encodeURIComponent(libraryId || '')}`
}

function thumbnailUrl(photo) {
  return `/api/photos/${photo.id}/thumbnail?size=720&${libraryQuery(photo.libraryId)}`
}

function mediaUrl(photo, download = false) {
  return `/media/${photo.id}?${download ? 'download=1&' : ''}${libraryQuery(photo.libraryId)}`
}

async function request(url, options) {
  const response = await fetch(url, options)
  if (!response.ok) {
    const body = await response.json().catch(() => ({}))
    const error = new Error(body.error || 'Something went wrong')
    error.status = response.status
    throw error
  }
  if (response.status === 204) return null
  return response
}

function Brand({ compact = false }) {
  return (
    <div className={`brand ${compact ? 'brand--compact' : ''}`}>
      <span className="brand__mark"><span /></span>
      <span>
        <strong>Lantern</strong>
        {!compact && <small>PHOTOS</small>}
      </span>
    </div>
  )
}

function Sidebar({ status, activeLibraryId, onSelectLibrary }) {
  const libraries = status?.libraries || []
  return (
    <aside className="sidebar">
      <Brand />
      <nav className="sidebar__nav" aria-label="Library navigation">
        <button className="nav-item nav-item--active"><LayoutGrid size={18} /> All photos <span>{String(libraries.length || 1).padStart(2, '0')}</span></button>
        <button className="nav-item" disabled title="Coming in a future update"><Folder size={18} /> Albums</button>
        <button className="nav-item" disabled title="Open the hidden trash folder on your Mac to recover files"><ArchiveRestore size={18} /> Recently deleted</button>
      </nav>
      <div className="sidebar__rule" />
      <div className="source-block">
        <p className="eyebrow">SOURCES</p>
        <div className="source-block__list">
          {libraries.length ? libraries.map((library) => (
            <button key={library.id} className={`source-block__row ${library.id === activeLibraryId ? 'source-block__row--active' : ''}`} onClick={() => onSelectLibrary(library.id)}>
              <span className="source-block__icon"><HardDrive size={17} /></span>
              <span><strong>{library.name}</strong><small>{library.ready ? 'This Mac Mini' : 'Folder unavailable'}</small></span>
              {library.ready && <CheckCircle2 size={16} className="source-block__check" />}
            </button>
          )) : (
            <div className="source-block__row">
              <span className="source-block__icon"><HardDrive size={17} /></span>
              <span><strong>Not configured</strong><small>Run setup</small></span>
            </div>
          )}
        </div>
      </div>
      <div className="privacy-note">
        <ShieldCheck size={18} />
        <span><strong>Stays at home</strong><small>Your originals never leave this Mac.</small></span>
      </div>
      <p className="sidebar__foot">LANTERN v0.2</p>
    </aside>
  )
}

function TopBar({ status, search, setSearch, onRefresh, refreshing, onSelectAll, hasPhotos }) {
  const [mobileSearch, setMobileSearch] = useState(false)
  return (
    <>
      <header className="topbar">
        <div className="mobile-brand"><Brand compact /></div>
        <div className={`search-box ${mobileSearch ? 'search-box--mobile-open' : ''}`}>
          <Search size={17} />
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search photos" aria-label="Search photos" />
          {search && <button onClick={() => setSearch('')} aria-label="Clear search"><X size={15} /></button>}
        </div>
        <div className="topbar__actions">
          <button className="icon-button mobile-search-button" onClick={() => setMobileSearch((value) => !value)} aria-label="Search"><Search size={19} /></button>
          <button className="text-button" onClick={onSelectAll} disabled={!hasPhotos}><Check size={16} /> Select</button>
          <button className="icon-button" onClick={onRefresh} disabled={refreshing} aria-label="Refresh library" title="Refresh library">
            <RefreshCw size={18} className={refreshing ? 'spin' : ''} />
          </button>
          <span className="connection-pill"><i /> {status?.hostName || 'Mac Mini'}</span>
        </div>
      </header>
    </>
  )
}

function PhotoCard({ photo, selected, selectionMode, onSelect, onOpen, onRename, onDelete, onDownload }) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [failed, setFailed] = useState(false)
  return (
    <article className={`photo-card ${selected ? 'photo-card--selected' : ''}`}>
      <button className="photo-card__image" onClick={() => selectionMode ? onSelect(photo.id) : onOpen(photo)} aria-label={selectionMode ? `Select ${photo.name}` : `Open ${photo.name}`}>
        {!loaded && !failed && <span className="image-skeleton" />}
        {failed ? <span className="image-fallback"><ImageIcon size={30} /><small>Preview unavailable</small></span> : (
          <img src={thumbnailUrl(photo)} alt="" loading="lazy" onLoad={() => setLoaded(true)} onError={() => setFailed(true)} />
        )}
        <span className={`select-control ${selected ? 'select-control--checked' : ''}`} onClick={(event) => { event.stopPropagation(); onSelect(photo.id) }} role="checkbox" aria-checked={selected} tabIndex="0">
          {selected && <Check size={14} strokeWidth={3} />}
        </span>
        <span className="photo-card__shade" />
        <span className="photo-card__date">{formatDate(photo.modifiedAt)}</span>
      </button>
      <div className="photo-card__meta">
        <span className="photo-card__name" title={photo.name}>{photo.name}</span>
        <button className="card-menu-button" onClick={() => setMenuOpen((value) => !value)} aria-label={`Actions for ${photo.name}`}><MoreHorizontal size={18} /></button>
        {menuOpen && (
          <>
            <button className="menu-backdrop" onClick={() => setMenuOpen(false)} aria-label="Close menu" />
            <div className="card-menu">
              <button onClick={() => { onDownload(photo); setMenuOpen(false) }}><Download size={15} /> Download</button>
              <button onClick={() => { onRename(photo); setMenuOpen(false) }}><Pencil size={15} /> Rename</button>
              <button className="danger" onClick={() => { onDelete(photo); setMenuOpen(false) }}><Trash2 size={15} /> Delete</button>
            </div>
          </>
        )}
      </div>
    </article>
  )
}

function Gallery({ photos, selected, setSelected, onOpen, onRename, onDelete, onDownload }) {
  const selectionMode = selected.size > 0
  const toggle = (id) => setSelected((current) => {
    const next = new Set(current)
    next.has(id) ? next.delete(id) : next.add(id)
    return next
  })
  return (
    <div className="gallery">
      {photos.map((photo) => (
        <PhotoCard key={photo.id} photo={photo} selected={selected.has(photo.id)} selectionMode={selectionMode}
          onSelect={toggle} onOpen={onOpen} onRename={onRename} onDelete={onDelete} onDownload={onDownload} />
      ))}
    </div>
  )
}

function EmptyState({ configured, ready, searching }) {
  return (
    <div className="empty-state">
      <div className="empty-state__art"><FolderOpen size={42} /><span /></div>
      <h2>{searching ? 'No photos found' : configured && ready ? 'This library is ready' : 'Choose your photo folder'}</h2>
      <p>{searching
        ? 'Try a different name or clear your search.'
        : configured && ready
          ? 'Drop photos into the folder on your Mac Mini, then refresh this page.'
          : 'Run “npm run setup” on your Mac Mini to connect a folder.'}</p>
    </div>
  )
}

function DetailPanel({ photo, onClose, onRename, onDelete, onPrevious, onNext }) {
  useEffect(() => {
    const keydown = (event) => {
      if (event.key === 'Escape') onClose()
      if (event.key === 'ArrowLeft') onPrevious()
      if (event.key === 'ArrowRight') onNext()
    }
    window.addEventListener('keydown', keydown)
    return () => window.removeEventListener('keydown', keydown)
  }, [onClose, onNext, onPrevious])
  if (!photo) return null
  return (
    <div className="viewer" role="dialog" aria-modal="true" aria-label={`Viewing ${photo.name}`}>
      <div className="viewer__top">
        <button className="viewer__close" onClick={onClose}><X size={20} /> Close</button>
        <p>{photo.name}</p>
        <a className="viewer__download" href={mediaUrl(photo, true)}><Download size={18} /><span>Download</span></a>
      </div>
      <div className="viewer__stage">
        <button className="viewer__previous" onClick={onPrevious} aria-label="Previous photo">‹</button>
        <img src={mediaUrl(photo)} alt={photo.name} />
        <button className="viewer__next" onClick={onNext} aria-label="Next photo">›</button>
      </div>
      <aside className="viewer__info">
        <div className="viewer__info-title"><span><Info size={16} /> Details</span><button onClick={onClose}><X size={18} /></button></div>
        <h2>{photo.name}</h2>
        <dl>
          <div><dt>Added</dt><dd>{formatDate(photo.modifiedAt, true)}</dd></div>
          <div><dt>Size</dt><dd>{formatBytes(photo.size)}</dd></div>
          <div><dt>Format</dt><dd>{photo.extension}</dd></div>
          <div><dt>Folder</dt><dd>{photo.folder || 'Library root'}</dd></div>
        </dl>
        <div className="viewer__info-actions">
          <button onClick={() => onRename(photo)}><Pencil size={16} /> Rename</button>
          <button className="danger" onClick={() => onDelete(photo)}><Trash2 size={16} /> Delete</button>
        </div>
      </aside>
    </div>
  )
}

function RenameDialog({ photo, onClose, onSave }) {
  const stem = photo.name.slice(0, photo.name.length - (`.${photo.extension}`.length))
  const [name, setName] = useState(stem)
  const [saving, setSaving] = useState(false)
  const input = useRef(null)
  useEffect(() => { input.current?.select() }, [])
  const submit = async (event) => {
    event.preventDefault()
    setSaving(true)
    try { await onSave(photo, name) } finally { setSaving(false) }
  }
  return (
    <div className="modal-wrap" role="dialog" aria-modal="true" aria-labelledby="rename-title">
      <button className="modal-backdrop" onClick={onClose} aria-label="Close" />
      <form className="modal" onSubmit={submit}>
        <div className="modal__icon"><Pencil size={20} /></div>
        <h2 id="rename-title">Rename photo</h2>
        <p>Give this photo a name that will be easy to find later.</p>
        <label>File name</label>
        <div className="filename-input"><input ref={input} value={name} onChange={(event) => setName(event.target.value)} required /><span>.{photo.extension.toLowerCase()}</span></div>
        <div className="modal__actions"><button type="button" onClick={onClose}>Cancel</button><button className="primary" disabled={saving || !name.trim()}>{saving ? 'Saving…' : 'Save name'}</button></div>
      </form>
    </div>
  )
}

function DeleteDialog({ photos, onClose, onConfirm }) {
  const [deleting, setDeleting] = useState(false)
  const plural = photos.length > 1
  return (
    <div className="modal-wrap" role="dialog" aria-modal="true" aria-labelledby="delete-title">
      <button className="modal-backdrop" onClick={onClose} aria-label="Close" />
      <div className="modal">
        <div className="modal__icon modal__icon--danger"><Trash2 size={21} /></div>
        <h2 id="delete-title">Delete {plural ? `${photos.length} photos` : 'this photo'}?</h2>
        <p>{plural ? 'They' : <><strong>{photos[0]?.name}</strong> will be</>} moved to a hidden “Recently Deleted” folder on your Mac Mini, so you can recover {plural ? 'them' : 'it'} if needed.</p>
        <div className="modal__actions"><button onClick={onClose}>Cancel</button><button className="danger-solid" disabled={deleting} onClick={async () => { setDeleting(true); try { await onConfirm(photos) } finally { setDeleting(false) } }}>{deleting ? 'Deleting…' : 'Move to Recently Deleted'}</button></div>
      </div>
    </div>
  )
}

function Unlock({ onUnlock }) {
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  return (
    <main className="unlock-screen">
      <Brand />
      <form onSubmit={async (event) => { event.preventDefault(); setBusy(true); setError(''); try { await onUnlock(password) } catch (err) { setError(err.message) } finally { setBusy(false) } }}>
        <span className="unlock-screen__icon"><LockKeyhole size={26} /></span>
        <p className="eyebrow">PRIVATE LIBRARY</p>
        <h1>Welcome home.</h1>
        <p>Enter the shared password to open this photo library.</p>
        <label>Password</label>
        <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoFocus />
        {error && <span className="form-error">{error}</span>}
        <button disabled={busy || !password}>{busy ? 'Opening…' : 'Open library'}</button>
      </form>
    </main>
  )
}

function ExportDialog({ photos, onClose, onExport }) {
  const totalSize = photos.reduce((sum, photo) => sum + photo.size, 0)
  return (
    <div className="modal-wrap" role="dialog" aria-modal="true" aria-labelledby="export-title">
      <button className="modal-backdrop" onClick={onClose} aria-label="Close" />
      <div className="modal">
        <div className="modal__icon"><ArrowDownToLine size={21} /></div>
        <h2 id="export-title">Download {photos.length} originals?</h2>
        <p>
          Each photo will be saved as its own original file ({formatBytes(totalSize)} total).
          Your iPhone may ask you to allow multiple downloads.
        </p>
        <div className="export-list" aria-label="Files to download">
          {photos.slice(0, 4).map((photo) => <span key={photo.id}>{photo.name}</span>)}
          {photos.length > 4 && <span>and {photos.length - 4} more…</span>}
        </div>
        <div className="modal__actions">
          <button onClick={onClose}>Cancel</button>
          <button className="primary" onClick={onExport}>Download originals</button>
        </div>
      </div>
    </div>
  )
}

function BulkBar({ count, onCancel, onExport, onDelete }) {
  return (
    <div className="bulk-bar">
      <span><i><Check size={13} /></i> {count} selected</span>
      <div>
        <button onClick={onExport}><ArrowDownToLine size={17} /> Export</button>
        <button className="danger" onClick={onDelete}><Trash2 size={17} /> Delete</button>
        <button className="bulk-bar__close" onClick={onCancel} aria-label="Clear selection"><X size={18} /></button>
      </div>
    </div>
  )
}

export default function App() {
  const [status, setStatus] = useState(null)
  const [activeLibraryId, setActiveLibraryId] = useState('')
  const [photos, setPhotos] = useState([])
  const [summary, setSummary] = useState({ total: 0, totalBytes: 0 })
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState('modifiedAt:desc')
  const [selected, setSelected] = useState(new Set())
  const [active, setActive] = useState(null)
  const [renaming, setRenaming] = useState(null)
  const [deleting, setDeleting] = useState([])
  const [exporting, setExporting] = useState([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [locked, setLocked] = useState(false)
  const [toast, setToast] = useState(null)
  const loadRequest = useRef(0)

  const showToast = useCallback((message, tone = 'success') => {
    setToast({ message, tone })
    window.setTimeout(() => setToast(null), 3600)
  }, [])

  const loadPhotos = useCallback(async ({ quiet = false, libraryId = activeLibraryId } = {}) => {
    const requestId = ++loadRequest.current
    if (!libraryId) {
      setPhotos([])
      setSummary({ total: 0, totalBytes: 0 })
      setLoading(false)
      return
    }
    if (!quiet) setLoading(true)
    else setRefreshing(true)
    try {
      const [field, order] = sort.split(':')
      const response = await request(`/api/photos?search=${encodeURIComponent(search)}&sort=${field}&order=${order}&${libraryQuery(libraryId)}`)
      const data = await response.json()
      if (requestId !== loadRequest.current) return
      setPhotos(data.photos)
      setSummary({ total: data.total, totalBytes: data.totalBytes })
      setLocked(false)
    } catch (error) {
      if (requestId !== loadRequest.current) return
      if (error.status === 401) setLocked(true)
      else showToast(error.message, 'error')
    } finally {
      if (requestId !== loadRequest.current) return
      setLoading(false)
      setRefreshing(false)
    }
  }, [activeLibraryId, search, showToast, sort])

  useEffect(() => {
    request('/api/status').then((response) => response.json()).then((data) => {
      setStatus(data)
      const available = data.libraries || []
      setActiveLibraryId(available.find((library) => library.ready)?.id || available[0]?.id || '')
      if (!available.length) setLoading(false)
    }).catch((error) => { setLoading(false); showToast(error.message, 'error') })
  }, []) // status is intentionally loaded once

  useEffect(() => {
    if (!status || locked || !activeLibraryId) return
    const timeout = window.setTimeout(() => loadPhotos(), 220)
    return () => window.clearTimeout(timeout)
  }, [activeLibraryId, search, sort])

  const activeLibrary = useMemo(
    () => status?.libraries?.find((library) => library.id === activeLibraryId) || null,
    [activeLibraryId, status],
  )

  const selectLibrary = (libraryId) => {
    if (libraryId === activeLibraryId) return
    setActiveLibraryId(libraryId)
    setSelected(new Set())
    setActive(null)
    setRenaming(null)
    setDeleting([])
    setExporting([])
  }

  const saveRename = async (photo, name) => {
    try {
      const response = await request(`/api/photos/${photo.id}?${libraryQuery(photo.libraryId)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) })
      const { photo: updated } = await response.json()
      setPhotos((items) => items.map((item) => item.id === photo.id ? updated : item))
      if (active?.id === photo.id) setActive(updated)
      setRenaming(null)
      showToast(`Renamed to ${updated.name}`)
    } catch (error) { showToast(error.message, 'error') }
  }

  const confirmDelete = async (items) => {
    try {
      const ids = items.map((photo) => photo.id)
      if (ids.length === 1) await request(`/api/photos/${ids[0]}?${libraryQuery(items[0].libraryId)}`, { method: 'DELETE' })
      else await request('/api/photos/bulk-delete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids, library: items[0].libraryId }) })
      setPhotos((current) => current.filter((photo) => !ids.includes(photo.id)))
      setSummary((current) => ({ total: Math.max(0, current.total - ids.length), totalBytes: Math.max(0, current.totalBytes - items.reduce((sum, photo) => sum + photo.size, 0)) }))
      setSelected(new Set())
      if (active && ids.includes(active.id)) setActive(null)
      setDeleting([])
      showToast(`${ids.length === 1 ? items[0].name : `${ids.length} photos`} moved to Recently Deleted`)
    } catch (error) { showToast(error.message, 'error') }
  }

  const downloadOne = (photo) => {
    const link = document.createElement('a')
    link.href = mediaUrl(photo, true)
    link.download = photo.name
    link.hidden = true
    document.body.appendChild(link)
    link.click()
    link.remove()
  }

  const exportSelected = () => {
    if (selectedPhotos.length === 1) {
      downloadOne(selectedPhotos[0])
      setSelected(new Set())
      return
    }
    setExporting(selectedPhotos)
  }

  const downloadOriginals = () => {
    exporting.forEach((photo) => downloadOne(photo))
    const count = exporting.length
    setExporting([])
    setSelected(new Set())
    showToast(`${count} original files sent to your downloads`)
  }

  const selectedPhotos = useMemo(() => photos.filter((photo) => selected.has(photo.id)), [photos, selected])
  const moveActive = useCallback((offset) => {
    if (!active || photos.length < 2) return
    const index = photos.findIndex((photo) => photo.id === active.id)
    setActive(photos[(index + offset + photos.length) % photos.length])
  }, [active, photos])

  if (locked) return <Unlock onUnlock={async (password) => { await request('/api/unlock', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) }); setLocked(false); loadPhotos() }} />

  return (
    <div className="app-shell">
      <Sidebar status={status} activeLibraryId={activeLibraryId} onSelectLibrary={selectLibrary} />
      <main className="main-area">
        <TopBar status={status} search={search} setSearch={setSearch} onRefresh={() => loadPhotos({ quiet: true })} refreshing={refreshing}
          onSelectAll={() => setSelected(new Set(photos.map((photo) => photo.id)))} hasPhotos={photos.length > 0} />
        <div className="content">
          <section className="page-heading">
            <div>
              <p className="eyebrow">PHOTO SOURCE</p>
              <h1>{activeLibrary?.name || 'All photos'}</h1>
              <p>{loading ? 'Looking through your library…' : `${summary.total.toLocaleString()} ${summary.total === 1 ? 'photo' : 'photos'} · ${formatBytes(summary.totalBytes)}`}</p>
            </div>
            <div className="page-heading__controls">
              <label className="source-control"><HardDrive size={15} /><select aria-label="Photo source" value={activeLibraryId} onChange={(event) => selectLibrary(event.target.value)}>{(status?.libraries || []).map((library) => <option key={library.id} value={library.id}>{library.name}</option>)}</select><ChevronDown size={15} /></label>
              <label className="sort-control"><SlidersHorizontal size={16} /><span>Sort:</span><select value={sort} onChange={(event) => setSort(event.target.value)}>{SORTS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select><ChevronDown size={15} /></label>
            </div>
          </section>
          {loading ? (
            <div className="loading-state"><LoaderCircle className="spin" size={26} /><p>Gathering your photos…</p></div>
          ) : photos.length ? (
            <Gallery photos={photos} selected={selected} setSelected={setSelected} onOpen={setActive} onRename={setRenaming} onDelete={(photo) => setDeleting([photo])} onDownload={downloadOne} />
          ) : <EmptyState configured={status?.configured} ready={activeLibrary?.ready} searching={Boolean(search)} />}
          <footer className="content-footer"><span><ShieldCheck size={14} /> Private to your home network</span><span>{activeLibrary?.writable ? 'Source connected' : activeLibrary ? 'Folder needs write access' : 'Setup required'} <i className={activeLibrary?.writable ? 'online' : ''} /></span></footer>
        </div>
      </main>

      {selected.size > 0 && <BulkBar count={selected.size} onCancel={() => setSelected(new Set())} onExport={exportSelected} onDelete={() => setDeleting(selectedPhotos)} />}
      {active && <DetailPanel photo={active} onClose={() => setActive(null)} onRename={setRenaming} onDelete={(photo) => setDeleting([photo])} onPrevious={() => moveActive(-1)} onNext={() => moveActive(1)} />}
      {renaming && <RenameDialog photo={renaming} onClose={() => setRenaming(null)} onSave={saveRename} />}
      {deleting.length > 0 && <DeleteDialog photos={deleting} onClose={() => setDeleting([])} onConfirm={confirmDelete} />}
      {exporting.length > 0 && <ExportDialog photos={exporting} onClose={() => setExporting([])} onExport={downloadOriginals} />}
      {toast && <div className={`toast toast--${toast.tone}`}><span>{toast.tone === 'error' ? <X size={15} /> : <Check size={15} />}</span>{toast.message}</div>}
    </div>
  )
}
