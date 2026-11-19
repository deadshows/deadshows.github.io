# Sources and credits

## Recording data

Recording identifiers, dates, venues, rating summaries, and ordered song evidence come from the [Internet Archive Grateful Dead collection](https://archive.org/details/GratefulDead), accessed through its [metadata API](https://archive.org/developers/md-read.html). The minimal snapshot in `data/release/archive.json` supports offline builds. Each recording links to its Archive page. [Relisten](https://relisten.net/grateful-dead) links provide another listening destination.

No audio, lyrics, review prose, uploader profiles, or raw API responses are distributed.

Tracklists may be incomplete. Dates group recordings rather than certify distinct concerts. Ratings describe individual recording sources. Personnel filters represent membership windows, not confirmed attendance.

## Historical context

Original annotations, personnel intervals, eras, and song identities are in `data/curated/`, with source links attached to individual entries. They draw on official band and artist histories and cited historical references.

## Artwork and fonts

The animated rose and archive-box icon are original drawings.

The background SVG adapts [Ron Wickersham’s Wall of Sound schematic](https://commons.wikimedia.org/wiki/File:Grateful_Dead%27s_Wall_of_sound_schematic.jpg). The adaptation simplifies the geometry and omits lettering and measurements. It is distributed under [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/); attribution and license information are also embedded in the SVG.

Bungee Shade and Archivo Black are distributed with their SIL Open Font License notices in `public/assets/fonts/`. DM Sans is loaded through Google Fonts.

This is an independent fan project, unaffiliated with the Grateful Dead or Internet Archive.

Album release years and original LP track sequences are factual annotations sourced from each album’s linked Wikipedia article. Album tiles are original geometric designs, not reproductions of album covers. Relisten links use its published HTTPS universal-link routes; opening the installed iOS app depends on the device’s settings.
