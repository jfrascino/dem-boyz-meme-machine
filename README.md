# DEM BOYZ MEME MACHINE

A public Dallas Cowboys meme library with Jerry’s World, curated roasts, reaction GIFs, and an editor for making your own memes, GIFs, and silent video clips.

- **Website:** https://jfrascino.github.io/dem-boyz-meme-machine/
- **Source:** https://github.com/jfrascino/dem-boyz-meme-machine

The app is static HTML, CSS, and JavaScript. Browsing and editing do not require an account, an AI service, API keys, or a paid subscription.

## Features

- Best Roasts, the full archive, Jerry’s World, search, source filters, and game-day reactions.
- Hilarious/Lame ratings, favorites, collections, and reversible removal of catalog items.
- Photo uploads, editable meme captions, and image downloads.
- Video and animated GIF uploads with loop preview, start/end trim handles, cropping, speed, reverse, and ping-pong playback.
- Draggable captions, timing, font/color controls, stickers, and chat, X, and Story export presets.
- Editable projects saved in the browser.
- Paste a public X/Twitter post link directly in Video studio or from Make a meme. Videos, animated GIFs, and photos import through FxTwitter’s browser-accessible service; a single attachment opens in its editor automatically. Multiple attachments can be previewed, edited, or saved individually or in a batch.

## Your data stays in this browser

Personal uploads, creations, ratings, favorites, removals, collections, and projects use IndexedDB on the device and browser where you create them. There is no shared account or cross-device sync. Removing an item changes your own view of the catalog.

Download creations you want to keep. Clearing site data, using a different browser, or opening another copy of the site will not carry those saves over. This public version does not automatically export or publish content saved in an earlier private account.

## Run locally

No install or build step is needed. From this repository’s root, start a static server:

```sh
python3 -m http.server 4174
```

Open `http://localhost:4174/`. Use an HTTP server instead of opening `index.html` directly, because browsers restrict ES modules and media loading on `file:` URLs.

## Check a change

With Node.js 20 or newer:

```sh
npm test
```

No npm dependencies are required. The checks validate static asset references, catalog IDs, source metadata, relative module paths, trim/export timing, crop bounds, and caption layout. Before publishing editor changes, also test upload → trim → preview → save → reopen → download in a real browser.

## GitHub Pages

Serve the repository root with GitHub Pages. Keep asset and module URLs relative, such as `assets/example.jpg` and `./video-maker.js`, so the app works under the `/dem-boyz-meme-machine/` project path as well as at a domain root. Navigation uses URL hashes, so refreshes do not require server route rewrites.

The site does not require a server database or authentication provider. Public X-post import uses FxTwitter directly from the browser and depends on that service’s availability and cross-origin access rules. Private, deleted, restricted, or unsupported posts may not import. If an online source cannot be edited directly, upload a media file you have permission to use.

## Update the catalog

The files below are the source of the public library:

| File | Purpose |
| --- | --- |
| `weekly-picks.js` | New, reviewed picks with original post dates and attribution. |
| `x-picks.js` | Previously reviewed X posts. |
| `handpicked.js` | Handpicked classics, with uncertain dates labeled as such. |
| `catalog.js` | The broader archive and the combined catalog export. |
| `data.js` | Original captioned memes and editable templates. |
| `quality.js` | Best Roasts eligibility, 30-day freshness, review date, and game-day filters. |
| `assets/weekly-picks/` | Locally hosted media for new reviewed picks. |

Use a stable, unique `id`; preserve `sourceUrl`, `sourceName`, and creator attribution; and use `sourcePostDate` for the original post date rather than the import date. Set `olderFootage` when a recent post reuses older footage. Mark a pick `bestRoast: true` only after review; use `classic: true` for an explicitly selected classic. Update the review date in `quality.js` only when a review actually happened.

The editorial preference is savage but clean, balanced across game failures, fan meltdowns, and Jerry. Favor strong, readable media from the past 30 days, with a few labeled classics. New public entries require a committed source change and deployment; opening the website does not scrape or publish new content by itself.

The maintained site has a separate weekly curation automation scheduled for Tuesdays at 10 a.m. Eastern. That automation runs outside this repository; cloning or forking the source does not install a scheduler or give access to the maintainer’s automation. A fork can maintain picks manually or configure its own review and publishing workflow.

## Media and browser limitations

Some archive media and fonts load from third-party hosts. Those services can change URLs, remove files, or block embedding or canvas export. Network access is needed for those items. Local uploads provide a fallback.

GIF export runs in the browser. MP4 export uses WebCodecs and an available H.264 encoder; support varies by browser and device. MP4 exports are silent. GIF decoding and exports have resource limits to avoid exhausting memory; large sources may need a shorter or smaller file first.

## Credits and rights

This is an unofficial fan satire project, unaffiliated with the Dallas Cowboys, the NFL, or the media creators whose work is linked. Source and creator attribution are retained in catalog entries and item details. Catalog media, logos, and other third-party works remain subject to their respective rights; repository access does not grant a blanket license to reuse them.

Vendored libraries keep their original notices:

- [gifenc](assets/gifenc-LICENSE.md)
- [mp4-muxer](assets/LICENSE.mp4-muxer.txt), with [version notes](docs/mp4-vendor.md)
- [gifuct-js](assets/gif-decoder/LICENSE.gifuct-js) and [js-binary-schema-parser](assets/gif-decoder/LICENSE.js-binary-schema-parser), with [decoder notes](docs/gif-decoder.md)

No blanket license for the media collection is asserted here.
