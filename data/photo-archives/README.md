# 팀 공유용 폐기물 사진 수집 ZIP

사용자가 전달한 ZIP 7개를 원본 그대로 보관한다. 팀원은 아래 링크에서 필요한 ZIP만 받거나 Git LFS로 전체 자료를 받을 수 있다. 저장소 접근 권한이 필요하다.

각 ZIP에는 이미지 파일명 항목 100개와 출처 CSV 1개가 있다. 총 700개 항목이며, **인수 완료 사례 700건이나 검증된 정답 데이터 700건을 의미하지 않는다.** 재사용 허락과 촬영 진위는 CSV 전 행에서 `미확인`이다.

## 파일 목록

| ZIP | 크기(바이트) | 실제 내부 사진 폴더 | 출처 CSV(100행) |
| --- | ---: | --- | --- |
| [01_plastic_100.zip](01_plastic_100.zip) | 37,356,826 | `폐플라스틱/` | `plastic_sources.csv` |
| [02_metal_100.zip](02_metal_100.zip) | 52,790,626 | `금속스크랩/` | `metal_sources.csv` |
| [03_wood_100.zip](03_wood_100.zip) | 65,781,774 | `폐목재/` | `wood_sources.csv` |
| [04_packaging_100.zip](04_packaging_100.zip) | 53,474,684 | `폐포장재/` | `packaging_sources.csv` |
| [05_sludge_100.zip](05_sludge_100.zip) | 32,021,068 | `공정오니/` | `sludge_sources.csv` |
| [06_rubber_100.zip](06_rubber_100.zip) | 48,072,563 | `폐고무/` | `rubber_sources.csv` |
| [07_construction_100.zip](07_construction_100.zip) | 43,917,348 | `건설폐기물/` | `construction_sources.csv` |

ZIP 합계는 **333,414,889바이트(약 318MiB)**이다. 원본 ZIP과 CSV는 수정하지 않았다.

## 다운로드

### GitHub 화면에서 필요한 ZIP만 받기

1. 위 표에서 ZIP 파일을 선택한다.
2. 파일 화면의 **Download / Download raw file** 버튼으로 ZIP 본문을 저장한다.
3. 아래 크기·SHA-256으로 확인한 뒤 압축을 해제한다.

