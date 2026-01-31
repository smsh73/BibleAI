/**
 * 열한시 신문 OCR 테스트 스크립트
 * Vision API를 사용하여 신문 이미지에서 한글 텍스트를 추출합니다.
 * Fallback 순서: OpenAI -> Gemini -> Claude
 */

import * as dotenv from 'dotenv'
import * as path from 'path'

// .env.local 파일 로드
dotenv.config({ path: path.join(__dirname, '../.env.local') })

import OpenAI from 'openai'
import Anthropic from '@anthropic-ai/sdk'
import { GoogleGenerativeAI } from '@google/generative-ai'
import * as fs from 'fs'

// API 클라이언트 초기화
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY || '')

const OCR_PROMPT = `이 이미지는 한국 교회의 월간 신문 "열한시"의 한 면입니다.
이미지에서 모든 한글 텍스트를 정확하게 추출해주세요.

추출 규칙:
1. 제목, 소제목, 본문 내용을 모두 추출
2. 기사별로 구분하여 추출 (--- 로 구분)
3. 사진 캡션도 포함
4. 광고 문구도 포함
5. 원본 텍스트를 최대한 그대로 유지
6. 줄바꿈과 단락 구조 유지

형식:
[기사 1]
제목: (제목)
내용: (본문 내용)
---
[기사 2]
...`

// OpenAI Vision API
async function extractWithOpenAI(base64Image: string): Promise<string> {
  console.log('  -> OpenAI Vision API 시도 중...')
  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: OCR_PROMPT },
          {
            type: 'image_url',
            image_url: {
              url: `data:image/jpeg;base64,${base64Image}`,
              detail: 'high'
            }
          }
        ]
      }
    ],
    max_tokens: 4096
  })
  return response.choices[0].message.content || ''
}

// Gemini Vision API
async function extractWithGemini(base64Image: string): Promise<string> {
  console.log('  -> Gemini Vision API 시도 중...')
  const model = genAI.getGenerativeModel({ model: 'gemini-1.5-pro' })

  const result = await model.generateContent([
    {
      inlineData: {
        mimeType: 'image/jpeg',
        data: base64Image
      }
    },
    { text: OCR_PROMPT }
  ])

  return result.response.text()
}

// Claude Vision API
async function extractWithClaude(base64Image: string): Promise<string> {
  console.log('  -> Claude Vision API 시도 중...')
  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 4096,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: 'image/jpeg',
              data: base64Image
            }
          },
          { type: 'text', text: OCR_PROMPT }
        ]
      }
    ]
  })

  const textBlock = response.content.find(block => block.type === 'text')
  return textBlock ? (textBlock as any).text : ''
}

// Fallback 순서로 OCR 실행
async function extractTextFromImage(imagePath: string): Promise<{ text: string; provider: string }> {
  const imageBuffer = fs.readFileSync(imagePath)
  const base64Image = imageBuffer.toString('base64')

  console.log(`\n이미지 분석 중: ${path.basename(imagePath)}`)
  console.log(`이미지 크기: ${(imageBuffer.length / 1024).toFixed(1)} KB`)

  // 1. OpenAI 시도
  try {
    const text = await extractWithOpenAI(base64Image)
    return { text, provider: 'OpenAI' }
  } catch (error: any) {
    console.log(`  -> OpenAI 실패: ${error.message}`)
  }

  // 2. Gemini 시도
  try {
    const text = await extractWithGemini(base64Image)
    return { text, provider: 'Gemini' }
  } catch (error: any) {
    console.log(`  -> Gemini 실패: ${error.message}`)
  }

  // 3. Claude 시도
  try {
    const text = await extractWithClaude(base64Image)
    return { text, provider: 'Claude' }
  } catch (error: any) {
    console.log(`  -> Claude 실패: ${error.message}`)
  }

  throw new Error('모든 OCR 서비스가 실패했습니다.')
}

async function main() {
  const testImagePath = '/Users/seungminlee/Downloads/BibleAI/bible-chatbot/data/news-test/sample-504-1.jpg'

  if (!fs.existsSync(testImagePath)) {
    console.error('테스트 이미지가 없습니다:', testImagePath)
    process.exit(1)
  }

  console.log('===== 열한시 신문 OCR 테스트 =====')
  console.log('Fallback 순서: OpenAI -> Gemini -> Claude')
  console.log('테스트 이미지:', testImagePath)

  try {
    const { text: extractedText, provider } = await extractTextFromImage(testImagePath)

    console.log(`\n===== 추출된 텍스트 (${provider}) =====\n`)
    console.log(extractedText)

    // 결과 파일 저장
    const outputPath = testImagePath.replace('.jpg', `-ocr-${provider.toLowerCase()}.txt`)
    fs.writeFileSync(outputPath, extractedText, 'utf-8')
    console.log(`\n결과 저장: ${outputPath}`)

    // 텍스트 통계
    console.log('\n===== 통계 =====')
    console.log(`사용된 API: ${provider}`)
    console.log(`총 문자 수: ${extractedText.length}`)
    console.log(`총 줄 수: ${extractedText.split('\n').length}`)

  } catch (error: any) {
    console.error('OCR 오류:', error.message)
  }
}

main()
