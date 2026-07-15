import { redirect } from 'next/navigation'

// The live LP report moved up to be the LPs landing page itself (/lps). Old links resolve.
export default function LpsLiveRedirect() {
  redirect('/lps')
}
