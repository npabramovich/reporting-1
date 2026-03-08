import puppeteer from 'puppeteer'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const BASE = 'https://portfolio.hemrock.com'
const docsDir = path.resolve(__dirname, '..', 'docs', 'screenshots')
const publicDir = path.resolve(__dirname, '..', 'public', 'screenshots')

// Pages to screenshot — use sidebar label to click, or null for special handling
const PAGES = [
  { name: 'dashboard', sidebarLabel: 'Portfolio', wait: 4000 },
  { name: 'company', sidebarLabel: null, wait: 4000 },
  { name: 'review', sidebarLabel: 'Review', wait: 3000 },
  { name: 'inbound', sidebarLabel: 'Inbound', wait: 3000 },
  { name: 'email-detail', sidebarLabel: null, wait: 3000 },
  { name: 'import', sidebarLabel: 'Import', wait: 3000 },
  { name: 'investments', sidebarLabel: 'Investments', wait: 4000 },
  { name: 'funds', sidebarLabel: 'Funds', wait: 4000 },
  { name: 'asks', sidebarLabel: 'Asks', wait: 3000 },
  { name: 'notes', sidebarLabel: 'Notes', wait: 3000 },
  { name: 'interactions', sidebarLabel: 'Interactions', wait: 3000 },
  { name: 'letters', sidebarLabel: 'LP Letters', wait: 3000 },
  { name: 'settings', sidebarLabel: 'Settings', wait: 3000 },
]

async function clickSidebarLink(page, label) {
  // Find sidebar link by its text content
  const clicked = await page.evaluate((lbl) => {
    const links = Array.from(document.querySelectorAll('nav a'))
    const link = links.find(a => a.textContent.trim() === lbl)
    if (link) { link.click(); return true }
    return false
  }, label)
  if (clicked) {
    // Wait for navigation
    await new Promise(r => setTimeout(r, 1000))
    await page.waitForFunction(() => document.readyState === 'complete', { timeout: 10000 })
  }
  return clicked
}

async function saveScreenshot(page, name) {
  await page.keyboard.press('Escape')
  await new Promise(r => setTimeout(r, 300))
  await page.screenshot({ path: path.join(docsDir, `${name}.png`), fullPage: false })
  await page.screenshot({ path: path.join(publicDir, `${name}.png`), fullPage: false })
  console.log(`  Saved ${name}.png`)
}

async function run() {
  const browser = await puppeteer.launch({
    headless: true,
    defaultViewport: { width: 1440, height: 900 },
    args: ['--no-sandbox'],
  })

  const page = await browser.newPage()

  // Block the beacon logout so session persists
  await page.setRequestInterception(true)
  page.on('request', req => {
    if (req.url().includes('/api/auth/logout')) {
      req.abort()
    } else {
      req.continue()
    }
  })

  // Login via demo
  console.log('Logging in via /demo...')
  await page.goto(`${BASE}/demo`, { waitUntil: 'networkidle2', timeout: 30000 })
  await page.waitForFunction(() => window.location.pathname === '/dashboard', { timeout: 30000 })
  await new Promise(r => setTimeout(r, 5000))
  console.log('Logged in at:', page.url())

  for (const entry of PAGES) {
    try {
      if (entry.name === 'company') {
        // Click first company card on dashboard
        console.log('Clicking first company...')
        await clickSidebarLink(page, 'Portfolio')
        await new Promise(r => setTimeout(r, 3000))
        const clicked = await page.evaluate(() => {
          const link = document.querySelector('a[href*="/companies/"]')
          if (link) { link.click(); return true }
          return false
        })
        if (!clicked) { console.log('  No company link found'); continue }
        await new Promise(r => setTimeout(r, entry.wait))
      } else if (entry.name === 'email-detail') {
        // Click first email on inbound page
        console.log('Clicking first email...')
        await clickSidebarLink(page, 'Inbound')
        await new Promise(r => setTimeout(r, 3000))
        const clicked = await page.evaluate(() => {
          const link = document.querySelector('a[href*="/emails/"]')
          if (link) { link.click(); return true }
          return false
        })
        if (!clicked) { console.log('  No email link found'); continue }
        await new Promise(r => setTimeout(r, entry.wait))
      } else {
        console.log(`Clicking sidebar: ${entry.sidebarLabel}...`)
        const clicked = await clickSidebarLink(page, entry.sidebarLabel)
        if (!clicked) {
          console.log(`  Sidebar link "${entry.sidebarLabel}" not found`)
          continue
        }
        await new Promise(r => setTimeout(r, entry.wait))
      }

      await saveScreenshot(page, entry.name)
    } catch (err) {
      console.error(`  Failed ${entry.name}:`, err.message)
    }
  }

  await browser.close()
  console.log('Done!')
}

run().catch(console.error)
