# TRYON — Find it. Try it on.

이미지에서 발견한 안경을 잘라내 디지털 프레임으로 만들고, 노트북 웹캠으로 바로 써보는 웹앱.

## 실행

```bash
python3 -m http.server 8000
# http://localhost:8000  (웹캠은 localhost/https 에서만 동작)
```

## MVP 범위

웹캠 + MediaPipe FaceLandmarker 얼굴 추적, 안경 오버레이(얼굴 따라 이동/회전),
착용/제거 애니메이션, 프레임·렌즈 색상, 크기/위치/회전 조절,
이미지 업로드 → 드래그로 안경 영역 선택 → 배경 제거 → 컬렉션 추가.

2차: AI 자동 검출, 3D 프레임 생성, 스마트 핏, 비교 모드, 스냅샷.

## 테스트

```bash
node test_frame.mjs
```
