/**
 * 교회 홈페이지 크롤링 및 구조 분석 모듈
 *
 * 기능:
 * 1. 홈페이지 구조 자동 분석 (AI 기반)
 * 2. 메뉴/서브페이지/게시판 감지
 * 3. Dictionary/Taxonomy/Metadata 추출
 * 4. 다중 교회 템플릿 지원
 */

import { createClient } from '@supabase/supabase-js'
import OpenAI from 'openai'
import Anthropic from '@anthropic-ai/sdk'
import * as cheerio from 'cheerio'

// Supabase 클라이언트
let supabase: ReturnType<typeof createClient> | null = null

function getSupabase() {
  if (!supabase) {
    supabase = createClient(
      (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL)!,
      process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || ''
    )
  }
  return supabase
}

// API 클라이언트
let openai: OpenAI | null = null
let anthropic: Anthropic | null = null

async function getOpenAI(): Promise<OpenAI> {
  if (!openai) {
    openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  }
  return openai
}

async function getAnthropic(): Promise<Anthropic> {
  if (!anthropic) {
    anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  }
  return anthropic
}

// ============ 인터페이스 ============

export interface PageInfo {
  url: string
  title: string
  pageType: 'main' | 'menu' | 'submenu' | 'content' | 'board' | 'popup' | 'external' | 'modal'
  depth: number
  parentUrl?: string
  children?: PageInfo[]
  contentType?: 'static' | 'board' | 'gallery' | 'video' | 'list' | 'form' | 'popup'
  extractedData?: any
  crawled?: boolean  // 실제로 방문했는지 여부
  crawlError?: string  // 크롤링 오류 메시지
}

// 크롤링 진행 상황 추적
export interface CrawlProgress {
  totalPages: number
  crawledPages: number
  currentUrl: string
  currentDepth: number
  errors: string[]
}

// 팝업/모달 정보
export interface PopupInfo {
  url: string
  title: string
  triggerType: 'onclick' | 'href' | 'data-url' | 'window.open' | 'layer'
  triggerElement: string
}

export interface SiteStructure {
  church: {
    name: string
    code: string
    url: string
  }
  navigation: PageInfo[]
  boards: PageInfo[]
  specialPages: PageInfo[]
  metadata: {
    totalPages: number
    maxDepth: number
    hasLogin: boolean
    hasMobileVersion: boolean
    technologies: string[]
  }
  // 확장된 정보
  contacts?: ContactInfo
  socialMedia?: SocialMediaInfo
  media?: MediaInfo
  worshipTimes?: WorshipTimeInfo[]
}

export interface DictionaryEntry {
  term: string
  category: string
  subcategory?: string
  definition?: string
  aliases?: string[]
  relatedTerms?: string[]
  metadata?: any
  sourceUrl?: string
}

// 연락처 정보
export interface ContactInfo {
  phones: string[]
  emails: string[]
  fax?: string
  address?: string
  postalCode?: string
}

// 소셜 미디어 정보
export interface SocialMediaInfo {
  youtube?: string
  facebook?: string
  instagram?: string
  twitter?: string
  blog?: string
  kakao?: string
  naverCafe?: string
  naverBlog?: string
  naverTv?: string
  other: { platform: string; url: string }[]
}

// 미디어/이미지 정보
export interface MediaInfo {
  logo?: string
  bannerImages: string[]
  galleryImages: string[]
  videos: { url: string; title: string; platform?: string }[]
  documents: { url: string; title: string; type: string }[]
}

// 예배 시간 정보
export interface WorshipTimeInfo {
  name: string
  day: string
  time: string
  location?: string
  notes?: string
}

export interface TaxonomyNode {
  name: string
  type: string
  children?: TaxonomyNode[]
  metadata?: any
}

export interface CrawlResult {
  success: boolean
  churchId: number
  structure?: SiteStructure
  dictionary?: DictionaryEntry[]
  taxonomy?: TaxonomyNode[]
  popups?: PopupInfo[]
  errors?: string[]
  crawlTime: number
  progress?: CrawlProgress
  // 확장된 정보 요약
  extendedInfo?: {
    contactsCount: number
    socialMediaCount: number
    mediaCount: number
    worshipTimesCount: number
  }
}

// ============ HTML 페칭 ============

/**
 * URL에서 HTML 가져오기
 */
async function fetchHTML(url: string): Promise<string | null> {
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
      },
      redirect: 'follow'
    })

    if (!response.ok) {
      console.error(`[Crawler] HTTP ${response.status}: ${url}`)
      return null
    }

    const html = await response.text()
    return html
  } catch (error: any) {
    console.error(`[Crawler] 페치 실패: ${url}`, error.message)
    return null
  }
}

/**
 * 메타 리다이렉트 감지 및 리다이렉트 URL 반환
 * <meta http-equiv='Refresh' content='0; url=...'> 형식 처리
 */
