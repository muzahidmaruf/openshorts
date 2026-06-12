"""
Video Cleaner - Removes filler words, pauses, and repeated sentences from video.
Uses Whisper word-level timestamps to identify and cut unwanted segments.
Also includes smart sentence repetition detection for raw recordings.
"""

import os
import subprocess
import json
import shutil
import tempfile
from faster_whisper import WhisperModel


def _probe_video_height(video_path):
    """Return the height of the first video stream, or None on failure."""
    try:
        cmd = [
            'ffprobe', '-v', 'error', '-select_streams', 'v:0',
            '-show_entries', 'stream=height',
            '-of', 'default=noprint_wrappers=1:nokey=1', video_path
        ]
        result = subprocess.run(cmd, capture_output=True, text=True)
        return int(result.stdout.strip().splitlines()[0])
    except Exception:
        return None


def _safe_threads():
    """Thread count for heavy ffmpeg passes on oversized footage — half the
    cores, so a long 4K transcode can't thermally shut the machine down."""
    return max(2, (os.cpu_count() or 8) // 2)


def analyze_transcript_with_gemini(segments, video_duration, target_duration=None, reference_script=None):
    """
    Send the full transcript to Gemini so it understands what the video is about,
    then return its plan for which time ranges to KEEP and which to CUT.

    Returns dict:
      {
        'summary': str,
        'topic': str,
        'keep_ranges': [(start, end), ...],   # ranges to keep, in order
        'cut_ranges':  [(start, end), ...],   # ranges to drop (filler/off-topic/repeats)
      }
    or None if unavailable / failed.
    """
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        print("[Reel/AI] GEMINI_API_KEY not set, skipping AI transcript analysis")
        return None

    try:
        from google import genai
    except Exception as e:
        print(f"[Reel/AI] google-genai not available: {e}")
        return None

    # Compact transcript: one line per segment with timestamps
    lines = []
    full_text_parts = []
    for seg in segments:
        s = float(seg.get('start', 0.0))
        e = float(seg.get('end', s))
        text = (seg.get('text') or '').strip().replace('\n', ' ')
        if not text:
            continue
        lines.append(f"[{s:.2f}-{e:.2f}] {text}")
        full_text_parts.append(text)
    transcript_block = "\n".join(lines)
    full_text = " ".join(full_text_parts)

    script_block = ""
    script_mode = bool(reference_script and reference_script.strip())
    if script_mode:
        script_block = f"""

============================================================
SCRIPT-DRIVEN MODE — READ THIS BEFORE ANYTHING ELSE
============================================================
A REFERENCE SCRIPT was provided. The script is the ABSOLUTE source of truth.
The final reel MUST reconstruct this script — nothing more, nothing less.

REFERENCE SCRIPT (the speaker's intended script):
\"\"\"
{reference_script.strip()}
\"\"\"

How to use the script (this OVERRIDES every other instruction below):

1. Walk through the reference script line-by-line, in script order.
2. For EACH line of the script, find the take in the transcript whose words
   most closely match that line. The speaker may have re-taken a line
   several times — pick the BEST take (most complete, fewest filler/stumbles,
   most natural delivery) and cut the others.
3. Mark the [start, end] timestamps of that best take and add to keep_ranges.
4. CUT EVERYTHING ELSE. Anything in the transcript that does NOT correspond
   to a line of the script — improvisation, tangents, off-script chatter,
   intros/outros not in the script, bloopers — MUST be cut.
5. Coverage is mandatory: every script line/section/list-item must be
   represented by exactly one keep_range. If the script has 5 numbered
   items, the reel has 5 corresponding keep_ranges (plus any opening/closing
   lines from the script). Never drop a script line.
6. Order: keep_ranges must follow the script's order. Since the speaker
   normally reads the script sequentially, this should also be chronological
   in the transcript — but if the speaker delivered things out of order, do
   NOT reorder; just keep the chronologically-best take of each script line.
7. If a script line was never delivered cleanly (only flubbed takes exist),
   pick the cleanest available take rather than skipping the line.
8. If the transcript contains content NOT in the script, that content is
   off-script and MUST go in cut_ranges (not keep_ranges).

Aim for a final reel that, when you read its concatenated transcript text,
sounds like the reference script delivered cleanly start-to-finish.
============================================================"""

    if script_mode:
        # In script mode, length is determined by the script. Ignore the slider.
        target_clause = (
            "LENGTH RULE: ignore any length target. The reel's length is dictated by "
            "the reference script — cover every script line, no more, no less. The "
            "duration the script naturally produces is the correct duration."
        )
    elif target_duration:
        target_clause = (
            f"Soft length hint: aim for around {target_duration} seconds, but ONLY if it doesn't break the content. "
            f"NEVER drop items from a list/enumeration (e.g. \"5 mistakes\", \"3 tips\", steps 1..N) just to hit the hint — "
            f"completeness of the message wins over the length hint. It is fine to go significantly longer than {target_duration}s when needed."
        )
    else:
        target_clause = "Pick whatever length best preserves the core message (no hard target)."

    if script_mode:
        editorial_goals = (
            "Editorial goals (in script-driven mode the SCRIPT BLOCK above overrides these):\n"
            "- Within each take you keep, prefer the cleanest delivery of that script line.\n"
            "- If two takes both match a script line, keep the one with fewer filler words, "
            "no false starts, and a complete sentence ending.\n"
            "- Every keep_range must START at the beginning of the matched script line and "
            "END at the natural end of that line's sentence."
        )
    else:
        editorial_goals = (
            "Goals when planning the edit:\n"
            "- KEEP segments that carry the core message, the strongest moments, and a coherent arc (hook -> point -> payoff).\n"
            "- If the speaker promises \"N\" things (e.g. \"5 mistakes\"), the edit MUST include all N items and the conclusion. Do not stop early.\n"
            "- The final kept range should reach the natural end of the speaker's argument (the closing/wrap-up), not cut off mid-list or mid-sentence."
        )

    prompt = f"""You are an expert short-form video editor.

You are given the full transcript of a raw recording (duration {video_duration:.1f}s) with per-segment timestamps. First, read the WHOLE transcript end-to-end and understand what the video is actually about — the topic, the speaker's main argument, and the narrative arc, including any enumerations like "N mistakes / N tips / N reasons / steps 1..N". Then plan an edit.
{script_block}

{target_clause}

{editorial_goals}
- CUT filler ("uh", "um", "like", "you know"), long pauses, false starts, repeated/restated sentences, tangents, and anything off-topic.
- DOUBLE-TAKES / RESTARTS: if the speaker says the same phrase twice in a row (e.g. "Mistake number 4." ... pause ... "Mistake number 4, ..."), the FIRST take is a false start — its time range MUST be cut. Only the second, completed take should remain. Watch carefully for this on section headers, list items, and intros.
- UNFINISHED / ABANDONED SENTENCES: cut any sentence that the speaker does not finish — i.e. it trails off, gets interrupted by a pause, or the speaker switches to a different sentence without completing the previous one. Signs: the segment does NOT end with a sentence-final punctuation mark (. ! ?), it ends mid-clause ("...and the thing is —"), or the following segment starts a new, unrelated sentence instead of continuing the thought. Every kept range must START at the beginning of a sentence and END at the natural end of a sentence.
- Preserve original chronological order. Do NOT invent timestamps. Only use timestamps that appear in the transcript.
- Keep ranges should be non-overlapping and sorted by start time.

Transcript (timestamped segments):
{transcript_block}

Respond with ONLY valid JSON, no markdown, in this exact shape:
{{
  "topic": "<one short sentence describing what the video is about>",
  "summary": "<2-3 sentence summary of the actual content and arc>",
  "keep_ranges": [[start_seconds, end_seconds], ...],
  "cut_ranges":  [[start_seconds, end_seconds], ...]
}}
"""

    if script_mode:
        print(f"[Reel/AI] SCRIPT-DRIVEN mode active — reel will reconstruct the "
              f"reference script ({len(reference_script.strip())} chars). "
              f"Length target ignored.")
    else:
        print("[Reel/AI] No reference script — using AI's own narrative judgment.")
    print("[Reel/AI] Asking Gemini to understand the transcript and plan the edit...")

    # Retry on transient errors (503 UNAVAILABLE, timeouts, 429 rate-limit, 500).
    transient_markers = ('503', '504', '429', '500', 'UNAVAILABLE', 'timed out',
                         'timeout', 'DEADLINE_EXCEEDED', 'INTERNAL', 'temporarily')
    max_attempts = 4
    backoff = 4  # seconds; doubles each retry
    last_err = None
    response = None
    try:
        client = genai.Client(api_key=api_key)
    except Exception as e:
        print(f"[Reel/AI] Could not init Gemini client: {e}")
        return None

    for attempt in range(1, max_attempts + 1):
        try:
            response = client.models.generate_content(
                model='gemini-2.5-flash',
                contents=prompt,
            )
            break  # success
        except Exception as e:
            last_err = e
            err_str = str(e)
            is_transient = any(m in err_str for m in transient_markers)
            if attempt < max_attempts and is_transient:
                wait = backoff * (2 ** (attempt - 1))
                print(f"[Reel/AI] Transient error (attempt {attempt}/{max_attempts}): "
                      f"{err_str[:160]} — retrying in {wait}s...")
                import time as _t
                _t.sleep(wait)
                continue
            print(f"[Reel/AI] Gemini analysis failed after {attempt} attempt(s): {e}")
            return None

    if response is None:
        print(f"[Reel/AI] Gemini analysis failed: {last_err}")
        return None

    try:
        text = (response.text or '').strip()
        if text.startswith("```json"):
            text = text[7:]
        elif text.startswith("```"):
            text = text[3:]
        if text.endswith("```"):
            text = text[:-3]
        text = text.strip()

        data = json.loads(text)
    except Exception as e:
        print(f"[Reel/AI] Could not parse Gemini response: {e}")
        return None

    def _normalize_ranges(raw):
        out = []
        for r in raw or []:
            try:
                s = max(0.0, float(r[0]))
                e = min(float(video_duration), float(r[1]))
                if e > s:
                    out.append((s, e))
            except Exception:
                continue
        out.sort()
        # merge overlaps
        merged = []
        for s, e in out:
            if merged and s <= merged[-1][1]:
                merged[-1] = (merged[-1][0], max(merged[-1][1], e))
            else:
                merged.append((s, e))
        return merged

    keep = _normalize_ranges(data.get('keep_ranges'))
    cut = _normalize_ranges(data.get('cut_ranges'))

    if not keep and not cut:
        print("[Reel/AI] Gemini returned no usable ranges")
        return None

    topic = (data.get('topic') or '').strip()
    summary = (data.get('summary') or '').strip()
    if topic:
        print(f"[Reel/AI] Topic: {topic}")
    if summary:
        print(f"[Reel/AI] Summary: {summary}")
    print(f"[Reel/AI] Plan: keep {len(keep)} range(s), cut {len(cut)} range(s)")

    return {
        'topic': topic,
        'summary': summary,
        'full_text': full_text,
        'keep_ranges': keep,
        'cut_ranges': cut,
    }


def invert_keep_ranges(keep_ranges, video_duration):
    """Convert a list of keep-ranges into the complementary list of cut-ranges."""
    if not keep_ranges:
        return []
    cuts = []
    prev_end = 0.0
    for s, e in keep_ranges:
        if s > prev_end:
            cuts.append((prev_end, s))
        prev_end = max(prev_end, e)
    if prev_end < video_duration:
        cuts.append((prev_end, video_duration))
    return cuts

# Filler words to remove (expandable for different languages)
FILLER_WORDS_EN = {
    'uh', 'um', 'ah', 'eh', 'er', 'err', 'hmm', 'hm',
    'like', 'you know', 'sort of', 'kind of', 'basically',
    'actually', 'literally', 'obviously', 'clearly',
    'i mean', 'well', 'so', 'right', 'okay', 'ok', 'yeah', 'yes', 'no'
}

FILLER_WORDS_BN = {
    'মানে', 'অ্যাই', 'ওই', 'এই', 'তো', 'না', 'হ্যাঁ', 'ঠিক', 'আচ্ছা'
}

# Repeated phrase patterns (common restarts)
REPEAT_PATTERNS_EN = [
    'so so', 'i i', 'we we', 'they they', 'the the',
    'what what', 'how how', 'why why', 'when when',
]

REPEAT_PATTERNS_BN = [
    'তো তো', 'না না', 'হ্যাঁ হ্যাঁ', 'এই এই', 'ওই ওই'
]

def detect_language(transcript_segments):
    """Detect language from transcript segments."""
    if not transcript_segments:
        return 'en'

    # Check first few segments for Bengali characters
    sample_text = ' '.join([seg.get('text', '') for seg in transcript_segments[:5]])
    if any('ঀ' <= c <= '৿' for c in sample_text):
        return 'bn'
    return 'en'

def get_filler_words(language):
    """Get filler words for the detected language."""
    if language == 'bn':
        return FILLER_WORDS_BN
    return FILLER_WORDS_EN

def transcribe_audio(video_path, model_size='small', language='auto'):
    """
    Transcribe video audio with word-level timestamps.
    Returns list of segments with start, end, text, and words.
    """
    # Pre-extract a low-bitrate mono 16kHz WAV. Whisper internally resamples
    # to 16kHz mono anyway, but if we hand it the original 4K-camera MP4 it
    # has to demux the whole container (huge memory hit) before getting to the
    # audio. Extracting once up front means the transcribe loop only ever
    # touches a ~10MB audio file.
    audio_path = None
    try:
        fd, audio_path = tempfile.mkstemp(suffix=".wav", prefix="ostranscribe_")
        os.close(fd)
        extract_cmd = [
            'ffmpeg', '-y', '-i', video_path,
            '-vn', '-ac', '1', '-ar', '16000',
            '-c:a', 'pcm_s16le',
            '-threads', str(_safe_threads()),
            audio_path
        ]
        result = subprocess.run(extract_cmd, capture_output=True)
        if result.returncode != 0 or not os.path.exists(audio_path) or os.path.getsize(audio_path) == 0:
            print("[Transcribe] Audio pre-extract failed, falling back to direct decode")
            if audio_path and os.path.exists(audio_path):
                os.remove(audio_path)
            audio_path = None
    except Exception as e:
        print(f"[Transcribe] Audio pre-extract error ({e}), falling back to direct decode")
        audio_path = None

    transcribe_input = audio_path if audio_path else video_path

    threads = _safe_threads()
    print(f"[Transcribe] Loading model: {model_size} (cpu_threads={threads})")
    # cpu_threads cap: long videos sustain 100% CPU for many minutes during
    # transcription. Without this, transcribing a 30+ minute camera recording
    # has triggered thermal/power shutdowns on the host. Slower but safe.
    model = WhisperModel(model_size, device="cpu", compute_type="int8",
                         cpu_threads=threads, num_workers=1)

    print(f"[Transcribe] Starting transcription (language={language})...")
    segments, info = model.transcribe(
        transcribe_input,
        language=language if language != 'auto' else None,
        word_timestamps=True,
        vad_filter=True,
        vad_parameters=dict(min_silence_duration_ms=500)
    )

    result = []
    for segment in segments:
        seg_data = {
            'start': segment.start,
            'end': segment.end,
            'text': segment.text.strip(),
            'words': []
        }
        if hasattr(segment, 'words') and segment.words:
            for word in segment.words:
                seg_data['words'].append({
                    'start': word.start,
                    'end': word.end,
                    'text': word.word.strip()
                })
        result.append(seg_data)

    print(f"[Transcribe] Complete. Found {len(result)} segments.")

    if audio_path and os.path.exists(audio_path):
        try:
            os.remove(audio_path)
        except Exception:
            pass

    return result

def find_restart_cuts(segments, max_gap=6.0, min_prefix_words=2):
    """
    Detect false-start / double-take restarts where the speaker says a short phrase,
    pauses, then re-says the same phrase and continues.

    Example:
        seg1: "Mistake number 4."           [t=30.0 -> 31.2]
        (pause)
        seg2: "Mistake number 4, the ..."   [t=33.5 -> 38.0]
    -> cut (30.0, 33.5)

    Returns a list of (start, end) cut ranges covering the FIRST take and the gap.
    """
    import re

    def norm_words(text):
        # lowercase, strip punctuation, split
        cleaned = re.sub(r"[^\w\s]", " ", (text or '').lower())
        return [w for w in cleaned.split() if w]

    cuts = []
    used = set()  # indices already consumed as the "first take"

    for i in range(len(segments) - 1):
        if i in used:
            continue
        seg1 = segments[i]
        text1_words = norm_words(seg1.get('text', ''))
        if len(text1_words) < min_prefix_words:
            continue

        # Look ahead a few segments — the restart may not be the immediate next segment
        for j in range(i + 1, min(i + 4, len(segments))):
            seg2 = segments[j]
            gap = seg2['start'] - seg1['end']
            if gap < 0 or gap > max_gap:
                break

            text2_words = norm_words(seg2.get('text', ''))
            if len(text2_words) < min_prefix_words:
                continue

            prefix_len = min(len(text1_words), len(text2_words), 6)
            if prefix_len < min_prefix_words:
                continue

            # First take should be a (near-)prefix of second take
            if text1_words[:prefix_len] == text2_words[:prefix_len]:
                # The first take should be SHORTER (the restart is the longer, complete version)
                # OR text1 is essentially fully contained at the start of text2.
                if len(text1_words) <= len(text2_words):
                    cuts.append((seg1['start'], seg2['start']))
                    print(f"[Cleaner] Restart detected: '{seg1.get('text','')[:40]}' -> "
                          f"'{seg2.get('text','')[:40]}' (cut {seg1['start']:.2f}-{seg2['start']:.2f})")
                    used.add(i)
                    break

    return cuts


def find_abandoned_sentence_cuts(segments, min_pause=1.0):
    """
    Detect sentences the speaker did not finish.

    A segment is treated as abandoned when ALL of:
      - its text does NOT end with sentence-final punctuation (. ! ? . ! ?),
      - it is followed by a pause >= min_pause seconds,
      - the next segment starts a NEW sentence (capital letter / new clause)
        rather than continuing the previous thought.

    Returns a list of (start, end) cut ranges covering the abandoned segment + the gap.
    """
    final_punct = ('.', '!', '?', '。', '！', '？', '…')
    continuation_starters = {
        'and', 'but', 'or', 'so', 'because', 'which', 'that', 'who',
        'where', 'when', 'while', 'though', 'although', 'if',
    }

    cuts = []
    for i in range(len(segments) - 1):
        seg = segments[i]
        nxt = segments[i + 1]
        text = (seg.get('text') or '').strip()
        next_text = (nxt.get('text') or '').strip()
        if not text or not next_text:
            continue

        # Already ends a sentence -> not abandoned
        if text.endswith(final_punct):
            continue

        gap = nxt['start'] - seg['end']
        if gap < min_pause:
            continue  # too tight to be a true abandonment

        first_word = next_text.split()[0].strip(",.;:!?\"'()[]").lower()
        # Continuation word -> the sentence is just spread across two segments, keep it
        if first_word in continuation_starters:
            continue
        # If next segment starts lowercase, it's likely a continuation -> keep
        if first_word and first_word[0].islower():
            continue

        cuts.append((seg['start'], nxt['start']))
        print(f"[Cleaner] Abandoned sentence: '{text[:50]}' (gap {gap:.2f}s) -> cut")

    return cuts


def trim_keep_ranges_to_sentences(keep_ranges, segments, final_punct=('.', '!', '?', '。', '！', '？', '…')):
    """
    Pull the END of each keep_range back to the end of the last segment within
    the range that finishes with sentence-final punctuation. Prevents kept
    ranges from ending on an incomplete clause.

    If a range contains no completed sentence, it's left alone (caller decides).
    """
    trimmed = []
    for s, e in keep_ranges:
        last_complete_end = None
        for seg in segments:
            if seg['start'] >= s and seg['end'] <= e + 0.05:
                text = (seg.get('text') or '').strip()
                if text.endswith(final_punct):
                    last_complete_end = seg['end']
        if last_complete_end is not None and last_complete_end < e:
            trimmed.append((s, last_complete_end))
        else:
            trimmed.append((s, e))
    return trimmed


def find_repeated_sentences(segments, min_gap=0.3, max_gap=2.0):
    """
    Detect repeated sentences/phrases where speaker restarts.
    Looks for similar text within a short time window.
    Returns list of (start, end) for the repeated portions to cut.
    """
    cuts = []

    for i in range(len(segments) - 1):
        seg1 = segments[i]
        seg2 = segments[i + 1]

        text1 = seg1.get('text', '').lower().strip()
        text2 = seg2.get('text', '').lower().strip()

        # Check if texts are similar (one contains the other or high overlap)
        if not text1 or not text2:
            continue

        # Skip very short segments
        if len(text1.split()) < 3 or len(text2.split()) < 3:
            continue

        # Check for repetition patterns
        gap = seg2['start'] - seg1['end']
        if gap < min_gap or gap > max_gap:
            continue

        # Check if second segment starts similarly to first
        words1 = text1.split()
        words2 = text2.split()

        # Check if first 3-4 words match
        min_words = min(4, len(words1), len(words2))
        if words1[:min_words] == words2[:min_words]:
            # Cut the first segment's end and the gap (keep second segment)
            cuts.append((seg1['start'], seg2['start'] - 0.1))
            print(f"[Cleaner] Detected repeat: '{text1[:30]}...' -> '{text2[:30]}...'")
        elif text1 in text2 or text2 in text1:
            # One is contained in the other - likely a restart
            cuts.append((seg1['start'], seg2['start'] - 0.1))
            print(f"[Cleaner] Detected contained repeat")

    return cuts

def find_segments_to_cut(segments, filler_words, min_pause_duration=0.5, detect_repeats=True):
    """
    Analyze transcript and find segments to cut:
    1. Filler words (uh, um, like, etc.)
    2. Pauses longer than min_pause_duration
    3. Repeated phrases/sentences (speaker restarts)

    Returns list of (start, end) tuples for cuts.
    """
    cuts = []

    # Collect all words with their timing
    all_words = []
    for seg in segments:
        if seg.get('words'):
            for word in seg['words']:
                all_words.append(word)

    if not all_words:
        print("[Cleaner] No word-level timestamps found, using segment-based cleaning")
        # Fallback: cut entire segments that are filler words
        for seg in segments:
            text_lower = seg['text'].lower().strip()
            if text_lower in filler_words or text_lower.rstrip('.,!?') in filler_words:
                cuts.append((seg['start'], seg['end']))
        return cuts

    # Find filler words
    for i, word in enumerate(all_words):
        word_text = word['text'].lower().strip('.,!?;:')
        if word_text in filler_words:
            # Include a bit of buffer around the filler word
            start_buffer = max(0, word['start'] - 0.1)
            end_buffer = word['end'] + 0.1
            cuts.append((start_buffer, end_buffer))

    # Find long pauses between words
    for i in range(len(all_words) - 1):
        gap = all_words[i + 1]['start'] - all_words[i]['end']
        if gap > min_pause_duration:
            # Cut the pause (leave small buffer)
            pause_start = all_words[i]['end'] + 0.05
            pause_end = all_words[i + 1]['start'] - 0.05
            if pause_end > pause_start:
                cuts.append((pause_start, pause_end))

    # Find repeated sentences
    if detect_repeats:
        repeat_cuts = find_repeated_sentences(segments)
        cuts.extend(repeat_cuts)

    # Merge overlapping cuts
    if not cuts:
        return cuts

    cuts.sort(key=lambda x: x[0])
    merged = [cuts[0]]
    for start, end in cuts[1:]:
        last_start, last_end = merged[-1]
        if start <= last_end + 0.2:  # Small gap allowed
            merged[-1] = (last_start, max(last_end, end))
        else:
            merged.append((start, end))

    print(f"[Cleaner] Found {len(merged)} segments to cut (total: {sum(e-s for s,e in merged):.1f}s)")
    return merged

def cut_video_segments(input_video, cuts, output_video):
    """
    Use FFmpeg to cut out segments from the video.
    Uses the concat demuxer approach for clean cuts.
    """
    if not cuts:
        print("[Cleaner] No cuts to apply, copying original video")
        shutil.copyfile(input_video, output_video)
        return True

    # Get video duration
    cmd = [
        'ffprobe', '-v', 'error', '-show_entries', 'format=duration',
        '-of', 'default=noprint_wrappers=1:nokey=1', input_video
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    duration = float(result.stdout.strip())

    # Build keep segments (inverse of cuts)
    keep_segments = []
    last_end = 0
    for cut_start, cut_end in cuts:
        if cut_start > last_end:
            keep_segments.append((last_end, cut_start))
        last_end = max(last_end, cut_end)

    # Add final segment
    if last_end < duration:
        keep_segments.append((last_end, duration))

    if not keep_segments:
        print("[Cleaner] Entire video would be cut, keeping original")
        shutil.copyfile(input_video, output_video)
        return True

    print(f"[Cleaner] Keeping {len(keep_segments)} segments totaling {sum(e-s for s,e in keep_segments):.1f}s")

    # Create FFmpeg filter complex for trimming
    filter_parts = []
    concat_inputs = []

    for i, (start, end) in enumerate(keep_segments):
        duration_seg = end - start
        filter_parts.append(f"[0:v]trim=start={start}:end={end},setpts=PTS-STARTPTS[v{i}]")
        filter_parts.append(f"[0:a]atrim=start={start}:end={end},asetpts=PTS-STARTPTS[a{i}]")
        concat_inputs.append(f"[v{i}]")
        concat_inputs.append(f"[a{i}]")

    concat_inputs_str = ''.join(concat_inputs)
    filter_parts.append(f"{concat_inputs_str}concat=n={len(keep_segments)}:v=1:a=1[outv0][outa]")

    # Oversized camera footage (4K+): downscale to 1080p-class in this same
    # pass and cap threads — full-resolution all-core encodes of raw camera
    # files cause thermal/power shutdowns. Platforms deliver max 1080x1920,
    # so nothing visible is lost. format=yuv420p also normalizes Canon
    # 10-bit 4:2:2 footage so every downstream tool can read the result.
    src_height = _probe_video_height(input_video)
    is_oversized = bool(src_height and src_height > 1920)
    post_scale = "scale=-2:min(1920\\,ih)," if is_oversized else ""
    filter_parts.append(f"[outv0]{post_scale}format=yuv420p[outv]")

    filter_complex = ';'.join(filter_parts)

    cmd = ['ffmpeg', '-y']
    if is_oversized:
        threads = _safe_threads()
        print(f"[Cleaner] {src_height}p source detected — downscaling to 1080p-class "
              f"and capping ffmpeg to {threads} threads to protect the machine")
        cmd.extend(['-threads', str(threads)])
    cmd.extend([
        '-i', input_video,
        '-filter_complex', filter_complex,
        '-map', '[outv]',
        '-map', '[outa]',
        '-c:v', 'libx264',
        '-c:a', 'aac',
        '-preset', 'fast',
        '-crf', '20' if is_oversized else '23',
    ])
    if is_oversized:
        cmd.extend(['-threads', str(_safe_threads())])
    cmd.append(output_video)

    print(f"[Cleaner] Running FFmpeg to cut segments...")
    result = subprocess.run(cmd, capture_output=True, text=True)

    if result.returncode != 0:
        print(f"[Cleaner] FFmpeg error: {result.stderr}")
        return False

    print(f"[Cleaner] Video cleaned successfully")
    return True

def clean_video(video_path, output_path=None, model_size='small', language='auto'):
    """
    Main function to clean a video by removing filler words and pauses.

    Args:
        video_path: Path to input video
        output_path: Path for cleaned output (optional, defaults to <name>_clean.mp4)
        model_size: Whisper model size ('tiny', 'base', 'small', 'medium', 'large')
        language: Language code or 'auto'

    Returns:
        Path to cleaned video or None if failed
    """
    if not os.path.exists(video_path):
        print(f"[Cleaner] Input video not found: {video_path}")
        return None

    if output_path is None:
        base, ext = os.path.splitext(video_path)
        output_path = f"{base}_clean{ext}"

    print(f"[Cleaner] Starting video cleanup: {video_path}")

    # Step 1: Transcribe
    segments = transcribe_audio(video_path, model_size, language)

    if not segments:
        print("[Cleaner] Transcription failed")
        return None

    # Step 2: Detect language and get filler words
    detected_lang = detect_language(segments)
    if language == 'auto':
        language = detected_lang
    filler_words = get_filler_words(language)
    print(f"[Cleaner] Using filler words for language: {language}")

    # Step 3: Find segments to cut
    cuts = find_segments_to_cut(segments, filler_words)

    if not cuts:
        print("[Cleaner] No filler words or pauses found, copying original")
        shutil.copyfile(video_path, output_path)
        return output_path

    # Step 4: Cut video
    success = cut_video_segments(video_path, cuts, output_path)

    if success:
        print(f"[Cleaner] Output saved to: {output_path}")
        return output_path
    else:
        print("[Cleaner] Failed to clean video")
        return None


def create_single_reel(video_path, output_path=None, model_size='small', language='auto',
                       target_duration=None, improve_framing=True, reference_script=None):
    """
    Create a single polished reel from a raw recording (4-5 minutes).

    Features:
    - Removes filler words (uh, um, ah)
    - Removes pauses
    - Removes repeated sentences/restarts
    - Optional: Smart truncation to target duration (e.g., 60s for Reels)
    - Optional: Improved face framing/centering

    Args:
        video_path: Path to input video
        output_path: Path for output (optional)
        model_size: Whisper model size
        language: Language code or 'auto'
        target_duration: Target duration in seconds (optional, e.g., 55 for Reels)
        improve_framing: If True, apply better face centering

    Returns:
        Path to output reel or None if failed
    """
    if not os.path.exists(video_path):
        print(f"[Reel] Input video not found: {video_path}")
        return None

    if output_path is None:
        base, ext = os.path.splitext(video_path)
        output_path = f"{base}_reel.mp4"
    elif not output_path.endswith('.mp4'):
        # Ensure output has .mp4 extension
        output_path = output_path + '.mp4'

    print(f"[Reel] Creating single polished reel from: {video_path}")

    # Step 1: Transcribe
    segments = transcribe_audio(video_path, model_size, language)

    if not segments:
        print("[Reel] Transcription failed")
        return None

    # Step 2: Detect language and get filler words
    detected_lang = detect_language(segments)
    if language == 'auto':
        language = detected_lang
    filler_words = get_filler_words(language)
    print(f"[Reel] Using filler words for language: {language}")

    # Step 3: Get video duration (needed by AI analysis + truncation)
    cmd = [
        'ffprobe', '-v', 'error', '-show_entries', 'format=duration',
        '-of', 'default=noprint_wrappers=1:nokey=1', video_path
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    video_duration = float(result.stdout.strip())
    print(f"[Reel] Video duration: {video_duration:.1f}s")

    # Step 4: AI transcript comprehension — let Gemini read the full transcript
    # and decide which ranges to keep / cut based on what the video is actually about.
    ai_plan = analyze_transcript_with_gemini(segments, video_duration, target_duration, reference_script=reference_script)

    if ai_plan and ai_plan.get('keep_ranges'):
        # Use AI plan: cuts = everything outside keep_ranges, plus AI's explicit cut_ranges.
        keep = trim_keep_ranges_to_sentences(ai_plan['keep_ranges'], segments)
        cuts = invert_keep_ranges(keep, video_duration)
        for s, e in ai_plan.get('cut_ranges', []):
            cuts.append((s, e))
        print(f"[Reel] Using AI-driven edit plan ({len(cuts)} cut range(s))")
    else:
        # Fallback: heuristic-only filler/pause/repeat detection
        cuts = find_segments_to_cut(segments, filler_words, detect_repeats=True)
        if not cuts:
            print("[Reel] No filler words or pauses found, using original")
            cuts = []

    # Safety pass: detect false-start / double-take restarts that the AI may have missed
    # (e.g. "Mistake number 4." ... pause ... "Mistake number 4, ...").
    restart_cuts = find_restart_cuts(segments)
    if restart_cuts:
        cuts.extend(restart_cuts)
        print(f"[Reel] Added {len(restart_cuts)} restart cut(s) as safety net")

    # Safety pass: detect abandoned/unfinished sentences (no terminal punctuation +
    # long pause + new sentence starts after).
    abandoned_cuts = find_abandoned_sentence_cuts(segments)
    if abandoned_cuts:
        cuts.extend(abandoned_cuts)
        print(f"[Reel] Added {len(abandoned_cuts)} abandoned-sentence cut(s)")

    # Merge overlapping / adjacent cuts
    if cuts:
        cuts.sort()
        merged = []
        for s, e in cuts:
            if merged and s <= merged[-1][1]:
                merged[-1] = (merged[-1][0], max(merged[-1][1], e))
            else:
                merged.append((s, e))
        cuts = merged

    # Step 5: If target_duration specified, optionally trim — but never when an AI plan is in use,
    # because that plan already accounts for narrative completeness (e.g. "5 mistakes" videos).
    used_ai_plan = bool(ai_plan and ai_plan.get('keep_ranges'))
    if target_duration and video_duration > target_duration and not used_ai_plan:
        print(f"[Reel] Target duration: {target_duration}s - selecting best content...")
        remaining_after_cuts = video_duration - sum(e - s for s, e in cuts)
        if remaining_after_cuts > target_duration:
            # Add a cut at the end
            excess = remaining_after_cuts - target_duration
            cuts.append((video_duration - excess - 0.5, video_duration))
            print(f"[Reel] Trimming {excess:.1f}s from end for target duration")
    elif used_ai_plan and target_duration:
        remaining_after_cuts = video_duration - sum(e - s for s, e in cuts)
        if remaining_after_cuts > target_duration:
            print(f"[Reel] AI plan kept {remaining_after_cuts:.1f}s (longer than {target_duration}s hint) "
                  f"to preserve narrative completeness")

    # Step 6: Cut video
    if cuts:
        success = cut_video_segments(video_path, cuts, output_path)
        if not success:
            print("[Reel] Failed to clean video")
            return None
    else:
        # No cuts needed. For oversized camera footage, transcode down to
        # 1080p-class once here so the framing pass never touches 4K frames.
        src_h = _probe_video_height(video_path)
        if src_h and src_h > 1920:
            threads = _safe_threads()
            print(f"[Reel] {src_h}p source — creating 1080p-class working copy "
                  f"({threads} threads) instead of raw copy")
            cmd = [
                'ffmpeg', '-y', '-threads', str(threads), '-i', video_path,
                '-vf', 'scale=-2:1920,format=yuv420p',
                '-c:v', 'libx264', '-preset', 'fast', '-crf', '20',
                '-c:a', 'aac', '-b:a', '192k',
                '-threads', str(threads),
                output_path
            ]
            result = subprocess.run(cmd, capture_output=True)
            if result.returncode != 0:
                print("[Reel] Downscale failed, falling back to raw copy")
                shutil.copyfile(video_path, output_path)
        else:
            shutil.copyfile(video_path, output_path)

    # Step 7: Apply improved framing if requested
    if improve_framing:
        print("[Reel] Applying improved face framing...")
        framed_output = output_path.replace('.mp4', '_framed.mp4')
        success = apply_improved_framing(output_path, framed_output)
        if success:
            # Replace original with framed version
            os.replace(framed_output, output_path)
            print("[Reel] Applied improved framing")

    print(f"[Reel] Output saved to: {output_path}")
    return output_path


def apply_improved_framing(input_video, output_video):
    """
    Apply improved face centering for vertical 9:16 format.
    Uses MediaPipe face detection to track and center the subject.
    """
    import cv2
    import mediapipe as mp
    import numpy as np

    mp_face_detection = mp.solutions.face_detection
    face_detection = mp_face_detection.FaceDetection(model_selection=1, min_detection_confidence=0.5)

    cap = cv2.VideoCapture(input_video)
    if not cap.isOpened():
        print("[Framing] Error: Could not open video")
        return False

    # Get video properties
    fps = cap.get(cv2.CAP_PROP_FPS)
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))

    # Calculate output dimensions for 9:16 vertical.
    # Capped at 1920 high — platforms deliver 1080x1920 max, and pushing 4K
    # frames through VideoWriter overloads RAM/CPU on raw camera footage.
    output_height = min(height, 1920)
    if output_height % 2 != 0:
        output_height -= 1
    output_width = int(output_height * 9 / 16)
    if output_width % 2 != 0:
        output_width += 1

    # Crop window measured in SOURCE pixels (full height, 9:16 width)
    crop_w_src = min(int(height * 9 / 16), width)

    # FourCC codec - use H.264 if available, otherwise mp4v
    fourcc = cv2.VideoWriter_fourcc(*'avc1') if cv2.VideoWriter_fourcc(*'avc1') else cv2.VideoWriter_fourcc(*'mp4v')
    out = cv2.VideoWriter(output_video, fourcc, fps, (output_width, output_height))

    if not out.isOpened():
        print("[Framing] Error: Could not create VideoWriter")
        cap.release()
        return False

    # Smoothed center position
    smooth_x = width / 2
    target_x = width / 2
    smoothing_factor = 0.08  # Lower = smoother but slower tracking

    frame_count = 0
    faces_detected = 0

    print(f"[Framing] Processing {total_frames} frames...")

    while True:
        ret, frame = cap.read()
        if not ret:
            break

        frame_count += 1

        # Detect on a 480p copy — MediaPipe returns coordinates relative to the
        # frame, so no scaling back is needed, and detection on full-resolution
        # camera frames is what overloads the CPU
        if height > 480:
            det_w = max(2, int(width * 480 / height))
            det_frame = cv2.resize(frame, (det_w, 480))
        else:
            det_frame = frame
        rgb_frame = cv2.cvtColor(det_frame, cv2.COLOR_BGR2RGB)
        results = face_detection.process(rgb_frame)

        if results.detections:
            faces_detected += 1
            # Get the largest face (closest to camera)
            largest_face = max(results.detections,
                              key=lambda d: d.location_data.relative_bounding_box.width *
                                          d.location_data.relative_bounding_box.height)

            bbox = largest_face.location_data.relative_bounding_box
            face_center_x = (bbox.xmin + bbox.width / 2) * width

            # Update target position
            target_x = face_center_x

        # Smooth the movement
        smooth_x = smooth_x + (target_x - smooth_x) * smoothing_factor

        # Clamp to valid range (in source-pixel space)
        half_crop = crop_w_src / 2
        min_x = half_crop
        max_x = width - half_crop
        smooth_x = max(min_x, min(max_x, smooth_x))

        # Calculate crop region
        left = int(smooth_x - half_crop)
        right = left + crop_w_src

        # Ensure within bounds
        if left < 0:
            left = 0
            right = crop_w_src
        if right > width:
            right = width
            left = width - crop_w_src

        # Crop at source resolution, then scale to the (capped) output size
        cropped = frame[:, left:right]
        if cropped.shape[1] != output_width or cropped.shape[0] != output_height:
            cropped = cv2.resize(cropped, (output_width, output_height))

        try:
            out.write(cropped)
        except cv2.error as e:
            print(f"[Framing] Warning: Frame write error at frame {frame_count}: {e}")
            # Write a blank frame as fallback
            blank = np.zeros((output_height, output_width, 3), dtype=np.uint8)
            out.write(blank)

        if frame_count % 30 == 0:
            print(f"[Framing] Progress: {frame_count}/{total_frames} frames ({100*frame_count/total_frames:.0f}%)")

    cap.release()
    out.release()

    # Audio handling - copy audio from original
    temp_video = output_video.replace('.mp4', '_temp.mp4')
    os.rename(output_video, temp_video)

    cmd = [
        'ffmpeg', '-y',
        '-i', temp_video,
        '-i', input_video,
        '-map', '0:v',
        '-map', '1:a',
        '-c:v', 'libx264',
        '-c:a', 'aac',
        '-preset', 'fast',
        '-crf', '23',
        output_video
    ]
    subprocess.run(cmd, capture_output=True)
    os.remove(temp_video)

    print(f"[Framing] Complete. Faces detected in {faces_detected}/{frame_count} frames")
    return True


if __name__ == "__main__":
    import sys
    if len(sys.argv) < 2:
        print("Usage: python video_cleaner.py <video_path> [output_path] [model_size] [language]")
        print("       python video_cleaner.py --reel <video_path> [output] [model] [lang] [target_duration]")
        sys.exit(1)

    if sys.argv[1] == "--reel":
        # Single reel mode
        video = sys.argv[2] if len(sys.argv) > 2 else None
        if not video:
            print("Error: Missing video path")
            sys.exit(1)
        output = sys.argv[3] if len(sys.argv) > 3 else None
        model = sys.argv[4] if len(sys.argv) > 4 else 'small'
        lang = sys.argv[5] if len(sys.argv) > 5 else 'auto'
        target = float(sys.argv[6]) if len(sys.argv) > 6 else None

        result = create_single_reel(video, output, model, lang, target)
    else:
        # Standard clean mode
        video = sys.argv[1]
        output = sys.argv[2] if len(sys.argv) > 2 else None
        model = sys.argv[3] if len(sys.argv) > 3 else 'small'
        lang = sys.argv[4] if len(sys.argv) > 4 else 'auto'

        result = clean_video(video, output, model, lang)

    if result:
        print(f"Output saved to: {result}")
    else:
        print("Failed to process video")
        sys.exit(1)
