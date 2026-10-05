'use client'

import { createContext, useContext, type ReactNode } from 'react'
import Link from 'next/link'
import { BrandMark } from '@/components/brand-mark'
import { DEFAULT_AUTH_BRAND, type AuthBrand } from '@/lib/auth-brand-shared'

const AuthBrandContext = createContext<AuthBrand>(DEFAULT_AUTH_BRAND)

/** Set by app/auth/layout.tsx and app/oauth/layout.tsx, which read the fund's settings. */
export function AuthBrandProvider({ brand, children }: { brand: AuthBrand; children: ReactNode }) {
  return <AuthBrandContext.Provider value={brand}>{children}</AuthBrandContext.Provider>
}

/**
 * The logo, and the text under it when the fund has set one, linked home. Without a provider
 * (or with nothing set) it is Hemrock's mark alone: no product or company name.
 */
export function AuthWordmark() {
  const { logo, title } = useContext(AuthBrandContext)
  return (
    <div className="text-center">
      <Link href="/" aria-label={title ?? 'Home'} className="inline-flex flex-col items-center gap-2 transition-opacity hover:opacity-80">
        {logo ? (
          // eslint-disable-next-line @next/next/no-img-element -- a data: URL from settings; next/image adds nothing
          <img src={logo} alt="" className="h-10 w-auto max-w-[240px] object-contain" />
        ) : (
          <BrandMark className="h-8 w-auto text-foreground" />
        )}
        {title && <h1 className="text-lg font-semibold tracking-tight">{title}</h1>}
      </Link>
    </div>
  )
}