function detectMetaRedirect(html: string, baseUrl: string): string | null {
  const $ = cheerio.load(html)

  // Meta refresh 태그 확인
  const metaRefresh = $('meta[http-equiv="refresh"], meta[http-equiv="Refresh"]').attr('content')
  if (metaRefresh) {
    // content="0; url=http://example.com" 형식 파싱
    const urlMatch = metaRefresh.match(/url=([^"'\s]+)/i)
    if (urlMatch) {
      const redirectUrl = urlMatch[1]
      console.log(`[Crawler] 메타 리다이렉트 감지: ${redirectUrl}`)
      return redirectUrl.startsWith('http') ? redirectUrl : normalizeUrl(redirectUrl, baseUrl)
    }
  }

  return null
}

/**
 * 인트로/랜딩 페이지 감지 및 실제 메인 페이지 URL 찾기
 * 광림교회 등 인트로 비디오 페이지를 사용하는 사이트 처리
 */
function detectIntroPageAndGetMainUrl(html: string, baseUrl: string): string | null {
  const $ = cheerio.load(html)

  // 먼저 메타 리다이렉트 확인
  const metaRedirectUrl = detectMetaRedirect(html, baseUrl)
  if (metaRedirectUrl) {
    return metaRedirectUrl
  }

  // 인트로 페이지 특징 감지
  const hasNavigation = $('nav, #gnb, .gnb, .menu, header nav').length > 0
  const hasMainContent = $('main, #content, .content, article').length > 0
  const hasVideoIntro = $('.video_wrap, .intro-video, .main-video, [class*="intro"]').length > 0
  const hasMinimalContent = $('body').text().trim().length < 500
  const linkCount = $('a').length

  // 인트로 페이지로 판단되는 경우
  if (!hasNavigation && (hasVideoIntro || (hasMinimalContent && linkCount < 20))) {
    console.log('[Crawler] 인트로 페이지 감지됨')

    // 실제 메인 페이지 링크 찾기
    const mainPagePatterns = [
      'a[href*="index.do"]',
      'a[href*="main.do"]',
      'a[href*="/main/"]',
      'a.btn-close',  // 광림교회 스타일
      'a[href*="home"]',
      '.video_content a',
      '.intro-skip a',
      '.skip-intro a'
    ]

    for (const pattern of mainPagePatterns) {
      const $link = $(pattern).first()
      if ($link.length > 0) {
        const href = $link.attr('href')
        if (href && !href.startsWith('javascript:') && !href.startsWith('#')) {
          const mainUrl = normalizeUrl(href, baseUrl)
          console.log(`[Crawler] 실제 메인 페이지 발견: ${mainUrl}`)
          return mainUrl
        }
      }
    }

    // 패턴에 없는 경우 모든 링크에서 찾기
    const allLinks: string[] = []
    $('a').each((i, el) => {
      const href = $(el).attr('href')
      if (href && !href.startsWith('javascript:') && !href.startsWith('#') &&
          (href.includes('index') || href.includes('main') || href.includes('home'))) {
        allLinks.push(href)
      }
    })

    if (allLinks.length > 0) {
      const mainUrl = normalizeUrl(allLinks[0], baseUrl)
      console.log(`[Crawler] 메인 페이지 후보 발견: ${mainUrl}`)
      return mainUrl
    }
  }

  return null
}

/**
 * iframe 기반 사이트 감지 및 실제 콘텐츠 URL 반환
 * 꽃동산교회 등 iframe으로 콘텐츠를 로드하는 사이트 처리
 */
function detectIframeAndGetContentUrl(html: string, baseUrl: string): string | null {
  const $ = cheerio.load(html)

  // 메인 콘텐츠가 iframe인지 확인
  const $mainIframe = $('iframe#mainFrame, iframe[name="mainFrame"], .mainLayer iframe, body > div > iframe').first()

  if ($mainIframe.length > 0) {
    const src = $mainIframe.attr('src')
    if (src) {
      console.log(`[Crawler] iframe 기반 사이트 감지: ${src}`)
      return normalizeUrl(src, baseUrl)
    }
  }

  // 전체 페이지가 거의 iframe만 있는 경우
  const bodyText = $('body').text().trim()
  const $iframes = $('iframe')
  if (bodyText.length < 200 && $iframes.length > 0) {
    const src = $iframes.first().attr('src')
    if (src && !src.includes('youtube') && !src.includes('vimeo')) {
      console.log(`[Crawler] iframe 전용 페이지 감지: ${src}`)
      return normalizeUrl(src, baseUrl)
    }
  }

  return null
}

/**
 * XML 메뉴 파일에서 네비게이션 추출
 * 꽃동산교회 등 XML 기반 메뉴 사용 사이트 처리
 */
async function parseXMLMenu(xmlUrl: string, baseUrl: string): Promise<PageInfo[]> {
  const navigation: PageInfo[] = []

  try {
    const xmlContent = await fetchHTML(xmlUrl)
    if (!xmlContent) return navigation

    const $ = cheerio.load(xmlContent, { xmlMode: true })

    // Base64 디코딩 함수
    const decodeBase64 = (str: string): string => {
      try {
        return Buffer.from(str, 'base64').toString('utf8')
      } catch {
        return str
      }
    }

    // depth1 메뉴 파싱
    $('depth1').each((i, depth1El) => {
      const $depth1 = $(depth1El)
      const name = decodeBase64($depth1.attr('name') || '')
      const link = decodeURIComponent($depth1.attr('link') || '')
      const isDisplay = $depth1.attr('isDisplay')

      if (isDisplay === 'N' || !name) return

      const menuItem: PageInfo = {
        url: link ? normalizeUrl(link, baseUrl) : '',
        title: name,
        pageType: 'menu',
        depth: 1,
        children: []
      }

      // depth2 메뉴 파싱
      $depth1.find('depth2').each((j, depth2El) => {
        const $depth2 = $(depth2El)
        const subName = decodeBase64($depth2.attr('name') || '')
        const subLink = decodeURIComponent($depth2.attr('link') || '')
        const subDisplay = $depth2.attr('isDisplay')

        if (subDisplay === 'N' || !subName) return

        const subMenuItem: PageInfo = {
          url: subLink ? normalizeUrl(subLink, baseUrl) : '',
          title: subName,
          pageType: 'submenu',
          depth: 2,
          parentUrl: menuItem.url,
          children: []
        }

        // depth3 메뉴 파싱
        $depth2.find('depth3').each((k, depth3El) => {
          const $depth3 = $(depth3El)
          const thirdName = decodeBase64($depth3.attr('name') || '')
          const thirdLink = decodeURIComponent($depth3.attr('link') || '')
          const thirdDisplay = $depth3.attr('isDisplay')

          if (thirdDisplay === 'N' || !thirdName) return

          subMenuItem.children?.push({
            url: thirdLink ? normalizeUrl(thirdLink, baseUrl) : '',
            title: thirdName,
            pageType: 'content',
            depth: 3,
            parentUrl: subMenuItem.url
          })
        })

        menuItem.children?.push(subMenuItem)
      })

      navigation.push(menuItem)
    })

    if (navigation.length > 0) {
      console.log(`[Crawler] XML 메뉴에서 ${navigation.length}개 1차 메뉴 추출`)
    }
  } catch (error: any) {
    console.error(`[Crawler] XML 메뉴 파싱 오류: ${error.message}`)
  }

  return navigation
}

/**
 * XML 메뉴 파일 URL 감지
 */
async function detectXMLMenuUrl(html: string, baseUrl: string): Promise<string | null> {
  // JavaScript 코드에서 XML 메뉴 경로 찾기
  const xmlPatterns = [
    /xmlFile\s*=\s*["']([^"']+\.xml[^"']*)/,
    /menu\.xml/,
    /sitemap\.xml/
  ]

  for (const pattern of xmlPatterns) {
    const match = html.match(pattern)
    if (match) {
      const xmlPath = match[1] || match[0]
      return normalizeUrl(xmlPath, baseUrl)
    }
  }

  const $ = cheerio.load(html)
  const scripts = $('script').text()

  // 일반적인 XML 메뉴 경로 시도
  const commonPaths = [
    '/core/xml/menu.xml.html',
    '/xml/menu.xml',
    '/data/menu.xml'
  ]

  for (const path of commonPaths) {
    if (scripts.includes(path) || scripts.includes(path.replace(/\//g, '\\/'))) {
      return normalizeUrl(path, baseUrl)
    }
  }

  // menu.js 스크립트 파일이 있는지 확인하고 해당 파일에서 XML 경로 찾기
  const menuScriptSrc = $('script[src*="menu"]').attr('src')
  if (menuScriptSrc) {
    try {
      const menuScriptUrl = normalizeUrl(menuScriptSrc, baseUrl)
      const menuScriptContent = await fetchHTML(menuScriptUrl)
      if (menuScriptContent) {
        const xmlFileMatch = menuScriptContent.match(/this\.xmlFile\s*=\s*["']([^"']+)["']/) ||
                            menuScriptContent.match(/xmlFile\s*=\s*["']([^"']+)["']/)
        if (xmlFileMatch) {
          const xmlPath = xmlFileMatch[1]
          console.log(`[Crawler] menu.js에서 XML 경로 발견: ${xmlPath}`)
          return normalizeUrl(xmlPath, baseUrl)
        }
      }
    } catch (e) {
      // 무시
    }
  }

  // 일반적인 XML 메뉴 경로 직접 시도 (마지막 수단)
  for (const path of commonPaths) {
    try {
      const testUrl = normalizeUrl(path, baseUrl)
      const response = await fetch(testUrl, {
        method: 'HEAD',
        headers: { 'User-Agent': 'Mozilla/5.0' }
      })
      if (response.ok) {
        console.log(`[Crawler] XML 메뉴 파일 발견: ${testUrl}`)
        return testUrl
      }
    } catch (e) {
      // 무시
    }
  }

  return null
}

/**
 * URL 정규화
 */
function normalizeUrl(url: string, baseUrl: string): string {
  try {
    // 상대 경로 처리
    if (url.startsWith('/')) {
      const base = new URL(baseUrl)
      return `${base.protocol}//${base.host}${url}`
    }
    // 절대 경로 확인
    if (url.startsWith('http://') || url.startsWith('https://')) {
      return url
    }
    // 프로토콜 없는 경우
    if (url.startsWith('//')) {
      return `https:${url}`
    }
    // 상대 경로
    return new URL(url, baseUrl).href
  } catch {
    return url
  }
}

/**
 * 같은 도메인인지 확인
 */
function isSameDomain(url: string, baseUrl: string): boolean {
  try {
    const urlObj = new URL(url)
    const baseObj = new URL(baseUrl)
    return urlObj.hostname === baseObj.hostname
  } catch {
    return false
  }
}

// ============ HTML 파싱 ============

/**
 * 네비게이션 메뉴 추출 (강화된 버전)
 */
function extractNavigation(html: string, baseUrl: string): PageInfo[] {
  const $ = cheerio.load(html)
  const navigation: PageInfo[] = []
  const seenUrls = new Set<string>()

  // 1. 일반적인 네비게이션 선택자들
  const navSelectors = [
    // 기본 nav 요소
    'nav', 'header nav', '#gnb', '.gnb', '#nav', '.nav',
    '#menu', '.menu', '.main-menu', '.main_menu', '.main-nav',
    '#header nav', '.header nav', '.navigation', '.top-menu',
    // depth 기반 클래스
    'ul.depth1', 'ul.lnb', 'ul.gnb', '.menu-depth1',
    // 특정 사이트 패턴
    '#site_menus', '.site_menu', '#topMenu', '.gnb-menu',
    // div 기반 메뉴
    '.menu-wrap', '.nav-wrap', '.gnb-wrap', '#gnb-wrap',
    // 사랑의교회, 온누리교회 등
    '.header-menu', '.header_menu', '.top-nav', '#top-nav',
    '.allmenu', '#all-menu', '.all-menu',
    // 광림교회 스타일
    'ul.gnb-ul', '.gnb-ul'
  ]

  // 2. 서브메뉴 선택자들
  const subMenuSelectors = [
    '> ul > li', '> .sub > li', '> .submenu > li', '> .sub-menu > li',
    '> .depth2 > li', '> ul.depth2 > li', '> div > ul > li',
    '> .sub-wrap > ul > li', '> .gnb-sub > li', '> .lnb > li',
    // 광림교회 스타일
    '> .gnb-inner > .sub-mn > li', '.gnb-inner .sub-mn > li'
  ]

  // 3. 3차 메뉴 선택자들
  const thirdLevelSelectors = [
    '> ul > li', '> .sub > li', '> .depth3 > li', '> ul.depth3 > li',
    '> .third-menu > li', '> div > ul > li',
    // 광림교회 스타일
    '> .sub-mn02 > li', '.sub-mn02 > li'
  ]

  // 헬퍼: 메뉴 아이템 생성
  function createMenuItem(href: string | undefined, title: string, depth: number, parentUrl?: string): PageInfo | null {
    if (!title || title.length === 0 || title.length > 100) return null

    const url = href ? normalizeUrl(href, baseUrl) : ''
    if (url && seenUrls.has(url)) return null
    if (url) seenUrls.add(url)

    return {
      url,
      title: title.replace(/\s+/g, ' ').trim(),
      pageType: depth === 1 ? 'menu' : (depth === 2 ? 'submenu' : 'content'),
      depth,
      parentUrl,
      children: []
    }
  }

  // 헬퍼: 링크 텍스트 추출
  function getLinkText($link: cheerio.Cheerio<any>): string {
    // span, strong 등 내부 요소 텍스트 우선
    const spanText = $link.find('span, strong, em').first().text().trim()
    if (spanText) return spanText

    // 직접 텍스트
    return $link.clone().children().remove().end().text().trim() || $link.text().trim()
  }

  // 방법 1: 표준 nav 구조 탐색
  for (const selector of navSelectors) {
    const nav = $(selector).first()
    if (nav.length === 0) continue

    // 직접 a 태그가 있는 경우 (예: #site_menus > a.site_menu)
    const directLinks = nav.find('> a')
    if (directLinks.length > 0) {
      directLinks.each((i, el) => {
        const $link = $(el)
        const href = $link.attr('href')
        const title = getLinkText($link)
        const menuItem = createMenuItem(href, title, 1)
        if (menuItem) navigation.push(menuItem)
      })
      if (navigation.length > 0) break
    }

    // 1차 메뉴 추출 (다양한 구조 지원)
    const depth1Items = nav.find('> ul > li, > li, > div > ul > li, > div > li')
    if (depth1Items.length === 0) continue

    depth1Items.each((i, el) => {
      const $li = $(el)
      const $link = $li.find('> a').first()
      if ($link.length === 0) return

      const href = $link.attr('href')
      const title = getLinkText($link)
      const menuItem = createMenuItem(href, title, 1)
      if (!menuItem) return

      // 2차 메뉴 추출 (여러 선택자 시도)
      for (const subSelector of subMenuSelectors) {
        const subItems = $li.find(subSelector)
        if (subItems.length === 0) continue

        subItems.each((j, subEl) => {
          const $subLi = $(subEl)
          const $subLink = $subLi.find('> a').first()
          if ($subLink.length === 0) return

          const subHref = $subLink.attr('href')
          const subTitle = getLinkText($subLink)
          const subMenuItem = createMenuItem(subHref, subTitle, 2, menuItem.url)
          if (!subMenuItem) return

          // 3차 메뉴 추출
          for (const thirdSelector of thirdLevelSelectors) {
            const thirdItems = $subLi.find(thirdSelector)
            thirdItems.each((k, thirdEl) => {
              const $thirdLi = $(thirdEl)
              const $thirdLink = $thirdLi.find('> a').first()
              if ($thirdLink.length === 0) return

              const thirdHref = $thirdLink.attr('href')
              const thirdTitle = getLinkText($thirdLink)
              const thirdItem = createMenuItem(thirdHref, thirdTitle, 3, subMenuItem.url)
              if (thirdItem) subMenuItem.children?.push(thirdItem)
            })
            if (subMenuItem.children && subMenuItem.children.length > 0) break
          }

          menuItem.children?.push(subMenuItem)
        })
        if (menuItem.children && menuItem.children.length > 0) break
      }

      navigation.push(menuItem)
    })

    if (navigation.length > 0) break
  }

  // 방법 2: depth 클래스 기반 메뉴 추출
  if (navigation.length === 0) {
    const depth1Menu = $('.depth1, .menu-depth1, [class*="depth1"]').first()
    if (depth1Menu.length > 0) {
      depth1Menu.find('> li, > a').each((i, el) => {
        const $el = $(el)
        const $link = el.tagName === 'a' ? $el : $el.find('> a').first()
        if ($link.length === 0) return

        const href = $link.attr('href')
        const title = getLinkText($link)
        const menuItem = createMenuItem(href, title, 1)
        if (!menuItem) return

        // depth2 찾기
        const $depth2 = $el.find('.depth2, .sub-menu, [class*="depth2"]')
        $depth2.find('> li, > a').each((j, subEl) => {
          const $subEl = $(subEl)
          const $subLink = subEl.tagName === 'a' ? $subEl : $subEl.find('> a').first()
          if ($subLink.length === 0) return

          const subHref = $subLink.attr('href')
          const subTitle = getLinkText($subLink)
          const subMenuItem = createMenuItem(subHref, subTitle, 2, menuItem.url)
          if (subMenuItem) menuItem.children?.push(subMenuItem)
        })

        navigation.push(menuItem)
      })
    }
  }

  // 방법 3: data-* 속성 기반 메뉴 추출
  if (navigation.length === 0) {
    $('[data-menu], [data-nav], [data-depth="1"]').each((i, el) => {
      const $el = $(el)
      const $link = $el.is('a') ? $el : $el.find('a').first()
      if ($link.length === 0) return

      const href = $link.attr('href') || $el.attr('data-href') || $el.attr('data-url')
      const title = getLinkText($link) || $el.attr('data-title') || ''
      const menuItem = createMenuItem(href, title, 1)
      if (menuItem) navigation.push(menuItem)
    })
  }

  // 방법 4: 메가 메뉴 패턴 (전체 메뉴 레이어)
  if (navigation.length === 0) {
    const megaMenuSelectors = [
      '.mega-menu', '.all-menu', '#all-menu', '.total-menu', '#total-menu',
      '.full-menu', '.allmenu-wrap', '.sitemap'
    ]

    for (const selector of megaMenuSelectors) {
      const $mega = $(selector)
      if ($mega.length === 0) continue

      // 섹션별 메뉴 추출
      $mega.find('.menu-section, .menu-group, .menu-category, > div, > section').each((i, section) => {
        const $section = $(section)
        const sectionTitle = $section.find('h2, h3, h4, .title, .menu-title').first().text().trim()

        const menuItem: PageInfo = {
          url: '',
          title: sectionTitle || `메뉴 ${i + 1}`,
          pageType: 'menu',
          depth: 1,
          children: []
        }

        $section.find('a').each((j, link) => {
          const $link = $(link)
          const href = $link.attr('href')
          const title = getLinkText($link)
          const subMenuItem = createMenuItem(href, title, 2, menuItem.url)
          if (subMenuItem) menuItem.children?.push(subMenuItem)
        })

        if (menuItem.children && menuItem.children.length > 0) {
          navigation.push(menuItem)
        }
      })

      if (navigation.length > 0) break
    }
  }

  // 방법 5: Bootstrap navbar 패턴 (사랑의교회 등)
  if (navigation.length === 0) {
    const $navbar = $('nav.navbar, .navbar-nav, ul.navbar-nav').first()
    if ($navbar.length > 0) {
      $navbar.find('> li.nav-item, > .nav-item').each((i, el) => {
        const $item = $(el)
        const $link = $item.find('> a.nav-link').first()
        if ($link.length === 0) return

        const href = $link.attr('href')
        const title = getLinkText($link)
        const menuItem = createMenuItem(href, title, 1)
        if (!menuItem) return

        // 드롭다운 메뉴 (mega-menu 포함)
        const $dropdown = $item.find('.dropdown-menu, .mega-menu')
        $dropdown.find('a').each((j, subEl) => {
          const $subLink = $(subEl)
          const subHref = $subLink.attr('href')
          if (!subHref || subHref === '#') return
          const subTitle = getLinkText($subLink)
          const subItem = createMenuItem(subHref, subTitle, 2, menuItem.url)
          if (subItem) menuItem.children?.push(subItem)
        })

        navigation.push(menuItem)
      })
    }
  }

  // 방법 6: 온누리교회 스타일 (.gnb, .gnbul + panel 기반)
  if (navigation.length === 0) {
    // gnbul 메뉴 찾기
    const $gnbul = $('ul.gnbul, .gnbul').first()
    if ($gnbul.length > 0) {
      $gnbul.find('> li').each((i, el) => {
        const $item = $(el)
        const $link = $item.find('> a').first()
        if ($link.length === 0) return

        const href = $link.attr('href') || ''
        const title = getLinkText($link)
        const menuItem = createMenuItem(href.startsWith('#') ? '' : href, title, 1)
        if (!menuItem) return

        // 패널 ID 추출 (예: #panel01 -> panel01)
        const panelId = href.startsWith('#') ? href.substring(1) : `panel0${i + 1}`
        const $panel = $(`#${panelId}`)

        if ($panel.length > 0) {
          // 온누리교회 스타일: div.el > h4 > a, ul.lst > li > a
          $panel.find('h4 > a, .el h4 a').each((j, subEl) => {
            const $subLink = $(subEl)
            const subHref = $subLink.attr('href')
            if (!subHref || subHref === '#' || subHref.startsWith('javascript:')) return
            const subTitle = getLinkText($subLink).replace(/more$/i, '').trim()
            const subItem = createMenuItem(subHref, subTitle, 2, menuItem.url)
            if (subItem) menuItem.children?.push(subItem)
          })

          // 리스트 아이템들
          $panel.find('ul.lst a, .lst a').each((j, subEl) => {
            const $subLink = $(subEl)
            const subHref = $subLink.attr('href')
            if (!subHref || subHref === '#' || subHref.startsWith('javascript:')) return
            const subTitle = getLinkText($subLink)
            const subItem = createMenuItem(subHref, subTitle, 3, menuItem.url)
            if (subItem) menuItem.children?.push(subItem)
          })

          // 일반 링크들
          $panel.find('a').each((j, subEl) => {
            const $subLink = $(subEl)
            const subHref = $subLink.attr('href')
            if (!subHref || subHref === '#' || subHref.startsWith('javascript:')) return
            const subTitle = getLinkText($subLink).replace(/more$/i, '').trim()
            if (!subTitle || menuItem.children?.some(c => c.url === normalizeUrl(subHref, baseUrl))) return
            const subItem = createMenuItem(subHref, subTitle, 2, menuItem.url)
            if (subItem) menuItem.children?.push(subItem)
          })
        }

        navigation.push(menuItem)
      })
    }

    // 일반 .gnb 메뉴
    if (navigation.length === 0) {
      const $gnb = $('nav.gnb, .gnb, #gnb').first()
      if ($gnb.length > 0) {
        const $depth1Items = $gnb.find('> ul > li, .gnbul > li')
        $depth1Items.each((i, el) => {
          const $item = $(el)
          const $link = $item.find('> a').first()
          if ($link.length === 0) return

          const href = $link.attr('href')
          const title = getLinkText($link)
          const menuItem = createMenuItem(href, title, 1)
          if (!menuItem) return

          // 일반 서브메뉴
          $item.find('> ul > li > a, > .sub > li > a').each((j, subEl) => {
            const $subLink = $(subEl)
            const subHref = $subLink.attr('href')
            if (!subHref || subHref === '#') return
            const subTitle = getLinkText($subLink)
            const subItem = createMenuItem(subHref, subTitle, 2, menuItem.url)
            if (subItem) menuItem.children?.push(subItem)
          })

          navigation.push(menuItem)
        })
      }
    }
  }

  // 방법 7: 메가 메뉴 패널 직접 탐색
  if (navigation.length === 0 || navigation.every(n => !n.children || n.children.length === 0)) {
    // 메가 메뉴 패널에서 직접 링크 수집
    $('.mega-menu, .mega-menu-content, .dropdown-menu').each((i, el) => {
      const $menu = $(el)
      // 패널 제목 찾기
      const panelTitle = $menu.closest('li').find('> a').first().text().trim() ||
                        $menu.find('h2, h3, h4, .title').first().text().trim() ||
                        `메뉴 ${i + 1}`

      // 기존 네비게이션에서 해당 메뉴 찾기
      let menuItem: PageInfo | undefined = navigation.find(n => n.title === panelTitle)
      if (!menuItem) {
        const newItem = createMenuItem('', panelTitle, 1)
        if (newItem) {
          navigation.push(newItem)
          menuItem = newItem
        }
      }
      if (!menuItem) return

      // 패널 내 링크 수집
      $menu.find('a').each((j, linkEl) => {
        const $link = $(linkEl)
        const href = $link.attr('href')
        if (!href || href === '#' || href.startsWith('javascript:')) return
        const title = getLinkText($link)
        if (!title) return

        // 중복 확인
        if (!menuItem!.children?.some(c => c.title === title)) {
          const subItem = createMenuItem(href, title, 2, menuItem!.url)
          if (subItem) menuItem!.children?.push(subItem)
        }
      })
    })
  }

  // 방법 8: 헤더 영역 모든 링크 수집 (최후의 수단)
  if (navigation.length === 0) {
    const headerLinks = $('header a, #header a, .header a').filter((i, el) => {
      const href = $(el).attr('href') || ''
      // 로그인, 검색 등 유틸리티 링크 제외
      if (/login|search|member|join|signup/i.test(href)) return false
      if (href.startsWith('#') || href.startsWith('javascript:')) return false
      return true
    })

    headerLinks.each((i, el) => {
      const $link = $(el)
      const href = $link.attr('href')
      const title = getLinkText($link)
      const menuItem = createMenuItem(href, title, 1)
      if (menuItem) navigation.push(menuItem)
    })
  }

  return navigation
}

/**
 * 팝업/모달 URL 감지
 */
function detectPopups(html: string, baseUrl: string): PopupInfo[] {
  const $ = cheerio.load(html)
  const popups: PopupInfo[] = []
  const seenUrls = new Set<string>()

  // 1. onclick 속성에서 URL 추출
  $('[onclick]').each((i, el) => {
    const onclick = $(el).attr('onclick') || ''
    const title = $(el).text().trim() || $(el).attr('title') || '팝업'

    // window.open 패턴
    const windowOpenMatch = onclick.match(/window\.open\s*\(\s*['"]([^'"]+)['"]/i)
    if (windowOpenMatch) {
      const url = normalizeUrl(windowOpenMatch[1], baseUrl)
      if (!seenUrls.has(url) && isSameDomain(url, baseUrl)) {
        seenUrls.add(url)
        popups.push({
          url,
          title,
          triggerType: 'window.open',
          triggerElement: el.tagName
        })
      }
    }

    // location.href 패턴
    const locationMatch = onclick.match(/location\.href\s*=\s*['"]([^'"]+)['"]/i)
    if (locationMatch) {
      const url = normalizeUrl(locationMatch[1], baseUrl)
      if (!seenUrls.has(url) && isSameDomain(url, baseUrl)) {
        seenUrls.add(url)
        popups.push({
          url,
          title,
          triggerType: 'onclick',
          triggerElement: el.tagName
        })
      }
    }

    // 일반 함수 호출에서 URL 추출
    const funcMatch = onclick.match(/['"]([^'"]*(?:popup|layer|modal|view|detail)[^'"]*)['"]/i)
    if (funcMatch && funcMatch[1].includes('/')) {
      const url = normalizeUrl(funcMatch[1], baseUrl)
      if (!seenUrls.has(url) && isSameDomain(url, baseUrl)) {
        seenUrls.add(url)
        popups.push({
          url,
          title,
          triggerType: 'onclick',
          triggerElement: el.tagName
        })
      }
    }
  })

  // 2. data-* 속성에서 URL 추출
  const dataAttrs = ['data-url', 'data-href', 'data-link', 'data-popup', 'data-src', 'data-target-url']
  for (const attr of dataAttrs) {
    $(`[${attr}]`).each((i, el) => {
      const value = $(el).attr(attr) || ''
      if (value.startsWith('/') || value.startsWith('http')) {
        const url = normalizeUrl(value, baseUrl)
        const title = $(el).text().trim() || $(el).attr('title') || '팝업'
        if (!seenUrls.has(url) && isSameDomain(url, baseUrl)) {
          seenUrls.add(url)
          popups.push({
            url,
            title,
            triggerType: 'data-url',
            triggerElement: (el as any).tagName || 'unknown'
          })
        }
      }
    })
  }

  // 3. javascript: href에서 URL 추출
  $('a[href^="javascript:"]').each((i, el) => {
    const href = $(el).attr('href') || ''
    const title = $(el).text().trim() || '팝업'

    // URL 패턴 추출
    const urlMatch = href.match(/['"]([^'"]+\.[a-z]{2,4}(?:\?[^'"]*)?)['"]/i)
    if (urlMatch) {
      const url = normalizeUrl(urlMatch[1], baseUrl)
      if (!seenUrls.has(url) && isSameDomain(url, baseUrl)) {
        seenUrls.add(url)
        popups.push({
          url,
          title,
          triggerType: 'href',
          triggerElement: 'a'
        })
      }
    }
  })

  // 4. 레이어/모달 트리거 버튼 감지
  $('[data-toggle="modal"], [data-bs-toggle="modal"], .layer-open, .popup-open, .modal-trigger').each((i, el) => {
    const target = $(el).attr('data-target') || $(el).attr('data-bs-target') || $(el).attr('href')
    if (target && target.startsWith('#')) {
      // 레이어 팝업 (인라인)
      const layerContent = $(target).html()
      if (layerContent) {
        popups.push({
          url: target,
          title: $(el).text().trim() || '레이어 팝업',
          triggerType: 'layer',
          triggerElement: el.tagName
        })
      }
    }
  })

  return popups
}

/**
 * 페이지에서 추가 링크 추출 (깊은 크롤링용)
 */
function extractLinksFromPage(html: string, baseUrl: string, currentDepth: number): PageInfo[] {
  const $ = cheerio.load(html)
  const links: PageInfo[] = []
  const seenUrls = new Set<string>()

  // 콘텐츠 영역의 링크 추출
  const contentSelectors = [
    'main', '#content', '.content', '#container', '.container',
    'article', '.article', '.board-list', '.list-wrap',
    '.sub-content', '.page-content', '#sub', '.sub'
  ]

  let $content: cheerio.Cheerio<any> = $('body')
  for (const selector of contentSelectors) {
    const $found = $(selector)
    if ($found.length > 0) {
      $content = $found
      break
    }
  }

  $content.find('a[href]').each((i, el) => {
    const href = $(el).attr('href')
    if (!href) return

    // 스킵할 패턴
    if (href.startsWith('#') ||
        href.startsWith('javascript:void') ||
        href.startsWith('mailto:') ||
        href.startsWith('tel:') ||
        href === '#') {
      return
    }

    const url = normalizeUrl(href, baseUrl)
    if (seenUrls.has(url)) return
    if (!isSameDomain(url, baseUrl)) return

    seenUrls.add(url)

    const title = $(el).text().trim() || $(el).attr('title') || url.split('/').pop() || ''
    if (!title || title.length > 200) return

    // 페이지 타입 추론
    let pageType: PageInfo['pageType'] = 'content'
    let contentType: PageInfo['contentType'] = 'static'

    if (/board|bbs|notice|news/i.test(url)) {
      pageType = 'board'
      contentType = 'board'
    } else if (/gallery|photo|album/i.test(url)) {
      contentType = 'gallery'
    } else if (/video|vod|media/i.test(url)) {
      contentType = 'video'
    } else if (/list|archive/i.test(url)) {
      contentType = 'list'
    }

    links.push({
      url,
      title,
      pageType,
      depth: currentDepth + 1,
      parentUrl: baseUrl,
      contentType,
      children: []
    })
  })

  return links
}

/**
 * 딥 크롤링: 실제로 각 페이지를 방문하여 콘텐츠 추출
 */
async function deepCrawlPages(
  pages: PageInfo[],
  baseUrl: string,
  options: {
    maxDepth: number
    maxPages: number
    delayMs?: number
    onProgress?: (progress: CrawlProgress) => void
  }
): Promise<{
  crawledPages: PageInfo[]
  allPopups: PopupInfo[]
  dictionary: DictionaryEntry[]
  errors: string[]
}> {
  const visitedUrls = new Set<string>()
  const allPopups: PopupInfo[] = []
  const dictionary: DictionaryEntry[] = []
  const errors: string[] = []
  const crawledPages: PageInfo[] = []

  const delayMs = options.delayMs || 500  // 서버 부하 방지

  // BFS 방식으로 크롤링
  const queue: PageInfo[] = [...pages]
  let crawledCount = 0

  while (queue.length > 0 && crawledCount < options.maxPages) {
    const page = queue.shift()!

    // 이미 방문했거나 깊이 초과시 스킵
    if (visitedUrls.has(page.url) || page.depth > options.maxDepth) {
      continue
    }

    // URL이 없거나 외부 링크면 스킵
    if (!page.url || page.pageType === 'external' || !isSameDomain(page.url, baseUrl)) {
      continue
    }

    visitedUrls.add(page.url)
    crawledCount++

    // 진행 상황 콜백
    if (options.onProgress) {
      options.onProgress({
        totalPages: queue.length + crawledCount,
        crawledPages: crawledCount,
        currentUrl: page.url,
        currentDepth: page.depth,
        errors
      })
    }

    console.log(`[DeepCrawl] (${crawledCount}/${options.maxPages}) depth:${page.depth} ${page.url}`)

    try {
      // 페이지 fetch
      const html = await fetchHTML(page.url)

      if (!html) {
        page.crawlError = '페이지 로드 실패'
        errors.push(`${page.url}: 로드 실패`)
        continue
      }

      page.crawled = true

      // 팝업 감지
      const pagePopups = detectPopups(html, baseUrl)
      allPopups.push(...pagePopups)

      // 페이지 메타데이터 추출
      page.extractedData = extractPageMetadata(html)

      // 추가 링크 추출 (다음 depth로)
      if (page.depth < options.maxDepth) {
        const childLinks = extractLinksFromPage(html, page.url, page.depth)

        // 중복되지 않은 링크만 큐에 추가
        for (const link of childLinks) {
          if (!visitedUrls.has(link.url)) {
            page.children = page.children || []
            page.children.push(link)
            queue.push(link)
          }
        }
      }

      // 인물 정보 페이지면 AI로 상세 추출
      const peopleKeywords = [
        // 직분 관련
        '목사', '장로', '전도사', '사역자', '교역자', '집사', '권사', '담임',
        // 페이지 유형 관련
        '소개', '인사', '교역', '섬기는', '직원', 'staff', 'pastor', 'minister',
        'greetings', 'introduction', 'about', 'leadership', 'team'
      ]
      const pageText = (page.title + ' ' + page.url).toLowerCase()
      if (peopleKeywords.some(kw => pageText.includes(kw.toLowerCase()))) {
        const people = await extractPeopleFromPage(html, page.url, '인물')
        dictionary.push(...people)
        console.log(`[DeepCrawl] 인물 정보 추출: ${page.title} - ${people.length}명`)
      }

      // 조직/부서 정보 페이지 감지 및 추출
      const orgKeywords = [
        // 조직 구조 관련
        '조직', '기구', '부서', '사역', 'organization', 'ministry', 'department', 'org',
        // 부서 유형
        '선교부', '교육부', '찬양', '미디어', '복지', '긍휼', '양육', '전도', '봉사',
        '서무', '총무', '기획', '재정', '관리',
        // 교구/지역 조직
        '교구', '권역', '구역', '셀', '목장', '소그룹', 'district', 'cell', 'zone',
        // 페이지 유형
        '각부서', '부서안내', '사역팀', '사역안내', '조직안내', '조직도',
        '봉사팀', '봉사부서', 'ministries', 'departments', 'teams'
      ]

      if (orgKeywords.some(kw => pageText.includes(kw.toLowerCase()))) {
        console.log(`[DeepCrawl] 조직/부서 페이지 감지: ${page.title}`)
        // 해당 페이지에서 부서/조직 정보 추출
        const orgDict = extractOrganizationFromPage(html, page.url)
        // 중복 제거하며 추가
        for (const entry of orgDict) {
          if (!dictionary.some(d => d.term === entry.term && d.category === entry.category)) {
            dictionary.push(entry)
          }
        }
        console.log(`[DeepCrawl] 조직/부서 정보 추출: ${page.title} - ${orgDict.length}개`)
      }

      // 모든 페이지에서 HTML 패턴 기반 사전 추출 시도 (10페이지마다)
      if (crawledCount % 10 === 1 || page.depth === 1) {
        const pageDict = extractDictionaryFromHTML(html, page.url)
        // 중복 제거하며 추가
        for (const entry of pageDict) {
          if (!dictionary.some(d => d.term === entry.term && d.category === entry.category)) {
            dictionary.push(entry)
          }
        }
      }

      crawledPages.push(page)

      // 딜레이
      if (delayMs > 0) {
        await new Promise(resolve => setTimeout(resolve, delayMs))
      }

    } catch (error: any) {
      page.crawlError = error.message
      errors.push(`${page.url}: ${error.message}`)
    }
  }

  // 팝업 페이지도 크롤링
  for (const popup of allPopups) {
    if (visitedUrls.has(popup.url) || crawledCount >= options.maxPages) continue
    if (popup.triggerType === 'layer') continue  // 인라인 레이어는 스킵

    visitedUrls.add(popup.url)
    crawledCount++

    console.log(`[DeepCrawl] 팝업 크롤링: ${popup.url}`)

    try {
      const html = await fetchHTML(popup.url)
      if (html) {
        const popupPage: PageInfo = {
          url: popup.url,
          title: popup.title,
          pageType: 'popup',
          depth: 0,
          contentType: 'popup',
          extractedData: extractPageMetadata(html),
          crawled: true
        }
        crawledPages.push(popupPage)
      }

      if (delayMs > 0) {
        await new Promise(resolve => setTimeout(resolve, delayMs))
      }
    } catch (error: any) {
      errors.push(`팝업 ${popup.url}: ${error.message}`)
    }
  }

  return { crawledPages, allPopups, dictionary, errors }
}

/**
 * 게시판 감지
 */
function detectBoards(html: string, baseUrl: string): PageInfo[] {
  const $ = cheerio.load(html)
  const boards: PageInfo[] = []

  // 게시판 URL 패턴
  const boardPatterns = [
    /\/board\//i, /\/bbs\//i, /\/notice/i, /\/news/i,
    /\/gallery/i, /\/photo/i, /\/video/i,
    /board\.php/i, /bbs\.php/i, /list\.php/i
  ]

  $('a[href]').each((i, el) => {
    const href = $(el).attr('href')
    if (!href) return

    const fullUrl = normalizeUrl(href, baseUrl)
    if (!isSameDomain(fullUrl, baseUrl)) return

    for (const pattern of boardPatterns) {
      if (pattern.test(fullUrl)) {
        const title = $(el).text().trim() || fullUrl.split('/').pop() || '게시판'

        // 중복 체크
        if (!boards.find(b => b.url === fullUrl)) {
          boards.push({
            url: fullUrl,
            title,
            pageType: 'board',
            depth: 0,
            contentType: 'board'
          })
        }
        break
      }
    }
  })

  return boards
}

/**
 * 페이지 메타데이터 추출
 */
function extractPageMetadata(html: string): any {
  const $ = cheerio.load(html)

  return {
    title: $('title').text().trim(),
    description: $('meta[name="description"]').attr('content') || '',
    keywords: $('meta[name="keywords"]').attr('content') || '',
    ogTitle: $('meta[property="og:title"]').attr('content') || '',
    ogImage: $('meta[property="og:image"]').attr('content') || '',
    favicon: $('link[rel="icon"]').attr('href') || $('link[rel="shortcut icon"]').attr('href') || '',
    charset: $('meta[charset]').attr('charset') || 'utf-8',
    viewport: $('meta[name="viewport"]').attr('content') || ''
  }
}

/**
 * 연락처 정보 추출
 */
function extractContactInfo(html: string): ContactInfo {
  const $ = cheerio.load(html)
  const phones: string[] = []
  const emails: string[] = []
  let fax: string | undefined
  let address: string | undefined
  let postalCode: string | undefined

  // 전화번호 패턴
  const phonePatterns = [
    /0\d{1,2}[-).\s]?\d{3,4}[-).\s]?\d{4}/g,  // 02-1234-5678, 031.123.4567
    /\d{3,4}[-).\s]?\d{3,4}[-).\s]?\d{4}/g,    // 1588-1234
    /\(0\d{1,2}\)\s?\d{3,4}[-).\s]?\d{4}/g     // (02) 1234-5678
  ]

  // 이메일 패턴
  const emailPattern = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g

  // 주소 패턴
  const addressPatterns = [
    /(?:서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충북|충남|전북|전남|경북|경남|제주)[^\n<]{10,100}/g,
    /\d{5}\s*[가-힣\s\d-]+/g  // 우편번호 + 주소
  ]

  const bodyText = $('body').text()
  const footerText = $('footer, .footer, #footer').text()
  const contactText = $('[class*="contact"], [class*="address"], [class*="info"]').text()

  // 텍스트에서 패턴 추출
  const allText = footerText + ' ' + contactText + ' ' + bodyText

  // 전화번호 추출
  for (const pattern of phonePatterns) {
    const matches = allText.match(pattern)
    if (matches) {
      for (const match of matches) {
        const cleaned = match.replace(/[\s.()-]/g, '')
        if (cleaned.length >= 9 && cleaned.length <= 12 && !phones.includes(match.trim())) {
          // 팩스 여부 확인
          const beforeMatch = allText.substring(Math.max(0, allText.indexOf(match) - 10), allText.indexOf(match))
          if (/fax|팩스|FAX/i.test(beforeMatch)) {
            fax = match.trim()
          } else {
            phones.push(match.trim())
          }
        }
      }
    }
  }

  // 이메일 추출
  const emailMatches = allText.match(emailPattern)
  if (emailMatches) {
    for (const email of emailMatches) {
      if (!emails.includes(email) && !email.includes('example.com')) {
        emails.push(email)
      }
    }
  }

  // 주소 추출 (footer, contact 영역 우선)
  const addressAreaText = footerText + ' ' + contactText
  for (const pattern of addressPatterns) {
    const matches = addressAreaText.match(pattern)
    if (matches && matches.length > 0) {
      const rawAddress = matches[0].trim()
      // 우편번호 추출
      const postalMatch = rawAddress.match(/\d{5}/)
      if (postalMatch) {
        postalCode = postalMatch[0]
      }
      address = rawAddress.replace(/^\d{5}\s*/, '').trim()
      break
    }
  }

  // tel: href에서 추출
  $('a[href^="tel:"]').each((_, el) => {
    const tel = $(el).attr('href')?.replace('tel:', '').trim()
    if (tel && !phones.includes(tel)) {
      phones.push(tel)
    }
  })

  // mailto: href에서 추출
  $('a[href^="mailto:"]').each((_, el) => {
    const email = $(el).attr('href')?.replace('mailto:', '').split('?')[0].trim()
    if (email && !emails.includes(email)) {
      emails.push(email)
    }
  })

  return {
    phones: phones.slice(0, 5),  // 최대 5개
    emails: emails.slice(0, 3),  // 최대 3개
    fax,
    address,
    postalCode
  }
}

/**
 * 소셜 미디어 링크 추출
 */
function extractSocialMedia(html: string, baseUrl: string): SocialMediaInfo {
  const $ = cheerio.load(html)
  const socialMedia: SocialMediaInfo = { other: [] }

  // 소셜 미디어 플랫폼 패턴
  const platforms: { pattern: RegExp; key: keyof SocialMediaInfo }[] = [
    { pattern: /youtube\.com|youtu\.be/i, key: 'youtube' },
    { pattern: /facebook\.com|fb\.com/i, key: 'facebook' },
    { pattern: /instagram\.com/i, key: 'instagram' },
    { pattern: /twitter\.com|x\.com/i, key: 'twitter' },
    { pattern: /blog\.naver\.com/i, key: 'naverBlog' },
    { pattern: /cafe\.naver\.com/i, key: 'naverCafe' },
    { pattern: /tv\.naver\.com/i, key: 'naverTv' },
    { pattern: /pf\.kakao\.com|story\.kakao\.com|ch\.kakao\.com/i, key: 'kakao' }
  ]

  // 모든 링크에서 소셜 미디어 찾기
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href')
    if (!href) return

    // 외부 링크인지 확인
    if (!href.startsWith('http://') && !href.startsWith('https://') && !href.startsWith('//')) {
      return
    }

    for (const { pattern, key } of platforms) {
      if (pattern.test(href)) {
        if (key !== 'other' && !socialMedia[key]) {
          (socialMedia as any)[key] = href
        }
        return
      }
    }

    // 기타 소셜 미디어 (블로그 등)
    if (/blog|tistory|brunch/i.test(href) && !socialMedia.blog) {
      socialMedia.blog = href
    }
  })

  // 아이콘 기반 소셜 미디어 감지
  $('i[class*="youtube"], .fa-youtube, .icon-youtube, [class*="sns_youtube"]').closest('a').each((_, el) => {
    const href = $(el).attr('href')
    if (href && !socialMedia.youtube) socialMedia.youtube = href
  })

  $('i[class*="facebook"], .fa-facebook, .icon-facebook, [class*="sns_facebook"]').closest('a').each((_, el) => {
    const href = $(el).attr('href')
    if (href && !socialMedia.facebook) socialMedia.facebook = href
  })

  $('i[class*="instagram"], .fa-instagram, .icon-instagram, [class*="sns_instagram"]').closest('a').each((_, el) => {
    const href = $(el).attr('href')
    if (href && !socialMedia.instagram) socialMedia.instagram = href
  })

  return socialMedia
}

