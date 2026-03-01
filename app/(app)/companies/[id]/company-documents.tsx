'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { FileText, Upload, Trash2, Loader2, ChevronDown, ChevronRight, FileSpreadsheet, FileImage, File } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface Document {
  id: string
  filename: string
  file_type: string
  file_size: number
  has_native_content: boolean
  created_at: string
}

interface Props {
  companyId: string
  fundId: string
}

const ACCEPTED_TYPES = '.pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.csv,.jpg,.jpeg,.png'

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function FileIcon({ fileType }: { fileType: string }) {
  if (fileType === 'application/pdf' || fileType.endsWith('.pdf')) {
    return <FileText className="h-3.5 w-3.5 text-red-500 shrink-0" />
  }
  if (fileType.startsWith('image/')) {
    return <FileImage className="h-3.5 w-3.5 text-blue-500 shrink-0" />
  }
  if (fileType.includes('spreadsheet') || fileType.includes('excel') || fileType.includes('csv')) {
    return <FileSpreadsheet className="h-3.5 w-3.5 text-green-600 shrink-0" />
  }
  return <File className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
}

export function CompanyDocuments({ companyId, fundId }: Props) {
  const [documents, setDocuments] = useState<Document[]>([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [expanded, setExpanded] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/companies/${companyId}/documents`)
      if (res.ok) {
        const data = await res.json()
        setDocuments(data.documents)
      }
    } finally {
      setLoading(false)
    }
  }, [companyId])

  useEffect(() => { load() }, [load])

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return

    setUploading(true)
    setError(null)

    try {
      const supabase = createClient()
      const fileExt = file.name.split('.').pop()
      const storagePath = `${fundId}/${companyId}/${crypto.randomUUID()}-${file.name}`

      // Upload to Supabase Storage
      const { error: uploadError } = await supabase
        .storage
        .from('company-documents')
        .upload(storagePath, file)

      if (uploadError) {
        setError(`Upload failed: ${uploadError.message}`)
        return
      }

      // Register with our API (triggers text extraction)
      const res = await fetch(`/api/companies/${companyId}/documents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          storagePath,
          filename: file.name,
          fileType: file.type || `application/${fileExt}`,
          fileSize: file.size,
        }),
      })

      if (!res.ok) {
        const data = await res.json()
        setError(data.error ?? 'Failed to register document')
        return
      }

      await load()
    } catch {
      setError('Upload failed')
    } finally {
      setUploading(false)
      // Reset the input so the same file can be re-selected
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  async function handleDelete(docId: string) {
    setDeletingId(docId)
    setError(null)

    try {
      const res = await fetch(`/api/companies/${companyId}/documents/${docId}`, {
        method: 'DELETE',
      })

      if (res.ok) {
        setDocuments(prev => prev.filter(d => d.id !== docId))
      } else {
        const data = await res.json()
        setError(data.error ?? 'Failed to delete document')
      }
    } catch {
      setError('Failed to delete document')
    } finally {
      setDeletingId(null)
    }
  }

  if (loading) {
    return (
      <div className="mt-6">
        <div className="flex items-center gap-2 mb-2">
          <FileText className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-sm font-medium text-muted-foreground">Documents</span>
        </div>
        <div className="animate-pulse space-y-2">
          <div className="h-8 bg-muted rounded w-full" />
          <div className="h-8 bg-muted rounded w-full" />
        </div>
      </div>
    )
  }

  return (
    <div className="mt-6">
      <div className="flex items-center justify-between mb-2">
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground"
        >
          {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          <FileText className="h-3.5 w-3.5" />
          Documents
          {documents.length > 0 && (
            <span className="text-xs bg-muted rounded-full px-1.5 py-0.5">{documents.length}</span>
          )}
        </button>

        <div>
          <input
            ref={fileInputRef}
            type="file"
            accept={ACCEPTED_TYPES}
            onChange={handleUpload}
            className="hidden"
          />
          <Button
            size="sm"
            variant="outline"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="h-7 text-xs"
          >
            {uploading ? (
              <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
            ) : (
              <Upload className="h-3.5 w-3.5 mr-1.5" />
            )}
            {uploading ? 'Uploading...' : 'Upload'}
          </Button>
        </div>
      </div>

      {error && (
        <p className="text-sm text-destructive mb-2">{error}</p>
      )}

      {expanded && documents.length > 0 && (
        <div className="space-y-1">
          {documents.map(doc => (
            <div
              key={doc.id}
              className="flex items-center justify-between gap-3 px-3 py-2 rounded-md border bg-card text-sm"
            >
              <div className="flex items-center gap-2 min-w-0">
                <FileIcon fileType={doc.file_type} />
                <span className="truncate">{doc.filename}</span>
                <span className="text-xs text-muted-foreground shrink-0">
                  {formatFileSize(doc.file_size)}
                </span>
                <span className="text-xs text-muted-foreground shrink-0">
                  {new Date(doc.created_at).toLocaleDateString(undefined, {
                    month: 'short', day: 'numeric',
                  })}
                </span>
              </div>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => handleDelete(doc.id)}
                disabled={deletingId === doc.id}
                className="h-7 px-2 text-muted-foreground hover:text-destructive shrink-0"
              >
                {deletingId === doc.id ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Trash2 className="h-3.5 w-3.5" />
                )}
              </Button>
            </div>
          ))}
        </div>
      )}

      {expanded && documents.length === 0 && (
        <p className="text-xs text-muted-foreground px-3 py-2">
          No documents uploaded yet. Upload strategy decks, board materials, or other context for the AI analyst.
        </p>
      )}
    </div>
  )
}
