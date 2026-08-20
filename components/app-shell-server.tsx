import { Suspense } from 'react'
import { getReviewBadge, getNotesBadge, getPendingRequests, getUpdateAvailable } from '@/lib/cache/layout'
import { AppHeader } from './app-header'
import { AppSidebar } from './app-sidebar'
import type { FeatureVisibilityMap } from '@/lib/types/features'

interface AppHeaderServerProps {
  fundId?: string
  userId?: string
  fundName: string
  fundLogo?: string | null
  userEmail: string
  isAdmin?: boolean
  featureVisibility?: FeatureVisibilityMap
}

export async function AppHeaderServer({ fundName, fundLogo, userEmail }: AppHeaderServerProps) {
  return (
    <AppHeader 
      fundName={fundName} 
      fundLogo={fundLogo} 
      userEmail={userEmail} 
    />
  )
}

interface AppSidebarServerProps {
  fundId: string
  userId: string
  isAdmin: boolean
  featureVisibility?: FeatureVisibilityMap
}

export async function AppSidebarServer({ fundId, userId, isAdmin, featureVisibility }: AppSidebarServerProps) {
  const [reviewBadge, notesBadge, settingsBadge, updateAvailable] = await Promise.all([
    getReviewBadge(fundId),
    getNotesBadge(userId),
    isAdmin ? getPendingRequests(fundId) : Promise.resolve(0),
    isAdmin ? getUpdateAvailable() : Promise.resolve(false),
  ])
  
  return (
    <AppSidebar 
      reviewBadge={reviewBadge} 
      notesBadge={notesBadge} 
      settingsBadge={settingsBadge} 
      isAdmin={isAdmin} 
      updateAvailable={updateAvailable} 
      featureVisibility={featureVisibility} 
    />
  )
}
