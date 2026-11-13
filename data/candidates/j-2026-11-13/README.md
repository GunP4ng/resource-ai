# J 개발 후보 10건 — 2026-11-13

팀장 [#12 피드백](https://github.com/GunP4ng/resource-ai/issues/12#issuecomment-6765265158)에 따른 **공개 사진 출처 10개 + 사실 미확인 CaseInput 10개**의 인계다. Wikimedia Commons 파일 페이지의 라이선스 선언과 출처 메타데이터를 확인했다. 사진 바이트는 내려받거나 저장·모델 전송하지 않았으므로 각 입력의 `photoRefs=[]`이고 원본 사진 SHA-256은 null이다. manifest의 SHA-256은 이 저장소에 포함된 메타데이터 스냅샷과 합성 입력 파일의 해시이며 사진 원본의 해시가 아니다. 원본 사진의 SHA-1과 크기는 Commons API가 제공한 값으로 별도 기록했다.

| 번호 | Commons 원본 페이지 | 표시 저작자 | 표시 라이선스 | 출처 중복 그룹 |
| --- | --- | --- | --- | --- |
| 01 | [- Recycling in Germany - Plastic waste to be collected -.jpg](https://commons.wikimedia.org/wiki/File:-_Recycling_in_Germany_-_Plastic_waste_to_be_collected_-.jpg) | User:Nino Barbieri | CC BY-SA 2.5 | commons-page-1968591 |
| 02 | [Plastic bags recycling bins in a Sainsbury's.jpg](https://commons.wikimedia.org/wiki/File:Plastic_bags_recycling_bins_in_a_Sainsbury%27s.jpg) | Andy Li | CC0 | commons-page-128158385 |
| 03 | [Plastic waste (bottles and sachets).jpg](https://commons.wikimedia.org/wiki/File:Plastic_waste_%28bottles_and_sachets%29.jpg) | Cornelius Agordome | CC BY-SA 4.0 | commons-page-147400058 |
| 04 | [Photos from Minh Khai Village (top to down) showing front yard recycling, storing plastic in the environment and the street and European plastic pile imported for recycling.webp](https://commons.wikimedia.org/wiki/File:Photos_from_Minh_Khai_Village_%28top_to_down%29_showing_front_yard_recycling,_storing_plastic_in_the_environment_and_the_street_and_European_plastic_pile_imported_for_recycling.webp) | Authors of the study: Kaustubh Thapa, Walter J. V. Vermeulen, Mo Ming De Waal, Pauline Deutz & Hồng Quân Nguyễn | CC BY 4.0 | commons-page-148914436 |
| 05 | [Plastic waste to be recycled.jpg](https://commons.wikimedia.org/wiki/File:Plastic_waste_to_be_recycled.jpg) | Picsgenius | CC BY-SA 4.0 | commons-page-150280968 |
| 06 | [Pellets of reclycle ABS.jpg](https://commons.wikimedia.org/wiki/File:Pellets_of_reclycle_ABS.jpg) | Amandaprc | CC BY-SA 4.0 | commons-page-80288540 |
| 07 | [Aluminium en plastic folie verpakkingsmateriaal - Aluminium and plastic foil food packaging - The Netherlands, May 2020.jpg](https://commons.wikimedia.org/wiki/File:Aluminium_en_plastic_folie_verpakkingsmateriaal_-_Aluminium_and_plastic_foil_food_packaging_-_The_Netherlands,_May_2020.jpg) | Hansmuller | CC BY-SA 4.0 | commons-page-90594096 |
| 08 | [Waste sorting containers 20150310 DSC 0245.JPG](https://commons.wikimedia.org/wiki/File:Waste_sorting_containers_20150310_DSC_0245.JPG) | Branko Radovanović | CC BY-SA 4.0 | commons-page-38861833 |
| 09 | [Plastic cap collection in Nesebar.jpg](https://commons.wikimedia.org/wiki/File:Plastic_cap_collection_in_Nesebar.jpg) | Kritzolina | CC BY-SA 4.0 | commons-page-72349928 |
| 10 | [Divided plastic waste container.jpg](https://commons.wikimedia.org/wiki/File:Divided_plastic_waste_container.jpg) | Visviva | CC0 | commons-page-86437430 |

`manifest.json`의 각 sourceId·locator는 `sources/commons-metadata.json`의 같은 pageId에 연결된다. 열 페이지/업로더는 H 후보 10건의 출처와 일치하지 않고, O 후보 10건은 외부 사진 출처가 없는 합성 텍스트다. 비슷한 재질·용도 표현은 **동일 발생원인지 확인된 것이 아니며**, 독립 검토자 두 명의 출처·중복 그룹 검토는 아직 없다. 업로더의 제목과 설명은 수지 성분·공정·국내 발생원·허가·처리 적합성의 검증 자료가 아니다.

[H/O/J 출처 교차검토](peer-source-review.json)는 원본 manifest 세 개의 SHA와 후보 30개의 출처 그룹을 대조한 AI 보조 검토 기록이다. H의 임시 그룹 6개와 J의 서로 다른 공개 페이지 10개를 보존하되, O의 열 개 별도 가상 시나리오는 독립적인 실자료 출처가 없으므로 잠금 분리 전까지 하나의 저작 코호트로 묶자고 제안한다. 합계 17개는 **임시 출처 그룹 제안**이며 사람의 독립 라벨·현장 후보 승인·팀장 18/12 배정이 아니다. O 소유 manifest의 기존 그룹을 몰래 바꾸지 않았다.

각 `inputs/` 파일은 개발용 공개 후보로만 열람한다. 공정·수지·오염·유해접촉·질량·지역은 미상으로 보존하고, 평가일은 촬영일이 아니라 입력 재현 기준일이다. 같은 출처의 파생 사진이나 조건 변형은 같은 duplicateGroupId에 묶어야 한다. 외부 모델 전송·사진 사용 목적, 개인정보/로고/표찰, 현장 권리, 사업장 자료, 독립 정답 라벨 및 개발18/미열람 잠금12 배정은 승인되지 않았다. 이 공개된 열 건을 잠금 데이터에 넣거나 실제 현장 사례·법률 판정으로 세지 않는다. 사진을 실제로 사용할 때는 해당 파일의 저작자 표시·라이선스·변경 사항을 따로 검토하고 원본/파생 바이트 SHA-256과 동의·권한을 확보한다.

검증: `bun test tests/j-candidates.test.ts`. JSON은 manifest의 inputSha256과 metadataSnapshot.sha256으로 연결된다. 기존 J2/J3 근거의 확인 기한 `2026-11-05`는 이 후보 추가로 연장되지 않는다.