/**
 * 미디어 정보 추출
 */
function extractMediaInfo(html: string, baseUrl: string): MediaInfo {
  const $ = cheerio.load(html)
  const media: MediaInfo = {
    bannerImages: [],
    galleryImages: [],
    videos: [],
    documents: []
  }

  // 로고 추출
  const logoSelectors = [
    '.logo img', '#logo img', 'h1 img', '.header-logo img',
    'a.logo img', '[class*="logo"] img', 'header img'
  ]
  for (const selector of logoSelectors) {
    const $logo = $(selector).first()
    if ($logo.length > 0) {
      const src = $logo.attr('src')
      if (src) {
        media.logo = normalizeUrl(src, baseUrl)
        break
      }
    }
  }

  // 배너 이미지 추출
  const bannerSelectors = [
    '.slider img', '.banner img', '.carousel img', '.swiper img',
    '.main-visual img', '.hero img', '.key-visual img',
    '[class*="banner"] img', '[class*="slide"] img'
  ]
  const seenBanners = new Set<string>()
  for (const selector of bannerSelectors) {
    $(selector).each((_, el) => {
      const src = $(el).attr('src') || $(el).attr('data-src')
      if (src) {
        const fullUrl = normalizeUrl(src, baseUrl)
        if (!seenBanners.has(fullUrl)) {
          seenBanners.add(fullUrl)
          media.bannerImages.push(fullUrl)
        }
      }
    })
  }

  // 갤러리 이미지 추출
  const gallerySelectors = [
    '.gallery img', '[class*="gallery"] img', '.photo-list img',
    '.album img', '[class*="photo"] img'
  ]
  const seenGallery = new Set<string>()
  for (const selector of gallerySelectors) {
    $(selector).each((_, el) => {
      const src = $(el).attr('src') || $(el).attr('data-src')
      if (src) {
        const fullUrl = normalizeUrl(src, baseUrl)
        if (!seenGallery.has(fullUrl)) {
          seenGallery.add(fullUrl)
          media.galleryImages.push(fullUrl)
        }
      }
    })
  }

  // 비디오 링크 추출
  $('iframe[src*="youtube"], iframe[src*="youtu.be"]').each((_, el) => {
    const src = $(el).attr('src')
    if (src) {
      media.videos.push({
        url: src,
        title: $(el).attr('title') || 'YouTube 영상',
        platform: 'youtube'
      })
    }
  })

  $('iframe[src*="vimeo"]').each((_, el) => {
    const src = $(el).attr('src')
    if (src) {
      media.videos.push({
        url: src,
        title: $(el).attr('title') || 'Vimeo 영상',
        platform: 'vimeo'
      })
    }
  })

  // 문서 링크 추출
  $('a[href$=".pdf"], a[href$=".hwp"], a[href$=".doc"], a[href$=".docx"]').each((_, el) => {
    const href = $(el).attr('href')
    if (href) {
      const ext = href.split('.').pop()?.toLowerCase() || ''
      media.documents.push({
        url: normalizeUrl(href, baseUrl),
        title: $(el).text().trim() || '문서',
        type: ext
      })
    }
  })

  return media
}

