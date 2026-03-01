import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { extractFromBuffer } from '@/lib/parsing/extractAttachmentText'

// ---------------------------------------------------------------------------
// GET — List all documents for a company
// ---------------------------------------------------------------------------

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()

  const { data: documents, error } = await admin
    .from('company_documents' as any)
    .select('id, filename, file_type, file_size, has_native_content, created_at')
    .eq('company_id', params.id)
    .order('created_at', { ascending: false }) as { data: any[] | null; error: { message: string } | null }

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ documents: documents ?? [] })
}

// ---------------------------------------------------------------------------
// POST — Register an uploaded document and extract text
// ---------------------------------------------------------------------------

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()

  // Verify company exists and user is a fund member
  const { data: company } = await admin
    .from('companies')
    .select('id, fund_id')
    .eq('id', params.id)
    .maybeSingle()

  if (!company) return NextResponse.json({ error: 'Company not found' }, { status: 404 })

  const { data: membership } = await supabase
    .from('fund_members')
    .select('role')
    .eq('fund_id', company.fund_id)
    .eq('user_id', user.id)
    .maybeSingle()

  if (!membership) return NextResponse.json({ error: 'Not a fund member' }, { status: 403 })

  const body = await req.json()
  const { storagePath, filename, fileType, fileSize } = body

  if (!storagePath || !filename || !fileType) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  // Download file from Storage to extract text
  const { data: fileData, error: downloadError } = await admin
    .storage
    .from('company-documents')
    .download(storagePath)

  if (downloadError || !fileData) {
    return NextResponse.json({ error: 'Failed to download file from storage' }, { status: 500 })
  }

  const buffer = Buffer.from(await fileData.arrayBuffer())
  const result = await extractFromBuffer(buffer, filename, fileType)

  const { error: insertError } = await admin
    .from('company_documents' as any)
    .insert({
      company_id: params.id,
      fund_id: company.fund_id,
      filename,
      file_type: fileType,
      file_size: fileSize ?? buffer.length,
      storage_path: storagePath,
      extracted_text: result.extractedText || null,
      has_native_content: !!result.base64Content,
      uploaded_by: user.id,
    })

  if (insertError) {
    return NextResponse.json({ error: insertError.message }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
