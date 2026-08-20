import { createCipheriv, createDecipheriv, randomBytes } from 'crypto'

const ALGORITHM = 'aes-256-gcm'

// Ciphertext wire format: `${iv_hex}:${authTag_hex}:${data_hex}`
// IV: 12 bytes (96-bit, GCM standard), authTag: 16 bytes

// Decode a hex key and assert it is a full 32 bytes (256-bit). A malformed key
// would otherwise be silently truncated by Buffer.from, yielding a weak/short
// key or an opaque downstream error.
function keyFromHex(keyHex: string): Buffer {
  const key = Buffer.from(keyHex, 'hex')
  if (key.length !== 32) {
    throw new Error('Encryption key must be 32 bytes (64 hex characters)')
  }
  return key
}

export function encrypt(plaintext: string, keyHex: string): string {
  const key = keyFromHex(keyHex)
  const iv = randomBytes(12)
  const cipher = createCipheriv(ALGORITHM, key, iv)
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()
  return [iv.toString('hex'), authTag.toString('hex'), encrypted.toString('hex')].join(':')
}

export function decrypt(ciphertext: string, keyHex: string): string {
  const parts = ciphertext.split(':')
  if (parts.length !== 3) throw new Error('decrypt: invalid ciphertext format')
  const [ivHex, authTagHex, encryptedHex] = parts
  const key = keyFromHex(keyHex)
  const iv = Buffer.from(ivHex, 'hex')
  const authTag = Buffer.from(authTagHex, 'hex')
  const encrypted = Buffer.from(encryptedHex, 'hex')
  const decipher = createDecipheriv(ALGORITHM, key, iv)
  decipher.setAuthTag(authTag)
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8')
}

// Envelope decryption:
//   1. Decrypt the per-fund DEK (data encryption key) using the master KEK
//      stored in the ENCRYPTION_KEY environment variable.
//   2. Decrypt the Claude API key using the DEK.
export function decryptApiKey(
  claudeApiKeyEncrypted: string,
  encryptionKeyEncrypted: string
): string {
  const kek = process.env.ENCRYPTION_KEY
  if (!kek) throw new Error('ENCRYPTION_KEY environment variable is not set')
  const dek = decrypt(encryptionKeyEncrypted, kek)
  return decrypt(claudeApiKeyEncrypted, dek)
}
