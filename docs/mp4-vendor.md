# mp4-muxer 5.2.2

Pinned browser ES module, copied unmodified from the official npm package on 2026-09-28. No runtime dependencies or CDN access are required.

| File | Bytes | Gzip bytes | SHA-256 |
| --- | ---: | ---: | --- |
| `mp4-muxer-5.2.2.mjs` | 69,011 | 14,403 | `d2c4c782f180c86ed30b1f5d9487a34a0d370bf9b4535285734ea187d38f9bb5` |
| `LICENSE.mp4-muxer.txt` | 1,065 | 651 | `75c54aae7ef6ad652f684f9dd3b71e4dcef86ccebd88cf441ceed7f5eec037c5` |

License: MIT, copyright 2023 Vanilagy. Keep the complete license with distributed copies.

Source: https://registry.npmjs.org/mp4-muxer/-/mp4-muxer-5.2.2.tgz

Verified package integrity against official registry metadata:
`sha512-dhozjTywI0h2qFzeShagt8YYw811fh1XlwiDCE2f6Aeqf6xG2CyuShoSa5E0AZDO8pPF0JOZ3wOmWBNWIGdSpQ==`

## Maintenance status

The author deprecated mp4-muxer in favor of Mediabunny. This pinned version will not receive upstream fixes. It is retained here for the narrow, silent H.264 MP4 export flow and its small standalone ESM bundle. The app must retain GIF export when the browser cannot encode AVC. Upstream status: https://github.com/Vanilagy/mp4-muxer

## Integration

1. Feature-detect `VideoEncoder` and `VideoFrame` in a secure context. Query `VideoEncoder.isConfigSupported()` with the actual dimensions, bitrate and frame rate.
2. Give `Muxer` an `ArrayBufferTarget`, `video: { codec: 'avc', width, height, frameRate: fps }`, and `fastStart: 'in-memory'`. Omit `audio` entirely.
3. Use `avc: { format: 'avc' }` in encoder configuration. Pass both arguments of its output callback to `muxer.addVideoChunk(chunk, metadata)`. Metadata carries the AVC decoder description; do not drop it.
4. Seek the input video, wait for the frame, and draw video plus captions to canvas for each frame. Encode a new `VideoFrame(canvas, {timestamp, duration})`. Use integer microseconds starting at zero, derived from frame index, and close every frame after submitting it.
5. Wait for `encoder.flush()`, then `muxer.finalize()`. Make `new Blob([target.buffer], {type:'video/mp4'})`. Close the encoder in a `finally` block.

Use bounded queues, surface asynchronous encoder failures, and do not drop frames during offline export. A periodic flush is a simple way to bound work. With fixed-rate output, the duration rounds to frame precision. For example, at 30 fps it is within roughly one frame of the selected range.

`integration-sketch.mjs` is a browser integration sketch. It was syntax/import checked in Node; actual browser encoding must be verified in the app, then inspected with ffprobe. The bundle itself exports `Muxer`, `ArrayBufferTarget`, `StreamTarget`, and `FileSystemWritableFileStreamTarget`.

Primary API sources:

- Original author API guide: https://github.com/Vanilagy/mp4-muxer/blob/2c611c5932d3b8054c8968320cf9b6b7db094d30/README.md
- AVC bitstream and decoder metadata: https://w3c.github.io/webcodecs/avc_codec_registration.html
- Browser encoder support, frame disposal, and flushing: https://developer.chrome.com/docs/web-platform/best-practices/webcodecs
