import { ogMetadata } from '@/lib/og-metadata'
import { Lock } from 'lucide-react'
import { ExplainerContent } from '../explainer-content'

export const metadata = ogMetadata({
  title: 'LP Portal',
  description: 'Give your LPs a private, branded portal to view and download statements, letters, and documents - and email any of them to individual LPs or your whole list.',
})

export default function LpPortalExplainerPage() {
  return (
    <ExplainerContent
      title="LP Portal"
      icon={Lock}
      screenshotSrc="/screenshots/lp-portal.png"
      screenshotLabel="LP Portal"
    >
      <p className="text-muted-foreground">
        The LP Portal is a private, fund-branded area where your limited partners sign in to see
        exactly what you&apos;ve shared with them - their capital account statements, quarterly
        letters, and fund documents. Each LP only ever sees their own positions; access is scoped
        per investor on the server, never inferred from the browser.
      </p>
      <p className="text-muted-foreground">
        <strong>Off by default, on when you&apos;re ready</strong> - the portal is controlled by a
        per-fund switch in Settings. Until you enable it, nothing reaches your LPs even if items are
        shared. You choose which snapshots, letters, and documents each investor can see.
      </p>
      <p className="text-muted-foreground">
        <strong>Statements</strong> - every shared LP snapshot appears as a capital account
        statement the LP can open as a web page or download as a PDF. The PDF is generated on demand,
        scoped to that investor&apos;s own entities and holdings, with your fund header and footer.
      </p>
      <p className="text-muted-foreground">
        <strong>Letters</strong> - shared quarterly letters render as a clean web page and download
        as a PDF that matches the statement styling, so the two read as one family of documents.
      </p>
      <p className="text-muted-foreground">
        <strong>Documents</strong> - upload any file (audited financials, K-1s, side letters, capital
        notices) fund-wide for all LPs or scoped to specific investors. LPs download them from the
        portal, with the file type, size, upload date, and category shown on each item.
      </p>
      <p className="text-muted-foreground">
        <strong>Send by email</strong> - from any statement, letter, or document you can email it to
        a single LP, several, or your whole list using checkboxes and select-all. Choose how it&apos;s
        delivered: a secure portal link (LPs sign in to view), a PDF attachment, or both. You write
        the subject and a short note, and see a summary of who received it.
      </p>
      <p className="text-muted-foreground">
        <strong>Authorized users</strong> - an LP can have authorized users on their account - an
        advisor, accountant, or family-office contact. They get their own login scoped to that LP,
        and they&apos;re automatically included on emails about that LP&apos;s items, so you never
        have to maintain a separate distribution list.
      </p>
      <p className="text-muted-foreground">
        <strong>AI analyst</strong> - LPs can ask questions about the documents you&apos;ve shared
        with them, answered only from their own materials.
      </p>
    </ExplainerContent>
  )
}
