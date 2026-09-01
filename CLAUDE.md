# TRYON — project state & handoff

**개인 도구다.** 배포해서 남에게 보여줄 일은 없고 본인만 쓴다(2026-09-01 확인). 그래서
"브라우저에서만 돌린다 / 서버 없다 / 경량 모델" 같은 제약은 더 이상 유효하지 않다.
Vercel 배포(https://chinook-rho.vercel.app)는 편의를 위해 유지하되, 품질은 로컬 우선.

## 로컬 도우미 (2026-09-01 추가)

```bash
npm run helper      # 127.0.0.1:8791, 루프백 전용
npm run dev         # http://localhost:5173
```

- `helper/server.py` — FastAPI. `GET /health`, `POST /warmup`, `POST /segment`
- **SAM 2.1 hiera-large가 MPS(GPU)에서 동작 확인됨**: 최초 로드 174초(캐시 후 8초),
  분리 5.2초, score 0.946. 브라우저 SlimSAM보다 마스크 경계가 확연히 낫다.
- `src/segment.js`의 `helperStatus()`가 400ms 안에 감지 → 있으면 `/segment` 사용,
  없으면 기존 SlimSAM 경로. **호출부(`segment(ctx, points)`) 시그니처는 동일**하다.
- 주의: 포트 8787은 이 머신의 다른 서비스(aside-n8n-bridge)가 쓰고 있어 **8791**을 쓴다.
- `transformers`의 `AutoModel`은 sam2의 **비디오 모델**을 고른다. 반드시 `Sam2Model`을
  명시해야 한다(안 그러면 `missing inference_session` 500).

## Blender 베이스 메시 (2026-09-01 수정 완료)

```bash
/Applications/Blender.app/Contents/MacOS/Blender --background \
  --python helper/blender/build_frames.py     # → public/frames/*.glb
```

- **이제 안경처럼 생겼다.** 커브·베벨 오브젝트·오브젝트 회전/스케일을 전부 버리고
  bmesh에 버텍스 좌표를 직접 쌓는다. 파트는 전부 `sweep(path, section)` 하나로 만든다
  (림=닫힌 스윕, 브리지·안경다리·힌지=열린 스윕, 코받침만 uvsphere+명시 행렬).
- **원인이었던 것**: Blender 오브젝트 스케일은 회전 **전** 로컬 공간에 적용된다.
  베지어 원을 `rotation=(π/2,0,0)`로 세우고 `scale=(w,1,h)`를 주면 원의 두 번째
  평면축에 1.0이 남아 반지름 1의 세로 고리가 된다. 좌표를 직접 쓰면 생기지 않는 문제다.
- 익스포트 직전에 `baseLooksSane()`과 같은 판정을 파이썬 assert로 한다. 치수 출력:
  fullrim 0.960 × 0.332 × 1.120 (w/h 2.89), wire 3.20, browline 2.91, rimless 3.17.
  전부 앱 게이트 통과 확인(headless Chrome로 4종 렌더 → `loaded=ok` + 눈으로 확인).
- 앱에서 base 사용은 여전히 `opts.base === true` 옵트인이고 `baseLooksSane` 게이트도
  안전망으로 남아 있다.

## 세그멘테이션 벤치 (2026-09-01 추가)

```bash
npm run helper                 # 다른 터미널
node bench_seg.mjs             # 기본 helper/bench/photos
```

- SAM 2(헬퍼)와 SlimSAM(브라우저)에 **같은 사진 + 같은 프롬프트 점**을 주고,
  두 마스크를 같은 `buildAsset`에 통과시킨다.
- **정답 마스크가 없으므로 IoU는 정확도가 아니라 일치도다.** 판단 근거는 각 모델의
  자체 score와 마지막 칸(=asset이 실제로 만들어졌는가). 사진은 저장소에 없다 —
  `helper/bench/photos/README.md` 참고, 사용자가 넣는다.
- 얼굴 있는 사진은 `<name>.points.json`으로 프롬프트 점을 옆에 두면 그걸 쓴다.
  없으면 `pickGlassesPoints(null,…)`의 밴드 프롬프트이고, 그 경우 `[blind band prompt]`로
  표시된다 — 밴드 프롬프트는 렌즈 구멍 안에 +점을 찍을 수 있어 결과가 나쁠 수 있다.
- `--dump`를 주면 `<dir>/masks/*.{slim,sam2}.png`에 마스크를 사진 위에 겹쳐 저장한다.
  숫자보다 이 그림이 훨씬 많은 걸 말해준다.

### 2026-09-01 실측 (디자인 시트 3장: cateye / bone / amber, 정면+측면 2뷰 일러스트)

| 프롬프트 | SlimSAM | SAM 2 |
|---|---|---|
| 밴드(블라인드) | 0/3 — **배경 전체를 선택**(score 0.99인데 마스크 반전) | 1/3 |
| 정면에 제대로 찍은 점 | 1/3, 마스크가 얼룩덜룩 | **3/3 (0.94·0.99·0.95)** |

상호 IoU 0.27~0.42 = 두 모델이 사실상 다른 걸 잡았다. **결론: 모델 차이도 크지만
프롬프트 점이 더 크게 좌우한다.** 밴드 프롬프트의 +점(`y=0.42h`)이 렌즈 구멍 안에,
−점(`x=0.06/0.94`)이 넓은 프레임의 끝단에 떨어지는 게 원인.

앱이 실제로 타는 경로(bg keyout)로는 bone 0.99 / amber 0.94 / **cateye 실패** —
크림색 플레어가 흰 배경과 tolerance 안에 들어가 프레임 절반이 키아웃된다.
→ 아래 폴백으로 해결(cateye 0.70 ✗ → 0.95 ✓).

## keyout 실패 시 SAM 폴백 (2026-09-01 추가)

`ExtractModal.onLoad`가 bg keyout 결과가 `!ok`면 그대로 끝내지 않고 SAM으로 넘긴다.
이전엔 `return`으로 끝나서 밝은 프레임 + 흰 배경 제품컷은 손쓸 방법이 없었다
(수동 클릭 보정 UI가 SAM 경로에만 있다).

프롬프트는 밴드가 아니라 **keyout 마스크에서 뽑는다** — `pointsFromMask(mask,w,h,scale)`
(`glassesAsset.js`, 순수, test_asset.mjs):

- `largestComponent(mask,w,h,1)`로 **정면 뷰 하나만** 고른다(디자인 시트는 2뷰).
- **+점**: 그 bbox를 가로로 8등분한 각 열의 최상단·최하단 마스크 픽셀 = 위림·아래림.
- **−점**: 고른 프레임의 행 범위 **밖**에 있는 keyout 픽셀(= 다른 뷰) 3개 + 사진 네 귀퉁이.
- **렌즈 구멍에는 −점을 찍지 않는다.** buildAsset이 구멍을 스스로 판다(형상 + 색 분리)
  고, 그러려면 프레임 앞면이 통짜 마스크여야 한다. 구멍을 −로 찍으면 SAM이 림 재질만
  반환하는데 그게 얼룩덜룩해서 한쪽 렌즈만 남고 브리지가 끊긴다.
  **실측: 구멍 −점 있으면 0.32 + 반쪽 프레임, 없으면 0.95.**
- 좌우로도 −점을 찍지 않는다. keyout은 밝은 프레임의 끝단을 가로로 놓치는데, 거기에
  −를 찍으면 놓친 부분을 확정적으로 버리게 된다.

## 무엇인가

웹캠 앞에서 안경을 써보는 도구. **업로드한 안경 사진에서 프레임을
추출해** 2D/3D로 얼굴에 씌운다. React + Vite, 서버·계정 없음.

이 파일은 세션·노트북·계정이 바뀌어도 이어서 작업할 수 있도록 현재 상태를 적어둔 것이다.
코드를 바꾸면 이 파일의 "현재 상태"와 "다음 할 것"도 같이 갱신할 것.

## 실행

```bash
npm install
npm run dev      # http://localhost:5173  (웹캠은 localhost/https 에서만)
npm test         # test_frame.mjs + test_contour.mjs + test_asset.mjs (순수 로직)
npm run build
```

- **Node.js 필요** (저장소에 없음). 없으면 nodejs.org v22 설치 또는 `sudo port install nodejs22 npm10`.
- 브라우저 미리보기 환경에 카메라가 없을 수 있음 → 합성 얼굴을 `canvas.captureStream()`으로
  `getUserMedia` 오버라이드해서 테스트. 단 SlimSAM은 합성 이미지(플랫 일러스트)를 잘 못 잡으니
  추출 정확도는 **실제 안경 사진**으로 검증해야 함.

## 얼굴 프로필 (2026-09-01 추가)

카메라로 착용자를 먼저 재고(`MEASURE MY FACE`), 그 치수를 자로 삼아 업로드한 프레임을 측정한다.

```
카메라 ON → measureFace(랜드마크 30프레임) → averageProfile(중앙값) → settings에 저장
  mmPerPx = PD(기본 63mm, 사용자 수정 가능) / 홍채간 거리
  faceWidthMm · browAboveEyeMm · bridgeDropMm · templeLenMm
업로드 시 프로필이 있으면:
  프레임 전체 폭 = 얼굴폭 × 0.98  → 렌즈/브리지/림이 mm를 얻음 (`52 □ 18 − 145` 표기)
  placement(spanRatio·yRatio) = 이 얼굴의 PD·눈썹선에서 (레퍼런스 사진 얼굴 대신)
  templeLen = 측정된 귀까지 거리 (더 이상 추정값 아님)
프로필이 없으면 이전 동작 그대로.
```

★ PD 63mm는 **가정값**이다. 처방전 PD를 넣으면 전부 선형으로 정확해진다.
★ MediaPipe z가 상대값이라 `templeLenMm` 오차가 가장 크다.

**측정 신뢰도 (2026-09-01 추가)** — 아래 숫자 전부가 이 한 번의 측정에 비례하므로,
잘 쟀는지를 UI가 말해준다. `averageProfile`이 `frames`/`spreadMm`(faceWidthMm p90−p10)/
`yawDeg`/`steady`를 반환하고 "my face" 패널이 `28/30 frames · ±0.6mm · steady`로 표시한다.
`yawDeg`(관자놀이 중점 대비 눈 중점의 어긋남, `YAW_LIMIT_DEG`=12°)를 넘으면 경고 —
고개가 돌아가면 얼굴 폭이 좁게 나오고, 그건 착용자가 고칠 수 있는 유일한 오차다.
`frame.js`의 `eulerFromLandmarks`는 3D 포즈용으로 튜닝됐고 코끝(lm[1])이 필요해서 안 쓴다.

**실사용 검증 (님이 직접 — 아직 안 함)**: 정면·팔 길이·균일한 조명에서 measure →
얼굴 폭 130–150mm(자로 관자놀이 사이 재서 대조), 안경다리 130–150mm(**가진 안경 다리에
인쇄된 숫자와 대조 — 가장 좋은 검증**), frames 25/30 이상, ±1mm 이하, yaw 경고 없음.
처방전 PD를 넣고 얼굴 폭이 자로 잰 값과 맞으면 전체 스케일이 검증된 것.
고개를 15° 돌려 다시 측정 → 경고가 뜨는지 확인.

## 파이프라인 (현재)

```
업로드
 → detectInImage      얼굴 랜드마크 (없어도 됨)
 → 얼굴 O          → SAM: pickGlassesPoints(브릿지·림 +, 렌즈중심·볼·머리 −) → segment
   얼굴 X + 플레인 배경 → foregroundFromBackground (코너색 keyout, SAM 불필요)
       └ 그 결과가 !ok 이면 → pointsFromMask(keyout 마스크) → SAM  (2026-09-01 추가)
   얼굴 X + 복잡 배경   → SAM (band 프롬프트)
 → buildAsset(imageData, mask, w, h, landmarks)   [glassesAsset.js, 순수]
     largestComponent(minRatio) → morphClose/Open → connectComponents(좌우 렌즈 연결)
       → fillHoles → traceContour(Moore) + Douglas-Peucker  = outline 폴리곤
     lens 구멍: detectHoles → colourHoles(frameColor 기준 색분리) → 랜드마크 타원 폴백
     frameColor(boundary shell), lensColor/opacity(luma+chroma), rimRatio, placement
     frontTexture: 원본에서 프레임 형태로 잘라낸 실제 픽셀 (배경·렌즈 투명) + textureBox
     → GlassesAsset { ok, geometry{outline,lensL,lensR,bridge,hingeL,hingeR},
        frontTexture, textureBox, dimensions, frameColor, lensColor, lensOpacity,
        placement{spanRatio,yRatio}, quality, stages }
   ★ (2026-08-31 변경) 추적한 outline은 **최종 형상이 아니라 측정값**이다.
     `eyewear.js`의 `eyewearSpec`이 렌즈 반경 프로파일을 좌우 대칭화 + 저역통과(하모닉 4)
     하고, 렌즈 폭/높이·간격·림 두께·깊이를 뽑는다. 모델은 그 치수로 **림 2개 + 브리지 +
     엔드피스 + 힌지 + 안경다리**를 새로 만든다. 실루엣을 그대로 압출하면 좌우 비대칭에
     계단이 남아 "스티로폼 조각"이 되고 사람이 쓸 수 있는 형태가 아니기 때문이다.
     원본의 큰 형태(라운드/사각/캣아이)와 비율·색은 살아남고, 잔굴곡은 정리된다.
 → ExtractModal: front/¾/side 프리뷰(전부 asset에서) + 6단계 debug view → "ADD TO MY FRAMES"
 → store.js (localStorage 'tryon.v2', asset를 JSON으로. frontTexture는 dataURL)

렌더:
 2D: assetRender.drawAssetAtPose → frontTexture를 포즈에 맞춰 그림 (없으면 flat fill)
 3D: glassesModel.buildGlassesFromAsset → THREE.Shape(outline).holes → ExtrudeGeometry,
     + outline 형태 front plane에 frontTexture UV 매핑 (플랫 스티커 아님, 3D 위에 텍스처),
     + 렌즈면, + hinge에서 temple 튜브
     glasses3d.Glasses3DLayer가 화면앵커(눈중심·눈간격·롤) + 랜드마크 yaw/pitch로 배치,
     FACE_OVAL 깊이 마스크로 머리 뒤 안경다리 가림
```

## 모듈

| 파일 | 역할 |
|---|---|
| `src/contour.js` | 순수: largestComponent(minRatio), connectComponents, fillHoles, morph, detectHoles, traceContour, simplify(DP), poly helpers |
| `src/glassesAsset.js` | 순수: `buildAsset` → GlassesAsset. `foregroundFromBackground`, `pointsFromMask`(keyout 마스크 → SAM 프롬프트), 회전 `bandCrop`, `pairBalance`. 색·형태 분석 |
| `src/faceProfile.js` | 순수: `measureFace`/`averageProfile`/`withPd`/`frameSpecMm`/`placementFor` — 착용자 측정 |
| `src/fit.js` | 순수: `rasterSpec`/`iou`/`fitSpec`/`applyFit` — 만든 모델을 원본 마스크와 대조해 파라미터 보정 |
| `src/eyewear.js` | 순수: 측정값 → 착용 가능한 프레임 스펙 (`radialProfile`/`lowPass`/`canonicalLens`/`eyewearSpec`) |
| `src/assetRender.js` | 2D 캔버스: `drawAssetFront`, `drawAssetAtPose`, `assetThumb` |
| `src/glassesModel.js` | Three.js: `buildGlassesFromAsset` (extrude + 텍스처 plane + 렌즈 + temple) |
| `src/glasses3d.js` | Three.js: `Glasses3DLayer` (추적·배치·occluder·contactSheet) |
| `src/presets.js` | round/square/cat을 GlassesAsset으로 (하드코딩 폴리곤) |
| `src/useTryOn.js` | 카메라 + FaceLandmarker VIDEO 루프, 2D/3D/비교 분기, 스냅샷 |
| `src/frame.js` | 순수: poseFromEyes, smartFit, eulerFromLandmarks, decomposeMatrix |
| `src/segment.js` | SlimSAM load/embed/segment + `pickGlassesPoints` |
| `src/extract.js` | `detectInImage` (MediaPipe 정지영상, 478 landmark incl. iris) |
| `src/store.js` | localStorage v2 |
| `src/faceMesh.js` | FACE_OVAL 인덱스 + 부채꼴 |
| `src/ExtractModal.jsx` | 업로드 → 추출 → 프리뷰 + debug → 추가 |
| `src/App.jsx` | 레이아웃·상태, 컬렉션, 비교, 스냅샷, 오른쪽 컨트롤 패널 |
| `src/Thumb.jsx` | 칩 썸네일 (소스 사진 + outline) |

## 현재 상태 (2026-08-30, 커밋 7d295b8)

- **동작**: 프리셋 3종 2D/3D 렌더 + 페이스 트래킹. 얼굴 없는 제품컷 → 배경 keyout →
  실제 organic outline + 실제 픽셀 텍스처 + 렌즈 틴트 추출 → 2D/3D 실착 (합성 줄무늬
  제품컷으로 검증됨).
- **미배포**. 저장소 비공개 + 무료 GitHub 계정이라 Pages 불가. `netlify.toml`/`vercel.json`
  준비됨 — Netlify/Vercel에 repo 연결하면 됨.

## 다음 할 것 (우선순위)

1. **`pickGlassesPoints`의 밴드 프롬프트를 고칠 것** — 얼굴 없고 배경이 복잡한 사진은
   아직 이 블라인드 밴드를 타고, 실측에서 두 모델 모두 여기서 깨졌다. keyout이 못 쓰는
   배경이라 `pointsFromMask`도 못 쓴다. 아이디어: 중앙 밴드에서 색 클러스터링으로
   프레임 후보를 먼저 찾기, 혹은 아예 사용자에게 클릭을 먼저 요구.
2. **사진 더 넣고 검증** — 실제 *사진*(일러스트 아님) 뿔테·메탈·선글라스·투명테.
   `npm run helper` + `node bench_seg.mjs --dump`.
3. **얼굴 측정 실사용** — 위 "실사용 검증" 절차. 안 맞는 숫자가 나오면 `templeLenMm` 보정.
4. **배치 튜닝** — 2D `drawAssetAtPose`, 3D `Glasses3DLayer.update`의 yRatio/forward/spanRatio.
   지금 세로위치가 살짝 높음(눈썹). placement.yRatio 기본값(-0.05)을 0~+0.03으로.
5. **측정 견고화** — colourHoles 임계값 적응화, SAM 마스크 후처리 강화, 프레임/렌즈 색 클러스터링.
6. **3D 정밀 포즈** — 화면앵커+오일러각 → MediaPipe `facialTransformationMatrixes` 4×4.
   `frame.js` `decomposeMatrix` 준비됨. `useTryOn`에서 `outputFacialTransformationMatrixes:true`는 이미 켜짐.
7. **베이스 메시 마감** — 지금은 스윕 단면이 사각형인데 smooth shading 때문에 튜브처럼
   보인다. 아세테이트 느낌을 원하면 림만 flat shading, 혹은 단면을 라운드 사각으로.
   base를 기본으로 켜는(`opts.base`) 결정도 그 다음.
8. **3D 비교 모드** (scissor 렌더), 스펙시트가 실제 geometry 쓰도록 확인.
9. **프리셋 3D 실루엣** 다듬기 (`presets.js` outline이 아직 거침).

## 알려진 이슈

- SlimSAM은 플랫/일러스트 이미지에서 마스크를 크게 잘못 잡음 — 실제 사진에선 나음. 못 잡으면
  모달에서 안경 클릭(alt=제외)으로 유도.
- frontTexture dataURL이 localStorage 용량을 먹음 (~50KB/프레임). `buildFrontTexture` cap 512px.
- extrude 가장자리·temple 스텁이 거침. temple은 정면 제품컷엔 거의 안 보여서 추정값.
