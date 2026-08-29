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

## 배포

`netlify.toml` / `vercel.json` / `public/_headers` 에 SlimSAM 스레드 wasm이 요구하는
`COOP/COEP` 헤더가 들어 있음. Netlify·Vercel·Cloudflare Pages 중 아무 곳에서나
GitHub 저장소를 연결하면 빌드 설정 없이 바로 배포됨 (Vite 자동 감지, publish = `dist`).

## 구조

- `src/App.jsx` — 레이아웃 + 상태. 컬렉션 관리(삭제·이름변경·PNG 저장), 2D/3D 토글, 비교, 스냅샷 트레이
- `src/useTryOn.js` — 카메라 · FaceLandmarker · 렌더 루프 (2D / 3D / 비교 분기), 스냅샷 합성
- `src/frame.js` — 순수 로직: 얼굴 포즈, 스마트 핏, 오일러각, 행렬 분해, 배경 키아웃, 2D 캔버스 드로잉
- `src/glasses3d.js` — Three.js. 프레임 실루엣 → 절차적 3D 안경, 얼굴 추적 레이어, 얼굴 깊이 마스크, 스펙시트
- `src/faceMesh.js` — FACE_OVAL 인덱스 + 부채꼴 삼각형 (깊이 마스크용)
- `src/segment.js` — SlimSAM 안경 분할 (마스크만)
- `src/measure.js` — **마스크 + 사진 → 프레임 스펙** (모양, 림 두께, 테 색, 렌즈 틴트, 앉은 위치). 순수 함수, node 테스트됨
- `src/extract.js` — 이미지 얼굴 검출. (`cutOut`/`otsu`는 옛 오려붙이기용, 현재 미사용)
- `src/ExtractModal.jsx` — 업로드 → SAM → 측정 → "add to my frames"
- `src/store.js` — localStorage 저장/복원 (측정 프레임은 스펙 + 작은 소스 썸네일 JPEG)
- `src/Thumb.jsx` — 컬렉션 썸네일 (업로드 프레임은 소스 사진 + 모양 아웃라인)

## 기능

**컬렉션** — 업로드로 만든 프레임은 localStorage에 저장돼 새로고침해도 남음. 칩에서 이름변경(더블클릭)·삭제.

**사진에서 안경 (measure, not cut)** — 업로드 → SlimSAM이 안경 마스크를 잡음 → `measureFrame`이
**픽셀을 오려내지 않고 파라미터만 읽음**: 모양(round/square/cat), 림 두께, 테 색(아래쪽 림에서 샘플),
렌즈 틴트, 사진 속 얼굴에서 앉은 위치. 그 스펙으로 절차적 모델을 그림 → 절대 뭉개지지 않음.
바로 "my frames"에 추가되고, 모양·림·색·핏은 전부 메인 화면 오른쪽 패널에서 조절.
마스크가 틀렸으면 모달에서 안경을 클릭(alt-클릭 = 제외)해 SAM을 유도.

**2D 모드** — MediaPipe FaceLandmarker로 얼굴을 따라가는 벡터 프레임 (프리셋·측정 프레임 모두 벡터로 그림).

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
- `measureFrame`의 모양/색 추정은 SAM 마스크 품질에 좌우됨. 마스크가 머리카락까지 먹으면
  모양이 cat으로, 테 색이 머리색으로 읽힐 수 있음 → 그래서 전부 메인 화면에서 수동 보정 가능하게 함.
  개선 여지: 마스크 후처리(가장 큰 연결 요소만), 렌즈 구멍 채우기, 테 색 클러스터링.
- 측정 정확도는 실제 안경 사진으로 검증 필요 (합성 이미지는 SAM이 헷갈려함).
