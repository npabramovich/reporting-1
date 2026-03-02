const TOKEN_URL = 'https://api.dropbox.com/oauth2/token'
const CONTENT_URL = 'https://content.dropboxapi.com/2/files/upload'
const API_URL = 'https://api.dropboxapi.com/2'

export async function getAccessToken(
  refreshToken: string,
  appKey: string,
  appSecret: string
): Promise<string> {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: appKey,
      client_secret: appSecret,
    }),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Failed to refresh Dropbox token: ${text}`)
  }

  const data = await res.json()
  if (!data.access_token) {
    throw new Error('Dropbox token refresh did not return an access token')
  }
  return data.access_token
}

export async function findOrCreateFolder(
  accessToken: string,
  path: string
): Promise<void> {
  // Check if folder exists
  const metaRes = await fetch(`${API_URL}/files/get_metadata`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ path }),
  })

  if (metaRes.ok) return // folder exists

  // Create folder
  const createRes = await fetch(`${API_URL}/files/create_folder_v2`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ path, autorename: false }),
  })

  if (!createRes.ok) {
    const text = await createRes.text()
    // Ignore "path/conflict/folder" — means it already exists (race condition)
    if (!text.includes('path/conflict/folder')) {
      throw new Error(`Failed to create Dropbox folder "${path}": ${text}`)
    }
  }
}

export async function uploadFile(
  accessToken: string,
  folderPath: string,
  filename: string,
  content: Buffer | string
): Promise<void> {
  const filePath = `${folderPath}/${filename}`
  const body = typeof content === 'string' ? Buffer.from(content, 'utf-8') : content

  const res = await fetch(CONTENT_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Dropbox-API-Arg': JSON.stringify({
        path: filePath,
        mode: 'add',
        autorename: true,
        mute: true,
      }),
      'Content-Type': 'application/octet-stream',
    },
    body: body as unknown as BodyInit,
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Failed to upload file "${filename}" to Dropbox: ${text}`)
  }
}
