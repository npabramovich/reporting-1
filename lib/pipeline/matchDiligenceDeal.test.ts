import { describe, it, expect } from 'vitest'
import { matchDiligenceDeal, type DiligenceDealRef } from './matchDiligenceDeal'

const acme: DiligenceDealRef = {
  id: 'deal-acme',
  name: 'Acme',
  aliases: ['Acme Robotics'],
  domains: ['acme.com'],
}

const notion: DiligenceDealRef = {
  id: 'deal-notion',
  name: 'Notion.so',
  aliases: null,
  domains: ['notion.so'],
}

const noDomain: DiligenceDealRef = {
  id: 'deal-zeta',
  name: 'Zeta',
  aliases: null,
  domains: [],
}

describe('matchDiligenceDeal', () => {
  it('matches on sender domain', () => {
    const m = matchDiligenceDeal({
      senderEmail: 'founder@acme.com',
      subject: 'Following up',
      deals: [acme, notion],
    })
    expect(m?.deal.id).toBe('deal-acme')
    expect(m?.basis).toBe('sender_domain')
    expect(m?.confidence).toBe('high')
  })

  it('matches the original sender of a forwarded email', () => {
    const m = matchDiligenceDeal({
      senderEmail: 'partner@ourfund.com',
      forwardedFromEmail: 'ceo@acme.com',
      subject: 'Fwd: materials',
      deals: [acme],
    })
    expect(m?.deal.id).toBe('deal-acme')
    expect(m?.basis).toBe('sender_domain')
  })

  it('matches a deal name appearing in the subject', () => {
    const m = matchDiligenceDeal({
      senderEmail: 'someone@lawfirm.com',
      subject: 'Zeta — updated cap table',
      deals: [noDomain, acme],
    })
    expect(m?.deal.id).toBe('deal-zeta')
    expect(m?.basis).toBe('name')
    expect(m?.confidence).toBe('medium')
  })

  it('matches on an alias', () => {
    const m = matchDiligenceDeal({
      senderEmail: 'x@lawfirm.com',
      subject: 'Acme Robotics diligence questions',
      deals: [acme],
    })
    expect(m?.deal.id).toBe('deal-acme')
  })

  it('does NOT match a free-mail sender domain', () => {
    // A deal whose stored domain is gmail.com (bad data from a founder using a
    // personal address) must not swallow every Gmail email in the inbox.
    const gmailDeal: DiligenceDealRef = {
      id: 'deal-bad', name: 'Bad', aliases: null, domains: ['gmail.com'],
    }
    const m = matchDiligenceDeal({
      senderEmail: 'random.person@gmail.com',
      subject: 'hello',
      deals: [gmailDeal],
    })
    expect(m).toBeNull()
  })

  it('does NOT match a substring inside a longer word', () => {
    // "Zeta" must not match "Zetachem" — whole-word only.
    const m = matchDiligenceDeal({
      senderEmail: 'x@other.com',
      subject: 'Zetachem quarterly newsletter',
      deals: [noDomain],
    })
    expect(m).toBeNull()
  })

  it('returns null when two deals both match the subject', () => {
    // Ambiguity is a reason to ask a human, not to guess.
    const a: DiligenceDealRef = { id: 'a', name: 'Orbit', aliases: null, domains: [] }
    const b: DiligenceDealRef = { id: 'b', name: 'Vector', aliases: null, domains: [] }
    const m = matchDiligenceDeal({
      senderEmail: 'x@other.com',
      subject: 'Orbit and Vector intro',
      deals: [a, b],
    })
    expect(m).toBeNull()
  })

  it('treats a deal name with regex metacharacters literally', () => {
    // "Notion.so" contains '.', which as a regex would match "NotionXso".
    const m = matchDiligenceDeal({
      senderEmail: 'x@other.com',
      subject: 'NotionXso raises a round',
      deals: [notion],
    })
    expect(m).toBeNull()

    const hit = matchDiligenceDeal({
      senderEmail: 'x@other.com',
      subject: 'Notion.so follow-up',
      deals: [notion],
    })
    expect(hit?.deal.id).toBe('deal-notion')
  })

  it('prefers a domain match over a name match', () => {
    const m = matchDiligenceDeal({
      senderEmail: 'ceo@acme.com',
      subject: 'Zeta comparison',
      deals: [noDomain, acme],
    })
    expect(m?.deal.id).toBe('deal-acme')
    expect(m?.basis).toBe('sender_domain')
  })

  it('returns null with no deals in diligence', () => {
    expect(matchDiligenceDeal({
      senderEmail: 'ceo@acme.com',
      subject: 'hi',
      deals: [],
    })).toBeNull()
  })

  it('ignores very short deal names to avoid noise', () => {
    const shortDeal: DiligenceDealRef = { id: 's', name: 'AI', aliases: null, domains: [] }
    const m = matchDiligenceDeal({
      senderEmail: 'x@other.com',
      subject: 'AI newsletter for you',
      deals: [shortDeal],
    })
    expect(m).toBeNull()
  })
})
