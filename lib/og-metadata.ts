import type { Metadata } from 'next'

const BASE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://portfolio.hemrock.com'

export function ogMetadata(opts: {
  title: string
  description: string
  subtitle?: string
}): Metadata {
  const ogUrl = new URL('/api/og', BASE_URL)
  ogUrl.searchParams.set('title', opts.title)
  if (opts.subtitle) ogUrl.searchParams.set('subtitle', opts.subtitle)

  return {
    title: opts.title,
    description: opts.description,
    openGraph: {
      title: opts.title,
      description: opts.description,
      images: [{ url: ogUrl.toString(), width: 1200, height: 630, alt: opts.title }],
      type: 'website',
      siteName: 'Analyst by Hemrock',
    },
    twitter: {
      card: 'summary_large_image',
      title: opts.title,
      description: opts.description,
      images: [ogUrl.toString()],
    },
  }
}