/**
 * 예배 시간 정보 추출
 */
function extractWorshipTimes(html: string): WorshipTimeInfo[] {
  const $ = cheerio.load(html)
  const worshipTimes: WorshipTimeInfo[] = []

  // 예배 관련 키워드
  const worshipKeywords = ['예배', '주일', '수요', '새벽', '금요', '토요', '청년', '장년', '어린이', '유아', '영아']
  const dayKeywords = ['주일', '월요일', '화요일', '수요일', '목요일', '금요일', '토요일', '일요일', '매일']
  const timePattern = /(\d{1,2})[:\s]?(\d{0,2})\s*(am|pm|오전|오후)?/gi

  // 예배 안내 영역 찾기
  const worshipSelectors = [
    '[class*="worship"]', '[class*="service"]', '[class*="예배"]',
    '.time-table', '.schedule', '[id*="worship"]', '[id*="service"]'
  ]

  for (const selector of worshipSelectors) {
    const $section = $(selector)
    if ($section.length === 0) continue

    // 테이블 형식
    $section.find('tr').each((_, row) => {
      const cells = $(row).find('td, th')
      if (cells.length >= 2) {
        const name = $(cells[0]).text().trim()
        const timeText = $(cells[1]).text().trim()
        const location = cells.length >= 3 ? $(cells[2]).text().trim() : undefined

        if (worshipKeywords.some(kw => name.includes(kw))) {
          const dayMatch = dayKeywords.find(d => name.includes(d) || timeText.includes(d))
          worshipTimes.push({
            name,
            day: dayMatch || '주일',
            time: timeText,
            location
          })
        }
      }
    })

    // 리스트 형식
    $section.find('li, p, div').each((_, el) => {
      const text = $(el).text().trim()
      if (worshipKeywords.some(kw => text.includes(kw))) {
        const parts = text.split(/[:\-–—]/)
        if (parts.length >= 2) {
          const name = parts[0].trim()
          const rest = parts.slice(1).join(':').trim()
          const dayMatch = dayKeywords.find(d => text.includes(d))

          // 시간 추출
          const timeMatch = rest.match(timePattern)
          if (timeMatch) {
            worshipTimes.push({
              name,
              day: dayMatch || '주일',
              time: timeMatch[0],
              notes: rest.replace(timeMatch[0], '').trim() || undefined
            })
          }
        }
      }
    })
  }

  // 중복 제거
  const unique = worshipTimes.filter((wt, idx, arr) =>
    arr.findIndex(w => w.name === wt.name && w.day === wt.day) === idx
  )

  return unique.slice(0, 20)  // 최대 20개
}

