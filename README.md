# TRYON — Find it. Try it on.

이미지에서 발견한 안경을 잘라내 디지털 프레임으로 만들고, 노트북 웹캠으로 바로 써보는 웹앱.

React (Vite) 앱.

## 실행

```bash
npm install
npm run dev      # http://localhost:5173  (웹캠은 localhost/https 에서만 동작)
npm run build
```

## 구조

- `src/App.jsx` — 3분할 레이아웃 + 모든 상태
- `src/useTryOn.js` — 카메라 · FaceLandmarker · 렌더 루프
- `src/frame.js` — 순수 로직 (얼굴 포즈, 배경 키아웃, 캔버스 드로잉)
- `src/ExtractModal.jsx` — 업로드 → 크롭 → 빌드
- `src/Thumb.jsx` — 컬렉션 썸네일

## MVP 범위

웹캠 + MediaPipe FaceLandmarker 얼굴 추적, 안경 오버레이(얼굴 따라 이동/회전),
착용/제거 애니메이션, 프레임·렌즈 색상, 크기/위치/회전 조절,
이미지 업로드 → 드래그로 안경 영역 선택 → 배경 제거 → 컬렉션 추가.

2차: AI 자동 검출, 3D 프레임 생성, 스마트 핏, 비교 모드, 스냅샷.

## 테스트

```bash
npm test
```
