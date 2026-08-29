# TRYON — Find it. Try it on.

이미지에서 발견한 안경을 잘라내 디지털 프레임으로 만들고, 노트북 웹캠으로 바로 써보는 웹앱.
2D 스프라이트 오버레이와, 얼굴에 씌우는 **3D 모델** 두 가지 모드.

React (Vite) 앱.

## 실행

```bash
npm install
npm run dev      # http://localhost:5173  (웹캠은 localhost/https 에서만 동작)
npm run build
npm test
```

## 구조

- `src/App.jsx` — 레이아웃 + 상태. 컬렉션 관리(삭제·이름변경·PNG 저장), 2D/3D 토글, 비교, 스냅샷 트레이
- `src/useTryOn.js` — 카메라 · FaceLandmarker · 렌더 루프 (2D / 3D / 비교 분기), 스냅샷 합성
- `src/frame.js` — 순수 로직: 얼굴 포즈, 스마트 핏, 오일러각, 행렬 분해, 배경 키아웃, 2D 캔버스 드로잉
- `src/glasses3d.js` — Three.js. 프레임 실루엣 → 절차적 3D 안경, 얼굴 추적 레이어, 얼굴 깊이 마스크, 스펙시트
- `src/faceMesh.js` — FACE_OVAL 인덱스 + 부채꼴 삼각형 (깊이 마스크용)
- `src/segment.js` — SlimSAM 안경 분할
- `src/extract.js` — 이미지 얼굴 검출 + 컷아웃
- `src/ExtractModal.jsx` — 업로드 → 클릭 프롬프트 → 빌드 → PNG 저장
- `src/store.js` — localStorage 저장/복원 (추출 프레임은 PNG data URL로 직렬화)
- `src/Thumb.jsx` — 컬렉션 썸네일

## 기능

**컬렉션** — 업로드로 만든 프레임은 localStorage에 저장돼 새로고침해도 남음. 칩에서 이름변경(더블클릭)·삭제·PNG 다운로드.

**2D 모드** — MediaPipe FaceLandmarker로 얼굴을 따라가는 스프라이트. 프리셋(round/square/cat-eye)은 벡터, 업로드 프레임은 텍스처.

**3D 모드** — 프레임에서 절차적 3D 안경(림·브릿지·안경다리·렌즈)을 만들어 얼굴에 씌움.
화면 앵커(눈 중심·눈 간격·롤)로 위치·크기를 잡고, 랜드마크에서 뽑은 yaw/pitch로 3D 회전.
얼굴 외곽 랜드마크로 만든 깊이 마스크가 머리 뒤로 넘어가는 안경다리를 가림.
`spec sheet` 버튼 → 만들어진 3D 모델의 정면/3-4/측면/상면을 한 판에 PNG로.

**스마트 핏** (`auto fit`) — 얼굴 폭에 맞춰 width·position 슬라이더를 자동 설정.

**비교** — 칩의 `A/B`로 프레임 2개를 고르면 스테이지가 좌우 분할(2D)로 나란히.

**스냅샷** — `snapshot`이 현재 화면(2D+3D 합성)을 하단 트레이에 담고, 클릭하면 PNG 저장.

**카메라 전환** — 스테이지의 `front/back` 버튼으로 전/후면 카메라. 후면일 땐 미러링 해제.

**반응형** — 좁은 화면에서 3열 → 세로 스택, 스테이지 sticky.

## 남은 것 / 알려진 이슈 (내일 이어서)

- 3D 안경의 세로 위치·크기가 실제 웹캠에서 미세하게 어긋날 수 있음 — `glasses3d.js`의 `forward`/`yRatio`(0.05)/`spanRatio` 튜닝 필요. 슬라이더로 보정 가능.
- 3D는 화면 앵커 + 랜드마크 오일러각 방식. MediaPipe `facialTransformationMatrixes`(정식 4x4 포즈)로 바꾸면 더 정확 — `frame.js`에 `decomposeMatrix` 헬퍼는 준비됨.
- 안경다리/렌즈 사이 깊이 정렬이 각도에 따라 겹쳐 보일 때가 있음.
- 스펙시트 "후면" 뷰 대신 상면을 넣어둠 (후면 ≈ 정면 대칭이라).
- 비교 모드는 2D만. 3D 비교는 scissor 렌더로 확장 가능.
- 추출 프레임(사진 실루엣)을 3D 데칼로 붙이는 경로는 있으나 정면 평면 데칼 수준. 실루엣 → 압출 지오메트리로 올리면 질감/두께가 살아남.
