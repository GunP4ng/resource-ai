# 미검토 사진 원본 ZIP 목록과 접근 인계

이 폴더에는 **원본 ZIP·이미지·개별 출처 CSV를 포함하지 않는다.** 사용자 제공 ZIP 7개는 재사용 허락과 촬영 진위가 700행 모두 미확인이고, 시각적 개인정보·메타데이터 최소화·전체 이미지 디코딩도 완료되지 않았다. [팀장 수정 요청](https://github.com/GunP4ng/resource-ai/pull/35#pullrequestreview-5877376208)에 따라 원본을 main 추가 대상에서 제외했다. 기준은 [개발 원본은 개인 공간, 저장소에는 허가된 비식별 예시만 두는 설계](../../docs/architecture.md)다.

저장소에는 [inventory.json](inventory.json)의 원본 파일명·크기·SHA-256·원본 CSV 이름과 검토 상태만 남긴다. 개별 사진 설명·외부 이미지 URL·개인 로컬 경로·접근 토큰은 재게시하지 않는다. 이 목록은 현장 사례 700건, 사람 라벨 또는 평가셋 인수를 뜻하지 않는다.

## 원본 접근 상태

**승인된 별도 공유 주소는 아직 제공되지 않았다.** `restrictedSharing.location`, `accessPolicy`, `retentionPolicy`는 모두 `null`이고 `approvalRecorded=false`다. 공유 위치나 사용 허락을 임의로 만들지 않는다. 따라서 이 PR을 받아도 원본 사진을 내려받거나 사용할 수 있는 상태가 아니다.

- 수집 소유자(이상협, @hyeobikong)와 팀장(@GunP4ng)이 별도의 접근 제한 저장소, 접근 대상·목적·보관/삭제 기간을 먼저 정한다. 원본은 소유자의 기존 로컬 보관본에 보존했다. 현재 저장소 checkout을 승인된 공유 저장소로 간주하지 않는다.
- 팀원은 승인된 위치와 접근 방법을 전달받은 뒤 아래 목록의 SHA로 원본을 대조한다. 비밀 URL·인증 토큰은 Git에 넣지 않는다. Git에 공개 가능한 안내와 실제 권한 부여를 구분한다.
- 원본을 앱에 자동 설치하거나 모델에 전송하지 않는다. 계정/목적 승인과 별개로 사진별 소유권·동의·권한·보관기간·실제 case/revision 연결을 검증해야 한다.

## 원본 목록

| 원본 파일명 | 바이트 | 원본 안의 CSV | 이미지 이름 항목 / CSV 행 |
| --- | ---: | --- | ---: |
| `01_plastic_100.zip` | 37,356,826 | `plastic_sources.csv` | 100 / 100 |
| `02_metal_100.zip` | 52,790,626 | `metal_sources.csv` | 100 / 100 |
| `03_wood_100.zip` | 65,781,774 | `wood_sources.csv` | 100 / 100 |
| `04_packaging_100.zip` | 53,474,684 | `packaging_sources.csv` | 100 / 100 |
| `05_sludge_100.zip` | 32,021,068 | `sludge_sources.csv` | 100 / 100 |
| `06_rubber_100.zip` | 48,072,563 | `rubber_sources.csv` | 100 / 100 |
| `07_construction_100.zip` | 43,917,348 | `construction_sources.csv` | 100 / 100 |

합계는 **333,414,889바이트**다. 원본 SHA-256은 `inventory.json`의 각 `archives[].sha256`에 기록했다. 원본 ZIP과 CSV는 수정하지 않았다.

승인된 위치에서 파일을 별도로 받은 뒤, 이 저장소 루트에서 PowerShell로 검증할 수 있다. 경로는 실행자가 승인된 원본 보관 폴더를 입력한다. 원본을 저장소 안으로 복사하는 절차가 아니다.

```powershell
$archiveDir = (Resolve-Path -LiteralPath (Read-Host "승인된 원본 ZIP 보관 폴더")).Path
$inventory = Get-Content -LiteralPath "data/photo-archives/inventory.json" -Raw -Encoding UTF8 | ConvertFrom-Json
foreach ($item in $inventory.archives) {
    $archivePath = Join-Path $archiveDir $item.fileName
    $archive = Get-Item -LiteralPath $archivePath -ErrorAction Stop
    $actualSha = (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($archive.Length -ne $item.bytes -or $actualSha -ne $item.sha256) {
        throw "원본 크기/SHA 불일치: $($item.fileName)"
    }
    Write-Output "MATCH $($item.fileName)"
}
```

SHA 일치는 지정한 원본과 바이트가 같다는 뜻이며 사용 허락이나 개인정보 안전성을 승인하지 않는다.

## 확인한 범위와 남은 검토

2026-11-13 로컬 보관본을 실제로 다시 읽어 7개 원본/보존 사본의 크기·SHA, ZIP CRC, CSV 700행과 이미지 항목 700개의 SHA 일치를 확인했다. 동일 바이트 중복은 0건이다. CSV의 경로 접두사와 ZIP 폴더는 달라서 파일명과 SHA를 함께 대조했다. 압축 무결성 검사는 전체 이미지 디코딩이나 시각 검수를 대체하지 않는다.

원본의 개별 출처·저작자·재사용 범위·촬영 진위, 시각적 개인정보와 메타데이터, 전체 디코딩·리소스 제한, 의미상 중복과 수집 적합성은 아직 인수하지 않았다. EXIF 제거만으로 얼굴·문자·차량번호·사업장 정보가 사라지지는 않는다. 사진 외형·검색 설명을 화학성분·유해성·폐기물 코드·법적 적합성이나 독립 정답으로 승격하지 않는다.

저장소에 예시를 제출하려면 대상별 허락·사용 범위와 개인정보 최소화·전체 디코딩 결과를 먼저 기록하고, **허가된 비식별 예시만** 별도 변경으로 검토받는다. 검토가 끝나기 전에는 예시 승인·모델 학습/전송 승인·현장 인수를 표시하지 않는다. H의 별도 후보 패키지도 이 원본 700개 전체의 사용 허락을 대신하지 않는다.

## 이전 업로드 이력

이번 후속 커밋은 PR의 최종 트리에서 ZIP 7개와 폴더 LFS 설정을 제외한다. 기존 커밋과 로컬 원본은 보존하며, 이전 커밋/LFS 객체를 소급 삭제하거나 접근을 철회한 것은 아니다. 과거 업로드 객체의 보관·접근·삭제가 필요하면 저장소 소유자가 GitHub/LFS 정책에 따라 별도로 처리해야 한다. 이 PR은 그 작업의 완료를 주장하지 않으며 강제 푸시나 이력 재작성을 하지 않는다.
