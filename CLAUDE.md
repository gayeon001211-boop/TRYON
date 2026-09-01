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

## Blender 베이스 메시 — 파이프라인 완성, 메시는 미완

```bash
/Applications/Blender.app/Contents/MacOS/Blender --background \
  --python helper/blender/build_frames.py     # → public/frames/*.glb
```

- 파이프라인은 **끝까지 검증됨**: 스크립트 → glb 4종 → 브라우저 GLTFLoader 로드 → `fitBaseFrame`.
- **그러나 메시 자체가 아직 안경처럼 안 생겼다.** 좌표계(Blender Z-up vs glTF Y-up)와
  베벨 오브젝트 적용 순서를 세 번 고쳤는데도 림이 거대한 세로 고리로 나온다.
  → `blender_bases3.png`(scratchpad) 참고.
- 그래서 **`baseLooksSane()`** 게이트를 넣었다: 바운딩 박스가 가로:세로 1.8~5 범위가
  아니면 로드를 거부하고 절차적 생성으로 폴백. 게다가 base 사용은 `opts.base === true`
  **옵트인**이라 지금은 앱에 영향이 없다.
- **다음 세션의 첫 과제**: `helper/blender/build_frames.py`를 제대로 고치는 것.
  추천 접근 — 오브젝트 회전/스케일에 기대지 말고 **버텍스 좌표를 직접 계산**하거나,
  Blender GUI에서 한 번 제대로 만들어 .blend로 저장하고 스크립트는 내보내기만 담당.

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

## 파이프라인 (현재)

```
업로드
 → detectInImage      얼굴 랜드마크 (없어도 됨)
 → 얼굴 O          → SAM: pickGlassesPoints(브릿지·림 +, 렌즈중심·볼·머리 −) → segment
   얼굴 X + 플레인 배경 → foregroundFromBackground (코너색 keyout, SAM 불필요)
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
| `src/glassesAsset.js` | 순수: `buildAsset` → GlassesAsset. `foregroundFromBackground`, 회전 `bandCrop`, `pairBalance`. 색·형태 분석 |
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

1. **실제 안경 사진으로 검증** — 웹캠 있는 환경에서 뿔테·메탈·선글라스·투명테 각각 업로드.
   debug view로 어느 단계가 깨지는지 확인 (Test A~E: 원본 스펙 문서 참고).
2. **배치 튜닝** — 2D `drawAssetAtPose`, 3D `Glasses3DLayer.update`의 yRatio/forward/spanRatio.
   지금 세로위치가 살짝 높음(눈썹). placement.yRatio 기본값(-0.05)을 0~+0.03으로.
3. **측정 견고화** — colourHoles 임계값 적응화, SAM 마스크 후처리 강화, 프레임/렌즈 색 클러스터링.
4. **3D 정밀 포즈** — 화면앵커+오일러각 → MediaPipe `facialTransformationMatrixes` 4×4.
   `frame.js` `decomposeMatrix` 준비됨. `useTryOn`에서 `outputFacialTransformationMatrixes:true`는 이미 켜짐.
5. **3D 비교 모드** (scissor 렌더), 스펙시트가 실제 geometry 쓰도록 확인.
6. **프리셋 3D 실루엣** 다듬기 (`presets.js` outline이 아직 거침).

## 알려진 이슈

- SlimSAM은 플랫/일러스트 이미지에서 마스크를 크게 잘못 잡음 — 실제 사진에선 나음. 못 잡으면
  모달에서 안경 클릭(alt=제외)으로 유도.
- frontTexture dataURL이 localStorage 용량을 먹음 (~50KB/프레임). `buildFrontTexture` cap 512px.
- extrude 가장자리·temple 스텁이 거침. temple은 정면 제품컷엔 거의 안 보여서 추정값.
