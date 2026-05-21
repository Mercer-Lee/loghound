# Analysis Media

Read this file when logs show file/media-related failures. Use local tools to verify the actual file; do not rely solely on log descriptions.

## Trigger scenarios

- URL download failure, 403, 404, timeout → Use curl to verify URL reachability
- Unsupported format, codec error, parse failure → Use ffprobe to check container format and encoding
- Render failure suspected crop/scale/trim parameter issue → Use ffprobe to check input metadata
- Audio clone/voiceover material anomaly → Use ffprobe to check audio encoding, sample rate, channels

## Tool usage

### curl verify URL reachability

```bash
# Lightweight check, only get response headers
curl -I -L --max-time 10 '<original URL from logs>'

# When auth is needed, include original request headers
curl -I -L --max-time 10 -H 'Authorization: <original token from logs>' '<original URL from logs>'
```

Focus on: HTTP status code, Content-Type, Content-Length, whether 302 infinite loop.

### ffprobe check media metadata

```bash
# Output JSON format, including streams and format
ffprobe -v quiet -print_format json -show_format -show_streams '<URL or local path>'
```

Focus on:
- `format.format_name`: container format (mp4/mov/mkv/wav etc.)
- `streams[].codec_name`: encoding format (h264/aac/pcm_f32le etc.)
- `streams[].width/height`: resolution anomaly (0 or negative)
- `format.duration`: whether duration is reasonable
- `streams[].sample_rate`: audio sample rate

### ffmpeg parameter lightweight validation

```bash
# Don't actually render, only check if input is parseable
ffmpeg -i '<URL or local path>' -f null - 2>&1 | head -20
```

Only use when suspecting ffmpeg parameters (crop/scale/-ss/-to) caused failure.

## Determination rules

- curl returns non-2xx → Material unreachable, root cause is not in render service
- ffprobe errors → File corrupted or unsupported format, root cause is in material source
- ffprobe normal but uncommon encoding (e.g. pcm_f32le audio in mp4) → Encoding compatibility issue
- ffprobe normal and encoding compliant → Problem is in downstream processing chain, continue tracking

## Constraints

- Only do lightweight validation, do not run full render pipeline
- Use original URLs from logs, include auth parameters
- Validation results serve as supporting evidence for root cause analysis, not a replacement for log analysis
