# YouTube 설교 스크립트 추출 기능

## 현재 구현 상태

YouTube 설교 동영상에서 스크립트(자막)를 추출하는 기능이 구현되었습니다.

### 구현된 기능

1. **수동 시간 범위 지정**
   - 설교 시작 시간과 종료 시간을 직접 입력
   - 자동 감지 대신 정확한 시간 범위로 설교 구간 추출

2. **API 엔드포인트** (`/api/youtube/transcript`)
   - YouTube URL과 시간 범위를 받아 스크립트 추출
   - 500자 청크로 자동 분할 (20% 오버랩)

3. **테스트 페이지** (`/test-youtube`)
   - YouTube URL 입력
   - 설교 시작/종료 시간 입력 (초 단위)
   - 추출 결과 미리보기

4. **관리자 페이지**
   - YouTube API 키 등록 기능 추가 (드롭다운에서 선택 가능)

## 사용 방법

### 1. 웹 인터페이스 사용

1. 개발 서버 실행
```bash
npm run dev
```

2. `http://localhost:3000/test-youtube` 접속

3. YouTube 동영상 URL 입력

4. "설교 구간만 추출" 체크

5. 시작 시간과 종료 시간 입력 (초 단위)
   - 예: 시작 120초 (2분), 종료 3600초 (1시간)

6. "스크립트 추출" 버튼 클릭

### 2. API 직접 호출

```javascript
const response = await fetch('/api/youtube/transcript', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    videoUrl: 'https://youtu.be/VIDEO_ID',
    extractSermonOnly: true,
    startTime: 120,  // 2분
    endTime: 3600    // 1시간
  })
})

const data = await response.json()
console.log(data.chunks) // 추출된 청크들
```

### 3. 프로그래밍 방식

```typescript
import { extractSermonTranscript, chunkTranscript } from '@/lib/youtube'

// 전체 스크립트 추출
const fullResult = await extractSermonTranscript(videoUrl)

// 설교 구간만 추출 (2분 ~ 1시간)
const sermonResult = await extractSermonTranscript(videoUrl, 120, 3600)

// 청크로 분할
const chunks = chunkTranscript(sermonResult.sermonSection.segments, 500, 100)
```

## 주의사항

### 자막 가용성

youtube-transcript 라이브러리는 다음 조건에서만 작동합니다:

1. **자막이 있는 동영상**
   - 수동 자막 (업로더가 직접 추가)
   - 자동 생성 자막 (YouTube AI)

2. **공개 동영상**
   - 비공개/비상장 동영상은 접근 불가
   - 연령 제한 동영상은 제한적

3. **YouTube 정책 준수**
   - 일부 동영상은 자막 추출이 제한될 수 있음

### 자막이 없는 경우

동영상에 자막이 없으면 다음과 같이 표시됩니다:
```
전체 세그먼트: 0개
⚠️ 이 동영상에는 자막이 없거나 접근할 수 없습니다.
```

**해결 방법:**
1. YouTube 동영상 페이지에서 자막(CC) 버튼 확인
2. 자막이 없으면 YouTube Studio에서 자막 추가
3. 또는 다른 동영상 사용

## 시간 입력 가이드

### 초 단위 변환

| 시간 | 초 |
|------|-----|
| 1분 | 60 |
| 2분 | 120 |
| 5분 | 300 |
| 10분 | 600 |
| 30분 | 1800 |
| 1시간 | 3600 |

### 시:분:초 → 초 변환 공식

```
초 = (시간 × 3600) + (분 × 60) + 초
```

예시:
- 1:30:00 = (1 × 3600) + (30 × 60) + 0 = 5400초
- 0:15:30 = (0 × 3600) + (15 × 60) + 30 = 930초

## 트러블슈팅

### 문제 1: "스크립트 추출 실패"

**원인:**
- 동영상에 자막이 없음
- 비공개 동영상
- YouTube 접근 제한

**해결:**
1. YouTube에서 동영상 재생 시 자막(CC) 확인
2. 동영상이 공개 상태인지 확인
3. 다른 공개 동영상으로 테스트

### 문제 2: "0개 세그먼트"

**원인:**
- 지정한 시간 범위에 자막이 없음
- 전체 동영상 길이보다 긴 시간 지정

**해결:**
1. 먼저 `extractSermonOnly: false`로 전체 스크립트 확인
2. 실제 동영상 길이 확인
3. 올바른 시간 범위 재입력

### 문제 3: youtube-transcript 라이브러리 오류

**원인:**
- YouTube API 변경
- 라이브러리 버전 이슈

**해결:**
```bash
npm update youtube-transcript
```

## 대안: YouTube Data API v3

youtube-transcript가 작동하지 않는 경우, 공식 YouTube Data API v3 사용:

1. [Google Cloud Console](https://console.cloud.google.com) 접속
2. YouTube Data API v3 활성화
3. API 키 생성
4. 관리자 페이지에서 YouTube API 키 등록

**주의:** YouTube Data API v3는 자막 다운로드를 직접 지원하지 않습니다. 캡션 트랙 목록만 제공하며, 실제 자막 내용은 별도 요청이 필요합니다.

## 다음 단계

1. ✅ 수동 시간 범위 입력
2. ✅ API 엔드포인트 구현
3. ✅ 테스트 페이지 구현
4. ⬜ YouTube Data API v3 통합 (공식 API)
5. ⬜ 추출된 설교 스크립트 벡터 임베딩
6. ⬜ 성경 데이터와 함께 검색
7. ⬜ 설교 + 성경 통합 응답 생성

## 파일 구조

```
bible-chatbot/
├── lib/
│   └── youtube.ts                        # YouTube 스크립트 추출 로직
├── app/
│   ├── api/
│   │   └── youtube/
│   │       └── transcript/route.ts       # API 엔드포인트
│   ├── test-youtube/
│   │   └── page.tsx                      # 테스트 페이지
│   └── admin/
│       └── page.tsx                      # 관리자 페이지 (YouTube API 키 추가)
├── scripts/
│   ├── test-youtube.ts                   # 테스트 스크립트
│   └── test-youtube-simple.ts            # 간단한 테스트
└── types/
    └── index.ts                          # AIProvider에 'youtube' 추가
```

## 라이선스

MIT License