// ============ AI 분석 ============

/**
 * AI를 사용하여 홈페이지 구조 분석
 */
async function analyzeStructureWithAI(html: string, url: string): Promise<{
  structure: any
  dictionary: DictionaryEntry[]
  taxonomy: TaxonomyNode[]
}> {
  const prompt = `다음은 한국 교회 홈페이지의 HTML입니다. 이 사이트의 구조를 분석하고 **반드시 dictionary 정보를 추출**해주세요.

URL: ${url}
HTML (일부):
${html.substring(0, 15000)}

⚠️ 중요: dictionary 필드는 **반드시 1개 이상의 항목**을 포함해야 합니다. 빈 배열은 허용되지 않습니다.

다음 정보를 JSON 형식으로 추출해주세요:

1. **navigation**: 메인 네비게이션 메뉴 구조
   - 1차, 2차, 3차 메뉴 계층 구조
   - 각 메뉴의 URL, 제목

2. **dictionary**: 교회 관련 용어/사전 (⭐ 필수 - 반드시 추출!)
   HTML에서 다음 정보를 적극적으로 찾아서 추출하세요:

   a) **인물** (category: "인물"):
      - 목사, 장로, 전도사, 집사, 권사 이름과 직분
      - 담임목사, 부목사, 교육목사 등
      - HTML에서 "OOO 목사", "OOO 장로" 패턴 찾기
      - subcategory에 직분 기재 (담임목사, 장로, 전도사 등)

   b) **부서/사역부서** (category: "부서"):
      - 행정 부서: 서무부, 총무부, 기획부, 재정부, 관리부, 시설관리부 등
      - 선교 부서: 국제선교부, 국내선교부, 해외선교부, 선교회 등
      - 교육 부서: 교육부, 유아부, 유년부, 초등부, 소년부, 중등부, 고등부, 청소년부, 대학부, 청년부, 장년부 등
      - 돌봄/긍휼 사역: 긍휼사역부, 봉사부, 복지사역부, 장애인사역부(농인부, 실로암부, 사랑부) 등
      - 홍보/미디어: 홍보출판부, 신문사, 미디어사역부, 영상부, 방송팀 등
      - 찬양/음악: 찬양사역부, 성가대, 찬양대, 찬양단, 워십팀 등
      - 전도/양육: 전도부, 신앙양육부, 제자훈련부, 새신자부 등
      - 기타: 역사편찬부, 안내부, 주차팀, 기도부 등
      - subcategory에 부서 유형 기재 (선교, 교육, 찬양/음악, 미디어/홍보, 돌봄/긍휼, 전도/양육, 행정 등)

   c) **교구/조직** (category: "조직"):
      - 성경 지명 기반 교구: 베들레헴, 예루살렘, 빌립보, 서머나, 안디옥, 에베소, 골로새, 갈릴리 등
      - 일반 교구: 젊은부부교구, 신혼부부교구, 장년교구, 제1교구, 제2교구, A교구 등
      - 권역: 동부권, 서부권, 남부권, 북부권 등
      - 소그룹: 구역, 셀, 목장, 순, 다락방, 가정교회 등
      - subcategory에 조직 유형 기재 (교구, 권역, 소그룹 등)

   d) **지원조직** (category: "조직"):
      - 남선교회, 여선교회, 청년회, 학생회 등

   e) **장소** (category: "장소"):
      - 대예배실, 소예배실, 교육관, 친교실 등
      - 건물명, 층수, 홀 이름 등

   f) **행사** (category: "행사"):
      - 주일예배, 수요예배, 새벽기도 등 정기 행사
      - 부활절, 성탄절, 추수감사절 특별 행사
      - 수련회, 세미나, 바자회 등

   g) **프로그램** (category: "프로그램"):
      - 성경공부, 제자훈련, 양육과정 등
      - 교회학교, 주일학교 프로그램

3. **taxonomy**: 조직 분류 체계
   - 조직 구조 (교구 > 구역 > 속회)
   - 사역 분류 (예배, 교육, 선교 등)
   - 부서 계층 구조 (상위부서 > 하위부서)

4. **metadata**: 사이트 메타정보
   - 교회명, 로고 URL, 연락처, 주소

JSON 형식으로만 응답 (주석 없이):
{
  "navigation": [...],
  "dictionary": [
    {"term": "홍길동", "category": "인물", "subcategory": "담임목사", "definition": "교회 담임목사"},
    {"term": "국제선교부", "category": "부서", "subcategory": "선교", "definition": "해외 선교 사역 담당"},
    {"term": "청년부", "category": "부서", "subcategory": "교육", "definition": "20-30대 청년 사역"},
    {"term": "베들레헴교구", "category": "조직", "subcategory": "교구", "definition": "성경 지명 기반 교구"},
    {"term": "찬양사역부", "category": "부서", "subcategory": "찬양/음악", "definition": "성가대, 찬양단 총괄"},
    ...최소 10개 이상
  ],
  "taxonomy": [...],
  "metadata": {...}
}`

  try {
    const client = await getAnthropic()
    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 8000,
      messages: [{ role: 'user', content: prompt }]
    })

    const textBlock = response.content.find(block => block.type === 'text')
    const content = textBlock ? (textBlock as any).text : '{}'

    const jsonMatch = content.match(/\{[\s\S]*\}/)
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0])
    }
  } catch (error) {
    console.error('[Crawler] AI 분석 실패:', error)
  }

  return { structure: null, dictionary: [], taxonomy: [] }
}

/**
 * 특정 페이지에서 인물 정보 추출
 */
async function extractPeopleFromPage(html: string, pageUrl: string, category: string): Promise<DictionaryEntry[]> {
  const prompt = `다음 HTML에서 교회 인물 정보를 추출해주세요.

URL: ${pageUrl}
카테고리: ${category}
HTML:
${html.substring(0, 10000)}

각 인물에 대해 다음 정보를 추출해주세요:
- 이름
- 직분/직책
- 소속 부서
- 연락처 (있는 경우)
- 담당 업무 (있는 경우)

JSON 배열 형식으로 응답:
[
  {
    "term": "이름",
    "category": "인물",
    "subcategory": "직분",
    "definition": "소속/담당",
    "metadata": { "phone": "...", "email": "..." }
  }
]`

  try {
    const client = await getOpenAI()
    const response = await client.chat.completions.create({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 4000
    })

    const content = response.choices[0].message.content || '[]'
    const jsonMatch = content.match(/\[[\s\S]*\]/)
    if (jsonMatch) {
      const people = JSON.parse(jsonMatch[0])
      return people.map((p: any) => ({
        ...p,
        sourceUrl: pageUrl
      }))
    }
  } catch (error) {
    console.error('[Crawler] 인물 추출 실패:', error)
  }

  return []
}

/**
 * 조직/부서 페이지에서 상세 정보 추출
 * 네비게이션 메뉴, 테이블, 목록 등에서 지능적으로 추출
 */
