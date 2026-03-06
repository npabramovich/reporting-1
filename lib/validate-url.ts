type ValidationResult =
  | { ok: true; url: string }
  | { ok: false; error: string }

/**
 * Validates an Ollama base URL to prevent SSRF attacks.
 *
 * Allows:
 * - localhost / 127.0.0.1 / ::1 (standard Ollama setup)
 * - Public IPs and hostnames
 *
 * Blocks:
 * - Cloud metadata endpoints (169.254.x.x)
 * - Private network ranges (10.x, 172.16-31.x, 192.168.x) except localhost
 * - Non-HTTP(S) protocols
 * - URLs without a valid hostname
 */
export function validateOllamaUrl(input: string): ValidationResult {
  let parsed: URL
  try {
    parsed = new URL(input)
  } catch {
    return { ok: false, error: 'Invalid URL format' }
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, error: 'Only HTTP and HTTPS URLs are allowed' }
  }

  const hostname = parsed.hostname

  if (!hostname) {
    return { ok: false, error: 'URL must include a hostname' }
  }

  // Allow localhost variants (standard Ollama setup)
  if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1') {
    return { ok: true, url: input }
  }

  // Block link-local / cloud metadata (169.254.x.x — includes AWS/GCP/Azure metadata at 169.254.169.254)
  if (/^169\.254\./.test(hostname)) {
    return { ok: false, error: 'Link-local addresses are not allowed' }
  }

  // Block private network ranges
  if (/^10\./.test(hostname)) {
    return { ok: false, error: 'Private network addresses are not allowed' }
  }
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(hostname)) {
    return { ok: false, error: 'Private network addresses are not allowed' }
  }
  if (/^192\.168\./.test(hostname)) {
    return { ok: false, error: 'Private network addresses are not allowed' }
  }

  // Block other loopback ranges (127.0.0.0/8 beyond 127.0.0.1)
  if (/^127\./.test(hostname)) {
    return { ok: false, error: 'Loopback addresses are not allowed' }
  }

  // Block IPv6 private/link-local (fe80::, fc00::, fd00::)
  if (/^(fe80|fc00|fd00)/i.test(hostname)) {
    return { ok: false, error: 'Private IPv6 addresses are not allowed' }
  }

  // Block 0.0.0.0
  if (hostname === '0.0.0.0') {
    return { ok: false, error: 'Invalid address' }
  }

  return { ok: true, url: input }
}
