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

Album release years and release-edition track sequences are factual annotations sourced from each album’s linked reference pages. Selected solo and collaborative releases are included alongside band albums. Some releases link to an external track list rather than an imported song index. Album markers are single solid colors. No album-cover image files are distributed. Relisten links use its published HTTPS universal-link routes; opening the installed iOS app depends on the device’s settings.

Official concert-release annotations are in `data/curated/concert_releases.json`. The initial index covers all 36 original Dick’s Picks volumes plus 15 standalone concert releases, with documented bonus dates and selection status. It matches date groups, not independently verified early/late events. Later reissues and separately packaged bonus discs are not exhaustive. No listed match is not evidence that a date has never been officially released. Individual source links accompany the annotations.


## Setlist search

The normalized snapshot in `data/release/setlists.json` supports opener, encore, and sequence search. It contains song identities, source-listed set/encore groupings, explicit transition markers, coverage counts, and links to the selected Internet Archive source. No taper prose, review text, raw metadata, or audio is included.

These are source-supported candidates, not verified complete concerts. Early and late performances are kept separate. Disc breaks do not establish sets. Unresolved titles, missing tracks, and cuts limit sequence matches; unknown set boundaries require explicit source arrows. Source-listed missing tracks are labelled separately. Incomplete or ambiguous evidence does not establish that a song or sequence was absent.

The snapshot covers 1,935 reported-date groups, including 1,717 with source-labelled sets or encores. Remaining coverage and unresolved-title counts are shown in the tool. Recording ratings are independent of these setlist annotations.
