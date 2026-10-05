/** The sign-in screens' logo and text, from Settings → Fund. Shared by the loader and the UI. */
export interface AuthBrand {
  /** A data:image/ URL, or null for Hemrock's mark. */
  logo: string | null
  /** The line under the logo, or null for none. */
  title: string | null
}

export const DEFAULT_AUTH_BRAND: AuthBrand = { logo: null, title: null }

/** Longest sign-in line Settings accepts; it sits under the logo on a phone. */
export const AUTH_TITLE_MAX = 60