function extractOrganizationFromPage(html: string, pageUrl: string): DictionaryEntry[] {
  const $ = cheerio.load(html)
  const dictionary: DictionaryEntry[] = []
  const seenTerms = new Set<string>()

  // 1. 사역부서 패턴 (광림교회 등 대형교회 기준)
  const ministryPatterns = [
    // 행정 부서
    /서무부|총무부|기획부|재정부|회계부|관리부|시설부|시설관리부/g,
    // 선교 부서
    /국제선교부|국내선교부|선교부|해외선교부|지역선교부|선교회|선교팀/g,
    // 교육 부서 (하위 부서 포함)
    /교육부|유아부|영아부|유년부|초등부|소년부|중등부|고등부|청소년부|대학부|청년부|장년부|싱글부|새가족부|양육부|어린이부|유치부|아동부|학생부|유스부|청장년부/g,
    // 돌봄/긍휼 사역
    /긍휼사역부|사회봉사부|봉사부|구제부|복지사역부|복지부|장애인사역부|농인부|실로암부|사랑부|장애인부|노인부|경로부|실버부/g,
    // 홍보/미디어
    /홍보출판부|홍보부|출판부|신문사|방송부|미디어사역부|미디어부|영상부|영상팀|방송팀|음향팀|촬영팀|뉴미디어팀/g,
    // 찬양/음악
    /찬양사역부|찬양부|성가대|찬양대|찬양단|음악부|워십팀|워십밴드|찬양팀/g,
    // 전도/양육
    /전도부|전도회|전도팀|신앙양육부|양육팀|제자훈련부|새신자부|새신자팀|등록팀/g,
    // 역사/기록
    /역사편찬부|역사부|기록부|자료실/g,
    // 기타
    /안내부|안내팀|주차팀|환경부|시설팀|경비팀|기도부|중보기도부|새벽기도팀|통역팀|번역팀/g
  ]

  // 2. 교구/지역 조직 패턴
  const districtPatterns = [
    // 성경 지명 기반 교구
    /베들레헴교구?|예루살렘교구?|빌립보교구?|서머나교구?|안디옥교구?|에베소교구?|골로새교구?/g,
    /갈릴리교구?|유다교구?|사마리아교구?|브엘세바교구?|나사렛교구?|벧엘교구?|실로교구?/g,
    /가버나움교구?|고린도교구?|로마교구?|데살로니가교구?|갈라디아교구?/g,
    /빌라델비아교구?|버가모교구?|두아디라교구?|사데교구?|라오디게아교구?/g,
    // 일반 교구
    /젊은부부교구|신혼부부교구|장년교구|청년교구|부부교구/g,
    /제?[1-9]교구|[A-Z]교구/g,
    // 권역/구역
    /동부권|서부권|남부권|북부권|중부권|강남권|강북권|강서권|강동권/g
  ]

  // 3. 소그룹 패턴
  const smallGroupPatterns = [
    /[가-힣]+구역|[가-힣]+셀|[가-힣]+목장|[가-힣]+순|[가-힣]+다락방/g,
    /남선교회|여선교회|청년회|학생회|직장인모임|가정교회|열린모임|나눔방/g
  ]

  const bodyText = $('body').text()

  // 부서 패턴 추출
  for (const pattern of ministryPatterns) {
    let match
    while ((match = pattern.exec(bodyText)) !== null) {
      const dept = match[0]
      if (!seenTerms.has(dept)) {
        seenTerms.add(dept)
        dictionary.push({
          term: dept,
          category: '부서',
          subcategory: categorizeDepartment(dept),
          definition: dept,
          sourceUrl: pageUrl
        })
      }
    }
  }

  // 교구 패턴 추출
  for (const pattern of districtPatterns) {
    let match
    while ((match = pattern.exec(bodyText)) !== null) {
      const district = match[0]
      if (!seenTerms.has(district)) {
        seenTerms.add(district)
        dictionary.push({
          term: district,
          category: '조직',
          subcategory: '교구',
          definition: district,
          sourceUrl: pageUrl
        })
      }
    }
  }

  // 소그룹 패턴 추출
  for (const pattern of smallGroupPatterns) {
    let match
    while ((match = pattern.exec(bodyText)) !== null) {
      const group = match[0]
      if (!seenTerms.has(group) && group.length >= 3 && group.length <= 15) {
        seenTerms.add(group)
        dictionary.push({
          term: group,
          category: '조직',
          subcategory: '소그룹',
          definition: group,
          sourceUrl: pageUrl
        })
      }
    }
  }

  // 4. 네비게이션/메뉴에서 추가 추출
  const menuSelectors = [
    'nav a', '.menu a', '.gnb a', '.lnb a', '.snb a',
    'ul.menu li a', '.sub-menu a', '.submenu a',
    '[class*="menu"] a', '[class*="nav"] a', '[class*="org"] a',
    '.dept-list a', '.ministry-list a'
  ]

  for (const selector of menuSelectors) {
    $(selector).each((_, el) => {
      const text = $(el).text().trim()
      const href = $(el).attr('href') || ''

      // 부서/조직 관련 메뉴 항목인지 확인
      if (text.length >= 2 && text.length <= 20) {
        // XX부, XX팀, XX회, XX교구, XX권역 패턴
        const deptMatch = text.match(/([가-힣]+)(부|팀|회|사역|사역부|교구|권역|구역)/)
        if (deptMatch && !seenTerms.has(text)) {
          const excludeWords = ['예배부분', '전체부분', '해당부분', '일부분']
          if (!excludeWords.some(w => text.includes(w))) {
            seenTerms.add(text)
            const category = text.includes('교구') || text.includes('권역') || text.includes('구역') ? '조직' : '부서'
            dictionary.push({
              term: text,
              category,
              subcategory: categorizeDepartment(text),
              definition: text,
              sourceUrl: href ? new URL(href, pageUrl).href : pageUrl
            })
          }
        }
      }
    })
  }

  // 5. 테이블/목록에서 구조화된 정보 추출
  $('table tr, .org-chart li, .ministry-list li, ul.dept li').each((_, el) => {
    const text = $(el).text().trim()
    // 부서명 + 담당자 또는 설명 패턴
    const deptInfoMatch = text.match(/([가-힣]+(?:부|팀|회|사역부?))\s*[:\-]\s*(.+)/)
    if (deptInfoMatch && !seenTerms.has(deptInfoMatch[1])) {
      seenTerms.add(deptInfoMatch[1])
      dictionary.push({
        term: deptInfoMatch[1],
        category: '부서',
        subcategory: categorizeDepartment(deptInfoMatch[1]),
        definition: deptInfoMatch[2].substring(0, 100),
        sourceUrl: pageUrl
      })
    }
  })

  console.log(`[Crawler] 조직/부서 페이지 추출: ${dictionary.length}개 (${pageUrl})`)
  return dictionary
}

/**
 * 부서명에서 카테고리 추정
 */
function categorizeDepartment(deptName: string): string {
  if (deptName.includes('선교')) return '선교'
  if (deptName.includes('교육') || ['유아', '유년', '초등', '소년', '중등', '고등', '청소년', '대학', '청년', '장년'].some(d => deptName.includes(d))) return '교육'
  if (deptName.includes('찬양') || deptName.includes('성가') || deptName.includes('음악') || deptName.includes('워십')) return '찬양/음악'
  if (deptName.includes('미디어') || deptName.includes('홍보') || deptName.includes('방송') || deptName.includes('영상') || deptName.includes('출판')) return '미디어/홍보'
  if (deptName.includes('복지') || deptName.includes('긍휼') || deptName.includes('봉사') || deptName.includes('장애인') || deptName.includes('구제')) return '돌봄/긍휼'
  if (deptName.includes('전도') || deptName.includes('양육') || deptName.includes('새신자') || deptName.includes('제자')) return '전도/양육'
  if (deptName.includes('기도')) return '기도'
  if (deptName.includes('안내') || deptName.includes('주차') || deptName.includes('환경') || deptName.includes('시설')) return '봉사'
  if (deptName.includes('교구') || deptName.includes('권역')) return '교구'
  if (deptName.includes('구역') || deptName.includes('셀') || deptName.includes('목장')) return '소그룹'
  if (deptName.includes('서무') || deptName.includes('총무') || deptName.includes('기획') || deptName.includes('재정')) return '행정'
  return ''
}

/**
 * HTML에서 패턴 기반으로 사전 항목 추출 (AI 폴백용)
 */
function extractDictionaryFromHTML(html: string, baseUrl: string): DictionaryEntry[] {
  const $ = cheerio.load(html)
  const dictionary: DictionaryEntry[] = []
  const seenTerms = new Set<string>()

  // 1. 인물 패턴 추출 (이름 + 직분)
  const personPatterns = [
    /([가-힣]{2,4})\s*(담임목사|원로목사|부목사|교육목사|청년목사|목사|장로|권사|집사|전도사|사모)/g,
    /(담임목사|원로목사|부목사|교육목사|청년목사|목사|장로|권사|집사|전도사)\s*([가-힣]{2,4})/g
  ]

  const bodyText = $('body').text()

  for (const pattern of personPatterns) {
    let match
    while ((match = pattern.exec(bodyText)) !== null) {
      const name = match[1].length <= 4 ? match[1] : match[2]
      const position = match[1].length > 4 ? match[1] : match[2]

      // 이름이 2-4자인지, 실제 이름 패턴인지 확인
      if (name && name.length >= 2 && name.length <= 4 && !seenTerms.has(name)) {
        // 일반적인 단어가 아닌지 확인
        const commonWords = ['교회', '예배', '성경', '찬양', '기도', '말씀', '은혜', '사랑', '감사']
        if (!commonWords.includes(name)) {
          seenTerms.add(name)
          dictionary.push({
            term: name,
            category: '인물',
            subcategory: position,
            definition: `${position}`,
            sourceUrl: baseUrl
          })
        }
      }
    }
  }

  // 2. 부서/사역 패턴 추출 (대폭 확장)
  const departmentSelectors = [
    'nav a', '.menu a', '.gnb a', '.lnb a', '.snb a',
    '[class*="dept"] a', '[class*="ministry"] a', '[class*="org"] a',
    'h2', 'h3', 'h4', 'h5', '.title', '.tit',
    'li a', 'ul a', '.sub-menu a', '.submenu a',
    '[class*="menu"] a', '[class*="nav"] a'
  ]

  // 사역부서 패턴 (광림교회 등 대형교회 기준 확장)
  const ministryDepartments = [
    // 행정/서무 부서
    '서무부', '총무부', '기획부', '재정부', '회계부', '관리부', '시설부', '시설관리부',
    // 선교부
    '국제선교부', '국내선교부', '선교부', '해외선교부', '지역선교부', '선교회',
    // 교육부서
    '교육부', '유아부', '유년부', '초등부', '소년부', '중등부', '고등부', '청소년부',
    '대학부', '청년부', '장년부', '싱글부', '청장년부', '새가족부', '양육부',
    '유스부', '어린이부', '유치부', '영아부', '아동부', '학생부',
    // 돌봄/긍휼 사역
    '긍휼사역부', '사회봉사부', '봉사부', '구제부', '복지사역부', '복지부',
    '장애인사역부', '농인부', '실로암부', '사랑부', '장애인부',
    '요양원사역', '호스피스', '노인부', '경로부', '실버부',
    // 홍보/출판
    '홍보출판부', '홍보부', '출판부', '신문사', '방송부', '미디어사역부', '미디어부',
    '영상부', '영상팀', '방송팀', '음향팀', '촬영팀', '뉴미디어팀',
    // 찬양/음악
    '찬양사역부', '찬양부', '성가대', '찬양대', '찬양단', '음악부',
    '워십팀', '워십밴드', '찬양팀', 'CCM팀',
    // 전도/양육
    '전도부', '전도회', '전도팀', '신앙양육부', '양육팀', '제자훈련부',
    '새신자부', '새신자팀', '등록팀',
    // 역사/기록
    '역사편찬부', '역사부', '기록부', '자료실',
    // 기타 사역부
    '안내부', '안내팀', '주차팀', '환경부', '시설팀', '경비팀',
    '기도부', '중보기도부', '새벽기도팀', '통역팀', '번역팀'
  ]

  // 교구/지역 패턴 (성경 지명 기반 + 일반)
  const districtPatterns = [
    // 성경 지명 기반 교구
    '베들레헴', '예루살렘', '빌립보', '서머나', '안디옥', '에베소', '골로새',
    '갈릴리', '유다', '사마리아', '브엘세바', '나사렛', '벧엘', '실로',
    '가버나움', '고린도', '로마', '데살로니가', '갈라디아', '빌라델비아',
    '버가모', '두아디라', '사데', '라오디게아',
    // 일반 교구 패턴
    '젊은부부교구', '신혼부부교구', '장년교구', '청년교구', '부부교구',
    '1교구', '2교구', '3교구', '4교구', '5교구', '6교구', '7교구', '8교구',
    '제1교구', '제2교구', '제3교구', '제4교구', '제5교구',
    'A교구', 'B교구', 'C교구', 'D교구', 'E교구',
    // 권역/구역
    '동부권', '서부권', '남부권', '북부권', '중부권',
    '강남권', '강북권', '강서권', '강동권'
  ]

  // 소그룹/셀 패턴
  const smallGroupPatterns = [
    '구역', '셀', '목장', '순', '다락방', '소그룹', 'EM', 'MC', 'GBS',
    '가정교회', '열린모임', '나눔방', '큐티모임', 'QT모임',
    '남선교회', '여선교회', '청년회', '학생회', '직장인모임'
  ]

  // 모든 부서 패턴 합치기
  const allDepartmentPatterns = [...ministryDepartments, ...districtPatterns, ...smallGroupPatterns]

  for (const selector of departmentSelectors) {
    $(selector).each((_, el) => {
      const text = $(el).text().trim()
      const href = $(el).attr('href') || ''

      for (const dept of allDepartmentPatterns) {
        if (text.includes(dept) && text.length < 50 && !seenTerms.has(dept)) {
          seenTerms.add(dept)

          // 카테고리 분류
          let category = '부서'
          let subcategory = ''

          if (districtPatterns.includes(dept)) {
            category = '조직'
            subcategory = '교구'
          } else if (smallGroupPatterns.includes(dept)) {
            category = '조직'
            subcategory = '소그룹'
          } else if (dept.includes('선교')) {
            subcategory = '선교'
          } else if (dept.includes('교육') || ['유아부', '유년부', '초등부', '소년부', '중등부', '고등부', '청소년부', '대학부', '청년부'].some(d => dept.includes(d))) {
            subcategory = '교육'
          } else if (dept.includes('찬양') || dept.includes('성가') || dept.includes('음악')) {
            subcategory = '찬양/음악'
          } else if (dept.includes('미디어') || dept.includes('홍보') || dept.includes('방송') || dept.includes('영상')) {
            subcategory = '미디어/홍보'
          } else if (dept.includes('복지') || dept.includes('긍휼') || dept.includes('봉사') || dept.includes('장애인')) {
            subcategory = '돌봄/긍휼'
          }

          dictionary.push({
            term: dept,
            category,
            subcategory: subcategory || undefined,
            definition: text.length < 80 ? text : dept,
            sourceUrl: href ? new URL(href, baseUrl).href : baseUrl
          })
        }
      }
    })
  }

  // 2-1. 동적 부서명 패턴 추출 (XX부, XX팀, XX회 형식)
  const dynamicDeptPattern = /([가-힣]{2,8})(부|팀|회|사역|사역부|사역팀|교구|권역|구역)\b/g
  let deptMatch
  while ((deptMatch = dynamicDeptPattern.exec(bodyText)) !== null) {
    const fullDept = deptMatch[0]
    // 일반적인 단어 제외
    const excludeWords = ['예배부', '전체부', '기타부', '그부', '이부', '저부', '해당부', '담당부', '소속부']
    if (fullDept.length >= 3 && fullDept.length <= 10 && !seenTerms.has(fullDept) && !excludeWords.includes(fullDept)) {
      seenTerms.add(fullDept)

      // 카테고리 추정
      let category = '부서'
      let subcategory = ''
      if (fullDept.includes('교구') || fullDept.includes('권역') || fullDept.includes('구역')) {
        category = '조직'
        subcategory = '교구/구역'
      }

      dictionary.push({
        term: fullDept,
        category,
        subcategory: subcategory || undefined,
        definition: fullDept,
        sourceUrl: baseUrl
      })
    }
  }

  // 3. 예배/행사 패턴 추출
  const worshipPatterns = [
    '주일예배', '주일1부예배', '주일2부예배', '주일3부예배',
    '수요예배', '금요예배', '새벽기도', '새벽예배', '토요예배',
    '청년예배', '장년예배', '어린이예배', '유아예배',
    '수련회', '부흥회', '바자회', '바자', '세미나', '성경학교'
  ]

  for (const worship of worshipPatterns) {
    if (bodyText.includes(worship) && !seenTerms.has(worship)) {
      seenTerms.add(worship)
      dictionary.push({
        term: worship,
        category: '행사',
        definition: worship,
        sourceUrl: baseUrl
      })
    }
  }

  // 4. 장소 패턴 추출
  const placePatterns = [
    '대예배실', '소예배실', '본당', '교육관', '친교실', '식당',
    '유아실', '유치부실', '초등부실', '청년부실', '도서관',
    '기도실', '상담실', '사무실', '회의실'
  ]

  for (const place of placePatterns) {
    if (bodyText.includes(place) && !seenTerms.has(place)) {
      seenTerms.add(place)
      dictionary.push({
        term: place,
        category: '장소',
        definition: place,
        sourceUrl: baseUrl
      })
    }
  }

  console.log(`[Crawler] HTML 패턴 기반 사전 추출: ${dictionary.length}개`)
  return dictionary
}

