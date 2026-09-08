#!/bin/zsh
# Pull each KIS bat's listing gallery into one folder per PlayOrbit sku,
# numbered in card order (01 = the thumbnail), ready for
#
#   python3 scripts/prep-store-photos.py --in kis-raw-listings --out kis-assets --catalog scripts/kis-catalog.json
#   npx tsx scripts/seed-shop-products.ts --manifest scripts/kis-catalog.json --images kis-assets --replace-images
#
# Source: the product pages of made-in-kashmir.com, a reseller whose KIS
# listings carry vendor "Khan International Sports". Several files are KIS's
# own Instagram exports (the <digits>_<digits>_n.jpg names). KIS has agreed to
# PlayOrbit using its material; if KIS supplies originals, drop those into the
# same sku folders instead and re-run the two commands above.
set -e
cd "$(dirname "$0")/.."
mkdir -p kis-raw-listings
UA='Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/128.0 Safari/537.36'
B='https://cdn.shopify.com/s/files/1/0690/4830/3921/files'
get() { mkdir -p "kis-raw-listings/$1"; curl -sSfL -A "$UA" -o "kis-raw-listings/$1/$2" "$B/$3"; }

get KIS-LEG-KW 01.webp Kis-kashmir-willow-legend-edition.webp
get KIS-LEG-KW 02.webp Kis-bat-kashmir-willow-legend.webp
get KIS-LEG-KW 03.webp kis-bat-legend-kashmir-willow-side-blade-and-back-face.webp
get KIS-LEG-KW 04.webp close-view-legend-kis-bat.webp

get KIS-CLS-KW 01.webp English-willow-kis-bat_b937b695-3e4a-4e87-96da-b5804d09de58.webp
get KIS-CLS-KW 02.webp side-blade-classic-english-willow-kis_d2642b66-9d23-45b1-83ff-cec19b9e0920.webp
get KIS-CLS-KW 03.webp KIS-english-willow-classic_d6049b78-8272-4ff9-837e-675871cd7e76.webp
get KIS-CLS-KW 04.webp close-look-english-willow-classic_54f00ae1-b1fd-4e3c-b979-81cdb80e5efd.webp

get KIS-AMU-KW 01.webp KIS-bat-AM-edition-front-face.webp
get KIS-AMU-KW 02.webp kis-bat-am-unstopable.webp
get KIS-AMU-KW 03.webp am-unstoable-kis-bat.webp
get KIS-AMU-KW 04.webp side-and-front-am-kis-bat.webp

get KIS-BOOM-KW 01.png background-editor_output_218b16a9-2bbe-4296-acb5-6634469366de.png
get KIS-BOOM-KW 02.jpg IMG-20241116_134953127.jpg
get KIS-BOOM-KW 03.jpg IMG-20241116_134923389.jpg
get KIS-BOOM-KW 04.jpg IMG-20241116_134913254.jpg
get KIS-BOOM-KW 05.jpg IMG-20241116_134847801.jpg
get KIS-BOOM-KW 06.png background-editor_output_047114d8-d5b3-4872-a465-0d128c5468ff.png

get KIS-GC-KW 01.jpg KIS-Game-Changer-front-face.jpg
get KIS-GC-KW 02.jpg KIS-Game-Changer-front-face_2f4746bf-9803-446d-be08-07c67c50c66c.jpg
get KIS-GC-KW 03.jpg Game-Changer-Edges-kashmir-willow.jpg
get KIS-GC-KW 04.jpg KIS-Game-Changer-edge.jpg
get KIS-GC-KW 05.jpg KIS-Game-Changer-posture.jpg
get KIS-GC-KW 06.jpg 463020408_18465397561014103_6869782460492506183_n.jpg

get KIS-BZK-KW 01.jpg 509200356_18385863889137118_2475538107128987100_n.jpg
get KIS-BZK-KW 02.jpg 483996526_18373340107137118_5144972719771517949_n.jpg
get KIS-BZK-KW 03.jpg 638290412_18420468835137118_8873176625337072319_n.jpg
get KIS-BZK-KW 04.jpg 524800418_18390359722137118_3750531002443863439_n.jpg
get KIS-BZK-KW 05.jpg bazuka-kis-editoin.jpg

get KIS-M7000-KW 01.jpg cricket-bat-top-grade-mh7000.jpg
get KIS-M7000-KW 02.jpg mh7000-kis-bat-front-face.jpg
get KIS-M7000-KW 03.jpg best-kashmir-willow-cricket-bat.jpg
get KIS-M7000-KW 04.jpg curved-profile-cricket-bat-for-leather-ball.jpg
get KIS-M7000-KW 05.jpg top-grade-leather-bat-mh700-kis.jpg

get KIS-MPRO-KW 01.jpg master-pro-front.jpg
get KIS-MPRO-KW 02.jpg Kis-master-pro-mh7000-plus-bat.jpg
get KIS-MPRO-KW 03.jpg icc-ban-kashmir-willow-cricket-bat.jpg
get KIS-MPRO-KW 04.jpg 564886253_18400640758137118_1144372032458012799_n.jpg
get KIS-MPRO-KW 05.jpg Grade1-kashmir-willow-master-pro.jpg

# game-changer-cricket-bat_1.heic is byte-identical to _1 above — skipped.
get KIS-GC-EW 01.heic IMG_1853.heic
get KIS-GC-EW 02.heic kis-unstoppable-cricket-bat-game-changer_1.heic
get KIS-GC-EW 03.heic game-changer-cricket-bat_2.heic
get KIS-GC-EW 04.heic kis-unstoppable-cricket-bat-game-changer_2.heic

get KIS-CLS-EW 01.webp English-willow-kis-bat.webp
get KIS-CLS-EW 02.webp side-blade-classic-english-willow-kis.webp
get KIS-CLS-EW 03.webp KIS-english-willow-classic.webp
get KIS-CLS-EW 04.webp close-look-english-willow-classic.webp

echo downloaded
find kis-raw-listings -type f | sort | while read f; do printf "%8d %s\n" "$(stat -f%z "$f")" "$f"; done
