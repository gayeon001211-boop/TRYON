# TRYON — Find it. Try it on.

안경 사진을 업로드하면 그 프레임의 **실제 외곽선과 픽셀을 추출**해서 2D/3D로 얼굴에 씌우는 웹앱.
웹캠으로 실시간 실착, 프레임 컬렉션, 비교, 스냅샷. React + Vite, 서버·계정 없음.

> 현재 상태 · 아키텍처 · 다음 할 것은 [`CLAUDE.md`](./CLAUDE.md) 참고.
> 세션·노트북·계정이 바뀌면 `git pull` → `npm install` → (Node 설치) 로 이어서 작업.

## 실행

```bash
npm install
npm run dev      # http://localhost:5173  (웹캠은 localhost/https 에서만)
npm test
npm run build
```

Node.js가 저장소에 없으므로 새 노트북에선 따로 설치해야 한다 (nodejs.org v22 또는
`sudo port install nodejs22 npm10`).

## 어떻게 동작하나

1. 안경 사진 업로드
2. 얼굴이 있으면 SlimSAM으로, 없고 배경이 플레인하면 배경 keyout으로 안경 영역 마스크
3. `buildAsset` — 마스크에서 **실제 외곽선을 추적**(Moore + Douglas-Peucker), 렌즈 구멍 검출,
   테 색·렌즈 틴트·림 두께 측정, **원본 프레임 픽셀을 프레임 형태로 잘라냄**(`frontTexture`)
   → `GlassesAsset` (얼굴 없이 독립적으로 렌더 가능)
4. 미리보기(front/¾/side) + 디버그(6단계) 확인 후 컬렉션에 추가
5. 2D: 텍스처를 얼굴 포즈에 맞춰 그림 / 3D: 외곽선을 extrude하고 그 위에 텍스처 매핑,
   MediaPipe FaceLandmarker로 얼굴 추적
6. 오른쪽 패널에서 fit(너비/높이/x/y/스케일/회전) · frame(두께/투명도/색) · lens(틴트/색) 조절

**핵심**: round/square/cat 같은 generic 형태로 바꾸지 않는다. 추적한 외곽선을 그대로 쓰고,
그 위에 업로드한 프레임의 실제 픽셀을 얹는다. shape override 프리셋은 추출이 완전히 실패했을 때만.

## 기능

- **컬렉션** — 업로드한 프레임은 localStorage에 저장(새로고침 유지). 칩에서 이름변경(더블클릭)·삭제
- **2D / 3D 토글**, **비교**(칩 `A/B`로 두 프레임 좌우 분할), **스냅샷**(현재 화면 → 하단 트레이 → PNG)
- **auto fit** — 얼굴 폭에 맞춰 슬라이더 자동
- **spec sheet** — 만들어진 3D 모델의 정면/¾/측면/상면을 한 판 PNG로
- **카메라 전환** — 전/후면 (후면은 미러링 해제), 좁은 화면 세로 스택

## 배포

`netlify.toml` / `vercel.json` / `public/_headers`에 SlimSAM 스레드 wasm이 요구하는
`COOP/COEP` 헤더가 있음. Netlify·Vercel·Cloudflare Pages에 저장소를 연결하면 빌드 설정 없이
바로 배포됨 (Vite 자동 감지, publish = `dist`). GitHub Pages는 저장소를 공개로 바꿔야 무료.