// ============ 크롤링 메인 함수 ============

/**
 * 교회 홈페이지 전체 크롤링
 */
export async function crawlChurchWebsite(
  churchCode: string,
  options?: {
    maxDepth?: number
    maxPages?: number
    extractPeople?: boolean
    extractBoards?: boolean
    extractContacts?: boolean   // 연락처 정보 추출
    extractMedia?: boolean      // 미디어/소셜미디어 정보 추출
    deepCrawl?: boolean         // 실제 서브페이지 방문 여부
    delayMs?: number            // 요청 간 딜레이 (ms)
    onProgress?: (progress: CrawlProgress) => void
  }
): Promise<CrawlResult> {
  const startTime = Date.now()
  const errors: string[] = []

  const maxDepth = options?.maxDepth ?? 3
  const maxPages = options?.maxPages ?? 100

  // 1. 교회 정보 조회
  const { data: church, error: churchError } = await getSupabase()
    .from('churches')
    .select('*')
    .eq('code', churchCode)
    .single() as { data: { id: number; name: string; code: string; homepage_url: string } | null; error: any }

  if (churchError || !church) {
    return {
      success: false,
      churchId: 0,
      errors: [`교회를 찾을 수 없습니다: ${churchCode}`],
      crawlTime: Date.now() - startTime
    }
  }

  console.log(`[Crawler] ${church.name} 크롤링 시작: ${church.homepage_url}`)

  // 2. 메인 페이지 크롤링
  let mainHtml = await fetchHTML(church.homepage_url)
  if (!mainHtml) {
    return {
      success: false,
      churchId: church.id,
      errors: ['메인 페이지 접근 실패'],
      crawlTime: Date.now() - startTime
    }
  }

  let effectiveBaseUrl = church.homepage_url

  // 2-1. 인트로 페이지 감지 및 실제 메인 페이지로 이동
  const introRedirectUrl = detectIntroPageAndGetMainUrl(mainHtml, church.homepage_url)
  if (introRedirectUrl) {
    console.log(`[Crawler] 실제 메인 페이지로 이동: ${introRedirectUrl}`)
    const actualMainHtml = await fetchHTML(introRedirectUrl)
    if (actualMainHtml) {
      mainHtml = actualMainHtml
      effectiveBaseUrl = introRedirectUrl
    }
  }

  // 2-2. iframe 기반 사이트 처리
  const iframeContentUrl = detectIframeAndGetContentUrl(mainHtml, effectiveBaseUrl)
  if (iframeContentUrl) {
    console.log(`[Crawler] iframe 콘텐츠로 이동: ${iframeContentUrl}`)
    const iframeHtml = await fetchHTML(iframeContentUrl)
    if (iframeHtml) {
      // iframe 내용과 원본 모두 분석에 사용
      mainHtml = iframeHtml + mainHtml
      effectiveBaseUrl = iframeContentUrl
    }
  }

  // 2-3. XML 메뉴 파일 감지 및 파싱
  let xmlNavigation: PageInfo[] = []
  const xmlMenuUrl = await detectXMLMenuUrl(mainHtml, effectiveBaseUrl)
  if (xmlMenuUrl) {
    console.log(`[Crawler] XML 메뉴 파일 감지: ${xmlMenuUrl}`)
    xmlNavigation = await parseXMLMenu(xmlMenuUrl, effectiveBaseUrl)
  }

  // 3. HTML 파싱으로 기본 구조 추출
  let navigation = extractNavigation(mainHtml, effectiveBaseUrl)

  // XML 메뉴가 있고 HTML 추출 결과가 없으면 XML 결과 사용
  if (navigation.length === 0 && xmlNavigation.length > 0) {
    navigation = xmlNavigation
    console.log(`[Crawler] XML 메뉴 사용: ${navigation.length}개`)
  }
  const boards = detectBoards(mainHtml, effectiveBaseUrl)
  const metadata = extractPageMetadata(mainHtml)

  // 확장된 정보 추출
  const contacts = options?.extractContacts !== false ? extractContactInfo(mainHtml) : undefined
  const socialMedia = options?.extractMedia !== false ? extractSocialMedia(mainHtml, effectiveBaseUrl) : undefined
  const media = options?.extractMedia !== false ? extractMediaInfo(mainHtml, effectiveBaseUrl) : undefined
  const worshipTimes = extractWorshipTimes(mainHtml)

  console.log(`[Crawler] 메뉴 ${navigation.length}개, 게시판 ${boards.length}개 발견`)
  console.log(`[Crawler] 연락처: 전화 ${contacts?.phones.length || 0}개, 이메일 ${contacts?.emails.length || 0}개`)
  console.log(`[Crawler] 소셜미디어: ${Object.keys(socialMedia || {}).filter(k => k !== 'other' && (socialMedia as any)?.[k]).length}개`)
  console.log(`[Crawler] 예배시간: ${worshipTimes.length}개`)

  // 4. 메인 페이지에서 팝업/모달 감지
  const mainPopups = detectPopups(mainHtml, effectiveBaseUrl)
  console.log(`[Crawler] 메인 페이지 팝업 ${mainPopups.length}개 발견`)

  // 5. AI 분석으로 상세 구조 추출
  const aiAnalysis = await analyzeStructureWithAI(mainHtml, effectiveBaseUrl)

  // 6. 사전 정보 추출
  // AI 응답이 배열이 아닐 수 있으므로 확인
  let dictionary: DictionaryEntry[] = Array.isArray(aiAnalysis.dictionary) ? aiAnalysis.dictionary : []

  // AI 분석 결과가 없거나 비어있으면 HTML 패턴 기반 추출 시도
  if (dictionary.length === 0) {
    console.log('[Crawler] AI 사전 추출 실패, HTML 패턴 기반 추출 시도...')
    dictionary = extractDictionaryFromHTML(mainHtml, effectiveBaseUrl)
  } else {
    console.log(`[Crawler] AI 사전 추출 성공: ${dictionary.length}개`)
  }

  let allPopups: PopupInfo[] = [...mainPopups]
  let finalNavigation = navigation.length > 0 ? navigation : (aiAnalysis.structure?.navigation || [])
  let crawlProgress: CrawlProgress | undefined

  // 7. 딥 크롤링 (옵션)
  if (options?.deepCrawl) {
    console.log(`[Crawler] 딥 크롤링 시작 (maxDepth: ${maxDepth}, maxPages: ${maxPages})`)

    // 모든 네비게이션 아이템을 flat하게 수집
    const allPages: PageInfo[] = []
    function collectPages(items: PageInfo[]) {
      for (const item of items) {
        if (item.url) allPages.push(item)
        if (item.children) collectPages(item.children)
      }
    }
    collectPages(finalNavigation)
    allPages.push(...boards)

    console.log(`[Crawler] 딥 크롤링 대상 페이지: ${allPages.length}개`)

    const deepResult = await deepCrawlPages(allPages, church.homepage_url, {
      maxDepth,
      maxPages,
      delayMs: options.delayMs || 500,
      onProgress: options.onProgress
    })

    // 결과 병합
    allPopups.push(...deepResult.allPopups)
    dictionary.push(...deepResult.dictionary)
    errors.push(...deepResult.errors)

    // 네비게이션에 크롤링 정보 업데이트
    const crawledUrlMap = new Map<string, PageInfo>()
    for (const page of deepResult.crawledPages) {
      crawledUrlMap.set(page.url, page)
    }

    function updateCrawlStatus(items: PageInfo[]) {
      for (const item of items) {
        const crawled = crawledUrlMap.get(item.url)
        if (crawled) {
          item.crawled = crawled.crawled
          item.extractedData = crawled.extractedData
          item.crawlError = crawled.crawlError
        }
        if (item.children) updateCrawlStatus(item.children)
      }
    }
    updateCrawlStatus(finalNavigation)

    crawlProgress = {
      totalPages: deepResult.crawledPages.length,
      crawledPages: deepResult.crawledPages.filter(p => p.crawled).length,
      currentUrl: '',
      currentDepth: maxDepth,
      errors: deepResult.errors
    }

    console.log(`[Crawler] 딥 크롤링 완료: ${crawlProgress.crawledPages}/${crawlProgress.totalPages} 페이지, 팝업 ${allPopups.length}개`)
  } else {
    // 기본 크롤링: 인물 페이지만 추가 크롤링
    if (options?.extractPeople) {
      const pastorPages = findPeoplePages(finalNavigation, ['목사', '담임', '교역자', '사역자'])
      for (const page of pastorPages.slice(0, 5)) {
        const html = await fetchHTML(page.url)
        if (html) {
          const people = await extractPeopleFromPage(html, page.url, '목사')
          dictionary.push(...people)
        }
      }
    }
  }

  // 8. 구조 결합
  const structure: SiteStructure = {
    church: {
      name: church.name,
      code: church.code,
      url: church.homepage_url
    },
    navigation: finalNavigation,
    boards,
    specialPages: allPopups.map(p => ({
      url: p.url,
      title: p.title,
      pageType: 'popup' as const,
      depth: 0,
      contentType: 'popup' as const
    })),
    metadata: {
      totalPages: crawlProgress?.totalPages ||
        finalNavigation.reduce((acc: number, m: PageInfo) => acc + 1 + (m.children?.length || 0), 0),
      maxDepth,
      hasLogin: mainHtml.includes('login') || mainHtml.includes('로그인'),
      hasMobileVersion: mainHtml.includes('mobile') || metadata.viewport.includes('width=device-width'),
      technologies: detectTechnologies(mainHtml)
    },
    // 확장된 정보
    contacts,
    socialMedia,
    media,
    worshipTimes
  }

  // 9. DB 저장
  const taxonomy = Array.isArray(aiAnalysis.taxonomy) ? aiAnalysis.taxonomy : []
  await saveCrawlResult(church.id, structure, dictionary, taxonomy)

  // 10. 크롤링 로그 저장
  await (getSupabase().from('church_crawl_logs') as any).insert({
    church_id: church.id,
    crawl_type: options?.deepCrawl ? 'deep' : 'full',
    status: 'completed',
    pages_crawled: crawlProgress?.crawledPages || structure.metadata.totalPages,
    items_extracted: dictionary.length,
    errors_count: errors.length,
    started_at: new Date(startTime).toISOString(),
    completed_at: new Date().toISOString(),
    result_summary: {
      navigation: finalNavigation.length,
      boards: boards.length,
      popups: allPopups.length,
      dictionary: dictionary.length,
      deepCrawl: options?.deepCrawl || false,
      maxDepth,
      errors: errors.slice(0, 10)  // 최대 10개 에러만 저장
    }
  })

  return {
    success: true,
    churchId: church.id,
    structure,
    dictionary,
    taxonomy,
    popups: allPopups,
    errors,
    crawlTime: Date.now() - startTime,
    progress: crawlProgress,
    extendedInfo: {
      contactsCount: (contacts?.phones.length || 0) + (contacts?.emails.length || 0),
      socialMediaCount: Object.keys(socialMedia || {}).filter(k => k !== 'other' && (socialMedia as any)?.[k]).length,
      mediaCount: (media?.bannerImages.length || 0) + (media?.galleryImages.length || 0) + (media?.videos.length || 0),
      worshipTimesCount: worshipTimes.length
    }
  }
}