ZIP은 Git LFS로 저장했다. 몇 줄짜리 `version https://git-lfs.github.com/spec/v1` 텍스트가 내려왔다면 ZIP 본문이 아니라 LFS 포인터를 받은 것이다. 이 경우 아래 Git LFS 방법을 사용한다. 저장소 전체 **Code → Download ZIP**의 LFS 포함 여부는 저장소 설정에 따라 달라지므로 개별 ZIP 다운로드 또는 Git LFS를 사용한다. [GitHub의 LFS 설명](https://docs.github.com/en/repositories/working-with-files/managing-large-files/about-git-large-file-storage), [파일 다운로드 안내](https://docs.github.com/en/repositories/working-with-files/using-files/viewing-and-understanding-files).

PR 병합 전 자료는 `hyeobikong/photo-archives-20261112` 브랜치에 있다. main에서 일반 `git pull`만 해서는 이 브랜치의 자료가 반영되지 않는다.

### 기존 작업 브랜치를 유지하면서 Git LFS로 받기

Git LFS가 설치된 환경에서 기존 `resource-ai` 저장소 루트에서 실행한다. `git lfs version`이 실패하면 Git LFS부터 설치한다. 기존 브랜치를 전환하지 않고, 상위 폴더에 자료 열람용 별도 worktree를 만든다. 두 번째 경로가 이미 있으면 새 경로를 사용하고 이후 명령에도 같은 경로를 적용한다.

```sh
git lfs version
git lfs install --local
git fetch origin
git worktree add --detach ../resource-ai-photo-archives origin/hyeobikong/photo-archives-20261112
git -C ../resource-ai-photo-archives lfs pull --include="data/photo-archives/*.zip" --exclude= origin
git -C ../resource-ai-photo-archives lfs fsck --objects HEAD
git -C ../resource-ai-photo-archives lfs fsck --pointers HEAD
```

ZIP 위치는 `../resource-ai-photo-archives/data/photo-archives/`이다. worktree는 저장소의 Git/LFS 저장 공간을 공유한다. 접근 권한·LFS 다운로드 오류가 나면 다운로드 실패 상태로 확인하고, 포인터 파일을 ZIP으로 사용하지 않는다.

## 무결성 확인과 압축 해제

Windows PowerShell에서 아래와 같이 SHA-256을 확인한다. 웹에서 받았다면 ZIP 7개만 별도 폴더에 모으고 `$archiveDir`를 그 폴더로 바꾼다.

```powershell
$archiveDir = (Resolve-Path "../resource-ai-photo-archives/data/photo-archives").Path
Get-ChildItem -LiteralPath $archiveDir -Filter "*.zip" | Get-FileHash -Algorithm SHA256
```

기대 SHA-256은 다음과 같다. 해시 비교에서는 영문 대소문자를 구분하지 않는다.

```text
792500795a3fecc3696363dda46ee172173d68cd0719637b92f62c09ade2998c  01_plastic_100.zip
940e074580681732bb42c1f6cf9f7ec633b7ddc64b91b8e6497d97fbec782278  02_metal_100.zip
40183b4d0dfefec1c61031847ecdeb6d77672b73ba3faced2df5f745a41d69d1  03_wood_100.zip
fa51d8eaf71b5af0760152a37c2150c85a38c0a534a7d29353528f76a4e983b2  04_packaging_100.zip
9e8da33e6e65e7a2665b7fef27c16a7e359852cbaf7e99a102f1f90b67ec2cf7  05_sludge_100.zip
1f19db738fb16b419c8eadc1aba983c7337f9cf1610705fe2e2b2549e985ecf2  06_rubber_100.zip
470f2ddb40557bb954c39640c6e07ad479cf100815486cb30ca147bd6c7ff7bc  07_construction_100.zip
```

해시가 일치한 ZIP만 별도 폴더에 해제한다. 다음 예시는 앞에서 사용한 기존 저장소 루트에서 이어 실행하며, 기존 폴더가 있으면 중단해 덮어쓰기를 피한다. 웹 다운로드의 경우에도 `$archiveDir`만 지정하면 같은 방식으로 해제할 수 있다.

```powershell
$extractRoot = Join-Path (Get-Location).Path "../resource-ai-photo-archives-extracted"
if (Test-Path -LiteralPath $extractRoot) {
    throw "압축 해제 대상이 이미 있습니다. 새 폴더를 지정하세요."
}
Get-ChildItem -LiteralPath $archiveDir -Filter "*.zip" | ForEach-Object {
    $target = Join-Path $extractRoot $_.BaseName
    Expand-Archive -LiteralPath $_.FullName -DestinationPath $target -ErrorAction Stop
}
```

예를 들어 플라스틱 ZIP은 `resource-ai-photo-archives-extracted/01_plastic_100/폐플라스틱/`에 사진이, `01_plastic_100/plastic_sources.csv`에 출처 목록이 생긴다. 해제본은 저장소 밖에 두고 자동으로 Git에 추가하지 않는다.

## CSV와 실제 파일을 연결할 때

CSV는 UTF-8 BOM이며 열은 `유형`, `번호`, `파일`, `이미지설명`, `출처사이트`, `원문페이지`, `이미지URL`, `가로px`, `세로px`, `SHA256`, `재사용허락`, `분류근거`, `촬영진위`이다.

- **CSV 경로와 실제 폴더명이 700행 모두 다르다.** 예를 들어 CSV의 `01_폐플라스틱/plastic_001.jpg`는 ZIP 내부에서 `폐플라스틱/plastic_001.jpg`이다. CSV의 `파일` 열을 그대로 파일 경로로 사용하지 않는다.
- 해당 ZIP 내부에서 파일명으로 대조하고 `SHA256`으로 확인한다. 이번 확인에서는 ZIP별 100행 모두 파일명이 하나의 항목과 연결됐고, CSV 해시가 실제 항목의 바이트와 일치했다. 자동화할 때도 경로·동일 파일명 중복·해시를 검증한다.
- `금속스크랩/metal_095.img`, `폐고무/rubber_066.img`는 `.img` 확장자다. 파일 선두에서는 JPEG 표식을 확인했지만 전체 디코딩 통과를 뜻하지 않는다. 원본은 보존했고, 확장자만으로 MIME이나 사용 가능 여부를 확정하지 않는다.
- 700개 바이트 SHA-256은 서로 달랐다. 이는 동일 바이트 중복이 없다는 뜻이며, 같은 장면의 리사이즈·편집본 등 의미상 중복이 없다는 보장은 아니다.

## 활용 범위와 남은 확인

팀 내부에서 자료 목록·출처·후보 적합성을 검토하는 수집본이다. CSV의 `분류근거`는 전 행에서 `사진 외형·이미지 검색 설명`이다. 사진에 보이는 재료 이름이나 검색 설명을 화학성분·유해성·폐기물 코드·처리 적합성의 확정 근거로 사용하지 않는다.

공개 배포·대회 제출·모델 전송·학습 등에 사용하기 전에 대상별 원문 출처와 재사용 조건을 확인한다. 업로드 자체는 원저작자의 허락, 촬영 장소·시점·진위, 사업장 정보, 현장 사례 인수를 증명하지 않는다. CSV에 적힌 외부 URL을 이번 공유 작업에서 새로 방문하거나 검증하지 않았다.

앱에 연결하려면 기존 서버의 사례 소유권·동의·접근 권한·보관기간 검증과 전체 이미지 디코딩·메타데이터 최소화 경로를 거쳐야 한다. ZIP 해제나 파일 경로만으로 서버 발급 `photoRef`가 생기지 않으며 모델이 자동 호출되지도 않는다. 얼굴·문자·로고 등 시각적 개인정보는 EXIF 제거만으로 사라지지 않는다.

### 이번에 확인한 것

- 원본 ZIP 7개와 업로드본의 크기·SHA-256 일치, 전체 ZIP CRC 검사 통과.
- ZIP마다 이미지 파일명 항목 100개와 CSV 100행, 합계 700개 항목·700행.
- CSV 700행의 해시와 실제 파일 바이트 일치, 동일 바이트 중복 없음.
- LFS 객체 및 포인터 무결성 검사와 원격 브랜치 반영.

### 아직 확인하지 않은 것

- 700개 이미지의 전체 디코딩·시각적 내용·개인정보 검토 및 EXIF 제거.
- 원출처의 재사용 허락·촬영 진위·국내 현장 사례 여부·공정/수지/오염 등 현장 사실.
- 독립 라벨·의미상 중복 검토·평가셋 편입·실제 모델 실행 또는 운영 사례 인수.
