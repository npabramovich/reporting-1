import { redirect } from 'next/navigation'

// Allocation terms moved onto the Admin page as collapsible "Settings" sections (carry terms,
// allocation basis, partner terms, commitment history). This route now just forwards there so
// old links/bookmarks keep working.
export default function AllocationTermsPage() {
  redirect('/funds/status')
}