/**
 * 기술 스택 감지
 */
function detectTechnologies(html: string): string[] {
  const technologies: string[] = []

  // 프레임워크/라이브러리 감지
  if (html.includes('jQuery') || html.includes('jquery')) technologies.push('jQuery')
  if (html.includes('React') || html.includes('react')) technologies.push('React')
  if (html.includes('Vue') || html.includes('vue')) technologies.push('Vue.js')
  if (html.includes('Angular') || html.includes('ng-')) technologies.push('Angular')
  if (html.includes('bootstrap')) technologies.push('Bootstrap')
  if (html.includes('tailwind')) technologies.push('Tailwind CSS')

  // CMS 감지
  if (html.includes('wordpress') || html.includes('wp-content')) technologies.push('WordPress')
  if (html.includes('gnuboard') || html.includes('bbs.php')) technologies.push('그누보드')
  if (html.includes('xpress') || html.includes('xe.min')) technologies.push('XpressEngine')
  if (html.includes('cafe24')) technologies.push('Cafe24')

  return technologies
}

/**
 * 인물 관련 페이지 찾기
 */
function findPeoplePages(navigation: PageInfo[], keywords: string[]): PageInfo[] {
  const pages: PageInfo[] = []

  function search(items: PageInfo[]) {
    for (const item of items) {
      for (const keyword of keywords) {
        if (item.title.includes(keyword)) {
          pages.push(item)
          break
        }
      }
      if (item.children) {
        search(item.children)
      }
    }
  }

  search(navigation)
  return pages
}

/**
 * 크롤링 결과 DB 저장
 */
async function saveCrawlResult(
  churchId: number,
  structure: SiteStructure,
  dictionary: DictionaryEntry[],
  taxonomy: TaxonomyNode[]
): Promise<void> {
  // Supabase 타입 추론 문제로 any 타입 사용
  const db = getSupabase() as any

  // 기존 구조 삭제
  await db.from('church_site_structure').delete().eq('church_id', churchId)
  await db.from('church_dictionary').delete().eq('church_id', churchId)
  await db.from('church_taxonomy').delete().eq('church_id', churchId)

  // 네비게이션 저장
  async function saveNavigation(items: PageInfo[], parentId: number | null, depth: number) {
    for (let i = 0; i < items.length; i++) {
      const item = items[i]

      const { data, error } = await db.from('church_site_structure').insert({
        church_id: churchId,
        parent_id: parentId,
        page_type: item.pageType,
        title: item.title,
        url: item.url,
        depth,
        sort_order: i,
        content_type: item.contentType || 'static',
        has_children: (item.children?.length || 0) > 0
      }).select('id').single()

      if (!error && data && item.children && item.children.length > 0) {
        await saveNavigation(item.children, data.id, depth + 1)
      }
    }
  }

  await saveNavigation(structure.navigation, null, 0)

  // 게시판 저장
  for (let i = 0; i < structure.boards.length; i++) {
    const board = structure.boards[i]
    await db.from('church_site_structure').insert({
      church_id: churchId,
      page_type: 'board',
      title: board.title,
      url: board.url,
      depth: 0,
      sort_order: i,
      content_type: 'board',
      has_children: false
    })
  }

  // 사전 저장
  for (const entry of dictionary) {
    await db.from('church_dictionary').insert({
      church_id: churchId,
      term: entry.term,
      category: entry.category,
      subcategory: entry.subcategory,
      definition: entry.definition,
      aliases: entry.aliases || [],
      related_terms: entry.relatedTerms || [],
      metadata: entry.metadata,
      source_url: entry.sourceUrl
    })
  }

  // 분류 체계 저장
  async function saveTaxonomy(nodes: TaxonomyNode[], parentId: number | null, depth: number, basePath: string) {
    for (const node of nodes) {
      const path = basePath ? `${basePath}/${node.name}` : `/${node.name}`

      const { data, error } = await db.from('church_taxonomy').insert({
        church_id: churchId,
        parent_id: parentId,
        name: node.name,
        taxonomy_type: node.type,
        depth,
        path,
        metadata: node.metadata
      }).select('id').single()

      if (!error && data && node.children && node.children.length > 0) {
        await saveTaxonomy(node.children, data.id, depth + 1, path)
      }
    }
  }

  await saveTaxonomy(taxonomy, null, 0, '')

  // 확장 정보 저장
  if (structure.contacts) {
    // 기존 연락처 삭제
    await db.from('church_contacts').delete().eq('church_id', churchId)

    // 전화번호 저장
    for (let i = 0; i < structure.contacts.phones.length; i++) {
      await db.from('church_contacts').insert({
        church_id: churchId,
        contact_type: 'phone',
        contact_value: structure.contacts.phones[i],
        is_primary: i === 0
      })
    }

    // 이메일 저장
    for (let i = 0; i < structure.contacts.emails.length; i++) {
      await db.from('church_contacts').insert({
        church_id: churchId,
        contact_type: 'email',
        contact_value: structure.contacts.emails[i],
        is_primary: i === 0
      })
    }

    // 팩스 저장
    if (structure.contacts.fax) {
      await db.from('church_contacts').insert({
        church_id: churchId,
        contact_type: 'fax',
        contact_value: structure.contacts.fax
      })
    }

    // 교회 테이블 업데이트
    const updateData: any = { updated_at: new Date().toISOString() }
    if (structure.contacts.address) updateData.address = structure.contacts.address
    if (structure.contacts.postalCode) updateData.postal_code = structure.contacts.postalCode
    if (structure.contacts.phones.length > 0) updateData.phone = structure.contacts.phones[0]
    if (structure.contacts.emails.length > 0) updateData.email = structure.contacts.emails[0]
    if (structure.contacts.fax) updateData.fax = structure.contacts.fax

    await db.from('churches').update(updateData).eq('id', churchId)
  }

  // 소셜 미디어 저장
  if (structure.socialMedia) {
    await db.from('church_social_media').delete().eq('church_id', churchId)

    const socialEntries = [
      { platform: 'youtube', url: structure.socialMedia.youtube },
      { platform: 'facebook', url: structure.socialMedia.facebook },
      { platform: 'instagram', url: structure.socialMedia.instagram },
      { platform: 'twitter', url: structure.socialMedia.twitter },
      { platform: 'blog', url: structure.socialMedia.blog },
      { platform: 'kakao', url: structure.socialMedia.kakao },
      { platform: 'naver_blog', url: structure.socialMedia.naverBlog },
      { platform: 'naver_cafe', url: structure.socialMedia.naverCafe },
      { platform: 'naver_tv', url: structure.socialMedia.naverTv }
    ]

    for (const entry of socialEntries) {
      if (entry.url) {
        await db.from('church_social_media').insert({
          church_id: churchId,
          platform: entry.platform,
          url: entry.url
        })
      }
    }
  }

  // 미디어 저장
  if (structure.media) {
    await db.from('church_media').delete().eq('church_id', churchId)

    // 로고
    if (structure.media.logo) {
      await db.from('church_media').insert({
        church_id: churchId,
        media_type: 'logo',
        url: structure.media.logo,
        title: '교회 로고'
      })

      // 교회 테이블에도 로고 URL 업데이트
      await db.from('churches').update({
        logo_url: structure.media.logo,
        updated_at: new Date().toISOString()
      }).eq('id', churchId)
    }

    // 배너 이미지
    for (let i = 0; i < structure.media.bannerImages.length; i++) {
      await db.from('church_media').insert({
        church_id: churchId,
        media_type: 'banner',
        url: structure.media.bannerImages[i],
        sort_order: i
      })
    }

    // 갤러리 이미지
    for (let i = 0; i < structure.media.galleryImages.length; i++) {
      await db.from('church_media').insert({
        church_id: churchId,
        media_type: 'gallery',
        url: structure.media.galleryImages[i],
        sort_order: i
      })
    }

    // 비디오
    for (const video of structure.media.videos) {
      await db.from('church_media').insert({
        church_id: churchId,
        media_type: 'video',
        url: video.url,
        title: video.title,
        platform: video.platform
      })
    }

    // 문서
    for (const doc of structure.media.documents) {
      await db.from('church_media').insert({
        church_id: churchId,
        media_type: 'document',
        url: doc.url,
        title: doc.title,
        file_type: doc.type
      })
    }
  }

  // 예배 시간 저장
  if (structure.worshipTimes && structure.worshipTimes.length > 0) {
    await db.from('church_worship_times').delete().eq('church_id', churchId)

    for (let i = 0; i < structure.worshipTimes.length; i++) {
      const wt = structure.worshipTimes[i]
      await db.from('church_worship_times').insert({
        church_id: churchId,
        name: wt.name,
        day_of_week: wt.day,
        time_display: wt.time,
        location: wt.location,
        notes: wt.notes,
        sort_order: i
      })
    }
  }
}

// ============ 조회 함수 ============

/**
 * 교회 구조 조회
 */
export async function getChurchStructure(churchCode: string): Promise<SiteStructure | null> {
  const db = getSupabase() as any
  const { data: church } = await db
    .from('churches')
    .select('id, name, code, homepage_url')
    .eq('code', churchCode)
    .single()

  if (!church) return null

  // 구조 조회
  const { data: structure } = await db
    .from('church_site_structure')
    .select('*')
    .eq('church_id', church.id)
    .order('depth')
    .order('sort_order')

  if (!structure) return null

  // 계층 구조로 변환
  const navigation = buildTree(structure.filter((s: any) => s.page_type !== 'board'))
  const boards = structure.filter((s: any) => s.page_type === 'board').map((b: any) => ({
    url: b.url || '',
    title: b.title,
    pageType: 'board' as const,
    depth: 0,
    contentType: b.content_type
  }))

  return {
    church: { name: church.name, code: church.code, url: church.homepage_url },
    navigation,
    boards,
    specialPages: [],
    metadata: {
      totalPages: structure.length,
      maxDepth: Math.max(...structure.map((s: any) => s.depth)),
      hasLogin: false,
      hasMobileVersion: true,
      technologies: []
    }
  }
}

/**
 * 교회 사전 조회
 */
export async function getChurchDictionary(
  churchCode: string,
  category?: string
): Promise<DictionaryEntry[]> {
  const db = getSupabase() as any
  const { data: church } = await db
    .from('churches')
    .select('id')
    .eq('code', churchCode)
    .single()

  if (!church) return []

  let query = db
    .from('church_dictionary')
    .select('*')
    .eq('church_id', church.id)

  if (category) {
    query = query.eq('category', category)
  }

  const { data } = await query.order('category').order('term')

  return (data || []).map((d: any) => ({
    term: d.term,
    category: d.category,
    subcategory: d.subcategory,
    definition: d.definition,
    aliases: d.aliases,
    relatedTerms: d.related_terms,
    metadata: d.metadata,
    sourceUrl: d.source_url
  }))
}

/**
 * 교회 목록 조회
 */
export async function getChurches(): Promise<Array<{
  id: number
  name: string
  code: string
  homepageUrl: string
  lastCrawled?: string
}>> {
  const db = getSupabase() as any
  const { data: churches } = await db
    .from('churches')
    .select('id, name, code, homepage_url')
    .eq('is_active', true)
    .order('name')

  if (!churches) return []

  // 마지막 크롤링 시간 조회
  const result = []
  for (const church of churches) {
    const { data: log } = await db
      .from('church_crawl_logs')
      .select('completed_at')
      .eq('church_id', church.id)
      .eq('status', 'completed')
      .order('completed_at', { ascending: false })
      .limit(1)
      .single()

    result.push({
      id: church.id,
      name: church.name,
      code: church.code,
      homepageUrl: church.homepage_url,
      lastCrawled: log?.completed_at
    })
  }

  return result
}

/**
 * 트리 구조 빌드
 */
function buildTree(items: any[]): PageInfo[] {
  const map = new Map<number, PageInfo & { id: number }>()
  const roots: PageInfo[] = []

  // 맵 생성
  for (const item of items) {
    map.set(item.id, {
      id: item.id,
      url: item.url || '',
      title: item.title,
      pageType: item.page_type,
      depth: item.depth,
      contentType: item.content_type,
      children: []
    })
  }

  // 트리 구성
  for (const item of items) {
    const node = map.get(item.id)!
    if (item.parent_id && map.has(item.parent_id)) {
      map.get(item.parent_id)!.children!.push(node)
    } else {
      roots.push(node)
    }
  }

  return roots
}
