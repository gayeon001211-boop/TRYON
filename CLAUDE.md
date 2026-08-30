# TRYON — project state & handoff

안경 실착 웹앱. 웹캠으로 안경을 써보고, **안경 사진을 업로드하면 그 프레임의 실제 형태·질감을
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
   ★ outline은 항상 실제 trace. `ok`는 confidence 플래그일 뿐, 특이한 형태를
     round/square/cat로 절대 안 바꿈. contour 자체가 안 잡힐 때만 fallbackGeometry.
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
| `src/glassesAsset.js` | 순수: `buildAsset` → GlassesAsset. `foregroundFromBackground`. 색·형태 분석, frontTexture 컷 |
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
