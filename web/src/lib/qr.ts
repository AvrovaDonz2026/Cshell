import QRCode from 'qrcode'

/**
 * Payment `qr_code` values are ambiguous: a data: image, a hosted image URL,
 * or raw payment content that must be encoded locally. This never treats
 * arbitrary URLs as images.
 */
export type QrSource = 'data-url' | 'image-url' | 'content'

const IMAGE_EXTENSION = /\.(png|jpg|jpeg|gif|webp|svg|bmp)$/i

export function classifyQrSource(value: string | null | undefined): QrSource {
  const raw = (value || '').trim()
  if (raw.toLowerCase().startsWith('data:image/')) return 'data-url'
  if (/^https?:\/\//i.test(raw)) {
    try {
      const parsed = new URL(raw)
      if (IMAGE_EXTENSION.test(parsed.pathname)) return 'image-url'
    } catch {
      return 'content'
    }
    return 'content'
  }
  return 'content'
}

/** Encode arbitrary payment content into a PNG data URL, rendered locally. */
export async function renderQrDataUrl(
  content: string,
  size = 220,
): Promise<string> {
  return QRCode.toDataURL(content, {
    margin: 1,
    width: size,
    errorCorrectionLevel: 'M',
  })
}

/** Resolve any QR payload into an `<img src>` value. */
export async function resolveQrImageSrc(
  value: string,
  size = 220,
): Promise<string> {
  const source = classifyQrSource(value)
  if (source === 'data-url' || source === 'image-url') return value.trim()
  return renderQrDataUrl(value.trim(), size)
}
