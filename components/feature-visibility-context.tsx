'use client'

import { createContext, useContext, type ReactNode } from 'react'
import type { FeatureVisibilityMap } from '@/lib/types/features'
import { DEFAULT_FEATURE_VISIBILITY } from '@/lib/types/features'

const FeatureVisibilityContext = createContext<FeatureVisibilityMap>(DEFAULT_FEATURE_VISIBILITY)
const AdminContext = createContext<boolean>(false)

export function FeatureVisibilityProvider({ value, isAdmin = false, children }: { value: FeatureVisibilityMap; isAdmin?: boolean; children: ReactNode }) {
  return (
    <FeatureVisibilityContext.Provider value={value}>
      <AdminContext.Provider value={isAdmin}>
        {children}
      </AdminContext.Provider>
    </FeatureVisibilityContext.Provider>
  )
}

export function useFeatureVisibility() {
  return useContext(FeatureVisibilityContext)
}

/** Whether the current user is a fund admin (mirrors the server-resolved role). */
export function useIsAdmin() {
  return useContext(AdminContext)
}
