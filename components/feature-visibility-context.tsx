'use client'

import { createContext, useContext, type ReactNode } from 'react'
import type { FeatureVisibilityMap } from '@/lib/types/features'
import { DEFAULT_FEATURE_VISIBILITY } from '@/lib/types/features'

const FeatureVisibilityContext = createContext<FeatureVisibilityMap>(DEFAULT_FEATURE_VISIBILITY)

export function FeatureVisibilityProvider({ value, children }: { value: FeatureVisibilityMap; children: ReactNode }) {
  return (
    <FeatureVisibilityContext.Provider value={value}>
      {children}
    </FeatureVisibilityContext.Provider>
  )
}

export function useFeatureVisibility() {
  return useContext(FeatureVisibilityContext)
}
