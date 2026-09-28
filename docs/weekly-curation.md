# Weekly Cowboys curation

This repository is the source for the public GitHub Pages app. A separate owner-configured Codex automation reviews fresh content on Tuesdays at 10 a.m. America/New_York. Cloning the repository does not install a scheduler.

## Editorial brief

Savage but clean football humor. Balanced Cowboys failures, fan delusion, and Jerry/front-office mockery. Prefer public posts from the last 30 days. Original post date is not footage date: label reused footage. Keep only a few clearly labeled classics in Best Roasts. User ratings are personal, owner-scoped, and must never be overwritten by a refresh.

Search live public X posts and original/attributable sources. Search indexing can be stale; use live browser search if necessary. Read actual captions, verify the canonical author/status URL and timestamp, open the media, inspect several frames, and review the exact selected audio. Do not infer a date from a filename, import timestamp, or a headline. Prefer original/highest usable resolution. Engagement is supporting evidence, not a quality score by itself.

Each selection must have a clear joke understandable quickly on a phone, a specific Cowboys/Jerry connection, readable visuals, a working local asset, and credited provenance. Reject generic photos, routine sports analysis, supportive Dallas material, unreadable reposts, duplicates, politics, slurs, explicit jokes/profanity, or misleading game context. Do not fill quotas. Zero new items is a valid weekly result.

Current design separates the reviewed Best Roasts feed from the full archive. Do not delete the old archive or claim every archive entry is high quality. Lame items are excluded from Best Roasts; Hilarious items are promoted. Removal is reversible and separate from rating.

## Catalog update

Update the latest `main` branch of `jfrascino/dem-boyz-meme-machine`. Add reviewed entries to `weekly-picks.js` and their media/posters under `assets/weekly-picks/`. The catalog imports this module. Preserve source IDs, author, source URL, verified sourcePostDate, width/height, and existing attribution. For clips, preserve originalSrc and record any sourceExcerpt or reused footage. Never publish private uploads, credentials, research tokens, or account data.

Only mark a candidate bestRoast after visual and audio review. Deduplicate against all catalog sources, content hashes, and similar visuals. Keep classics deliberately selected and clearly labeled. Update curation.reviewedAt in quality.js only after completed review, and write a short dated note recording selections and rejections under docs/curation/.

## Verification and publication

Run `npm test`. Check the local app under a project subpath: Best Roasts, Fresh X dates, Jerry’s World, new media playback, save/rating persistence and mobile layout. Preserve browser-storage schema compatibility; never change visitors’ saved state during a content refresh.

Commit checked changes and push to GitHub main. GitHub Pages publishes the repository root; .nojekyll must remain. Check the Pages build status and public site before reporting additions live. Do not publish through the old private hosting service.

Zero additions is valid when no candidate meets the quality bar. Notify only after worthwhile additions publish or when a material failure requires attention; otherwise remain quiet. Do not post to social accounts or message creators.
