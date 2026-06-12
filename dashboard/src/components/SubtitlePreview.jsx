import React, { useRef, useState, useEffect, useMemo } from 'react';
import { groupCaptionsIntoBlocks, getActiveWordIndex } from '../remotion/lib/captions';

const POSITION_MAP = {
  top: { top: '12%', bottom: 'auto' },
  middle: { top: '45%', bottom: 'auto' },
  bottom: { bottom: '10%', top: 'auto' },
};

// Mirror of isLoudWord in Subtitles.tsx — drives the "emphasis" animation.
function isLoudWord(text) {
  if (!text) return false;
  const t = text.trim();
  if (/[!?]$/.test(t)) return true;
  if (/\d/.test(t)) return true;
  const letters = t.replace(/[^A-Za-z]/g, '');
  if (letters.length >= 3 && letters === letters.toUpperCase()) return true;
  return false;
}

// Cubic/quad ease-out helpers (approximate the Remotion springs closely
// enough for a live preview).
const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
const easeOutQuad = (t) => 1 - Math.pow(1 - t, 2);

// Compose text-shadow layers, dropping any empty ones (e.g. when the stroke
// is turned off). Returns 'none' if nothing is left.
const joinShadows = (...parts) => parts.filter(Boolean).join(', ') || 'none';

// Returns the outline layers for the chosen stroke, or '' when the stroke is
// off (width <= 0). No color is forced — the caller's borderColor is used, and
// nothing is drawn when disabled.
function buildTextShadow(borderWidth, borderColor) {
  if (borderWidth <= 0) {
    return '';
  }
  const w = borderWidth;
  const layers = [
    `${w}px 0 0 ${borderColor}`,
    `-${w}px 0 0 ${borderColor}`,
    `0 ${w}px 0 ${borderColor}`,
    `0 -${w}px 0 ${borderColor}`,
    `${w}px ${w}px 0 ${borderColor}`,
    `-${w}px -${w}px 0 ${borderColor}`,
    `${w}px -${w}px 0 ${borderColor}`,
    `-${w}px ${w}px 0 ${borderColor}`,
  ];
  return layers.join(', ');
}

export default function SubtitlePreview({ videoUrl, captions, config, onPositionChange }) {
  const videoRef = useRef(null);
  const containerRef = useRef(null);
  const dragging = useRef(false);
  const [currentTimeMs, setCurrentTimeMs] = useState(0);
  const [videoError, setVideoError] = useState(false);
  const [previewScale, setPreviewScale] = useState(0.3125); // default: 600px / 1920px

  const { style, position, wordsPerLine, posX, posY } = config || {};
  const hasFreePos = typeof posX === 'number' && typeof posY === 'number';

  // Drag the caption block anywhere in the preview → report new % anchor up.
  const onPointerDown = (e) => {
    if (!onPositionChange) return;
    dragging.current = true;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    e.preventDefault();
  };
  const onPointerMove = (e) => {
    if (!dragging.current || !onPositionChange) return;
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const x = Math.min(100, Math.max(0, ((e.clientX - rect.left) / rect.width) * 100));
    const y = Math.min(100, Math.max(0, ((e.clientY - rect.top) / rect.height) * 100));
    onPositionChange(Math.round(x), Math.round(y));
  };
  const onPointerUp = (e) => {
    dragging.current = false;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
  };

  // Measure container height and compute scale relative to 1920px Remotion canvas
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const updateScale = () => {
      const height = el.getBoundingClientRect().height;
      if (height > 0) {
        setPreviewScale(height / 1920);
      }
    };

    updateScale();
    const ro = new ResizeObserver(updateScale);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const blocks = useMemo(() => {
    if (!Array.isArray(captions) || captions.length === 0) return [];
    return groupCaptionsIntoBlocks(captions, 20, 2000, wordsPerLine);
  }, [captions, wordsPerLine]);

  // Find the active block based on current video time
  const activeBlock = blocks.find(
    (b) => currentTimeMs >= b.startMs && currentTimeMs < b.endMs
  );

  // If no active block yet, show the first block as a preview
  const displayBlock = activeBlock || blocks[0];

  const activeIndex = displayBlock
    ? getActiveWordIndex(displayBlock.words, currentTimeMs)
    : -1;

  const positionStyle = POSITION_MAP[position] ?? POSITION_MAP.bottom;
  const anim = style?.animation;
  const isStacked = anim === 'hormozi' || anim === 'stack';

  const hasBg = style?.bgOpacity > 0;
  const bgStyle = hasBg
    ? {
        backgroundColor: `${style.bgColor}${Math.round(style.bgOpacity * 255)
          .toString(16)
          .padStart(2, '0')}`,
        borderRadius: Math.round(8 * previewScale),
        padding: `${Math.round(8 * previewScale)}px ${Math.round(16 * previewScale)}px`,
      }
    : {};

  const baseShadow = buildTextShadow(style?.borderWidth ?? 2, style?.borderColor ?? '#000');

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;

    let rafId = null;

    // Drive the overlay at ~60fps off the video clock. The native 'timeupdate'
    // event only fires ~4x/sec, which is far too coarse to show pop/bounce/
    // fadeup spring animations — so we poll currentTime every animation frame.
    const tick = () => {
      setCurrentTimeMs(v.currentTime * 1000);
      rafId = requestAnimationFrame(tick);
    };

    const onErr = () => {
      console.error('[SubtitlePreview] Video failed to load:', videoUrl);
      setVideoError(true);
    };
    v.addEventListener('error', onErr);

    // Attempt autoplay muted
    const attemptPlay = () => {
      v.play().catch(() => {
        // Autoplay blocked — user can click play manually
      });
    };
    v.addEventListener('loadedmetadata', attemptPlay);

    rafId = requestAnimationFrame(tick);

    return () => {
      if (rafId) cancelAnimationFrame(rafId);
      v.removeEventListener('error', onErr);
      v.removeEventListener('loadedmetadata', attemptPlay);
    };
  }, [videoUrl]);

  const scaledFontSize = Math.round((style?.fontSize ?? 24) * previewScale);

  return (
    <div ref={containerRef} className="relative w-full h-full bg-black flex items-center justify-center">
      {videoError ? (
        <div className="text-zinc-400 text-sm text-center px-4">
          Video preview unavailable.
          <br />
          Subtitles will still render correctly when you click Generate.
        </div>
      ) : (
        <video
          ref={videoRef}
          src={videoUrl}
          className="w-full h-full object-contain"
          controls
          muted
          autoPlay
          playsInline
          preload="auto"
          style={{ maxHeight: '100%' }}
        />
      )}

      {/* Subtitle overlay */}
      {displayBlock && (
        <div
          className="absolute flex justify-center z-10"
          style={hasFreePos
            ? { left: `${posX}%`, top: `${posY}%`, transform: 'translate(-50%, -50%)', pointerEvents: 'none' }
            : { left: 0, right: 0, pointerEvents: 'none', ...positionStyle }}
        >
          <div
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            className="flex justify-center items-center"
            style={{
              maxWidth: '92%',
              // Match Subtitles.tsx: Hormozi/Stack stack words vertically so
              // the active keyword pops big on its own line.
              flexDirection: isStacked ? 'column' : 'row',
              flexWrap: isStacked ? 'nowrap' : 'wrap',
              gap: anim === 'hormozi' ? `${0.05 * scaledFontSize}px` : anim === 'stack' ? `${0.02 * scaledFontSize}px` : 0,
              pointerEvents: onPositionChange ? 'auto' : 'none',
              cursor: onPositionChange ? (dragging.current ? 'grabbing' : 'grab') : 'default',
              touchAction: 'none',
              ...bgStyle,
            }}
          >
            {displayBlock.words.map((word, i) => {
              const isWordActive = i === activeIndex;

              // Time (ms) since this word started being spoken — drives the
              // motion of each animation, just like the frame delta in
              // Subtitles.tsx.
              const delta = currentTimeMs - word.startMs;

              let wordFontSize = scaledFontSize;
              let color = isWordActive
                ? style?.highlightColor ?? '#FFDD00'
                : style?.fontColor ?? '#FFFFFF';
              let wordShadow = baseShadow;
              let opacity = 1;
              let fontWeight = 800;
              let transform = '';
              let karaokeBox = null;

              if (isWordActive) {
                switch (anim) {
                  case 'pop': {
                    const t = Math.min(1, Math.max(0, delta / 180));
                    transform = `scale(${1 + easeOutCubic(t) * 0.25})`;
                    break;
                  }
                  case 'bounce': {
                    const t = Math.min(1, Math.max(0, delta / 220));
                    const ease = easeOutCubic(t);
                    transform = `translateY(${-12 * previewScale * (1 - ease)}px) scale(${1 + t * 0.08})`;
                    break;
                  }
                  case 'fadeup': {
                    const t = Math.min(1, Math.max(0, delta / 180));
                    const ease = easeOutQuad(t);
                    opacity = delta < 0 ? 0 : ease;
                    transform = `translateY(${(1 - ease) * 16 * previewScale}px) scale(1.06)`;
                    break;
                  }
                  case 'emphasis': {
                    const loud = isLoudWord(word.text);
                    const t = Math.min(1, Math.max(0, delta / (loud ? 200 : 170)));
                    const ease = easeOutCubic(t);
                    transform = `scale(${1 + ease * (loud ? 0.35 : 0.12)})`;
                    if (loud) {
                      const hc = style?.highlightColor ?? '#FFDD00';
                      wordShadow = joinShadows(`0 0 ${10 * previewScale}px ${hc}`, `0 0 ${20 * previewScale}px ${hc}aa`, baseShadow);
                    }
                    break;
                  }
                  case 'word-highlight': {
                    const hc = style?.highlightColor ?? '#FFDD00';
                    wordShadow = joinShadows(`0 0 ${12 * previewScale}px ${hc}`, `0 0 ${24 * previewScale}px ${hc}40`, baseShadow);
                    break;
                  }
                  case 'karaoke': {
                    color = style?.bgColor ?? '#000000';
                    karaokeBox = {
                      backgroundColor: style?.highlightColor ?? '#FFDD00',
                      borderRadius: Math.round(4 * previewScale * 4),
                      padding: `${2 * previewScale * 4}px ${6 * previewScale * 4}px`,
                    };
                    wordShadow = 'none';
                    break;
                  }
                  case 'hormozi': {
                    const hc = style?.highlightColor ?? '#FFDD00';
                    wordFontSize = scaledFontSize * 2.3;
                    color = hc;
                    fontWeight = 900;
                    wordShadow = joinShadows(`0 0 ${14 * previewScale}px ${hc}`, `0 0 ${28 * previewScale}px ${hc}cc`, `0 0 ${42 * previewScale}px ${hc}80`, baseShadow);
                    const t = Math.min(1, Math.max(0, delta / 180));
                    transform = `scale(${1 + easeOutCubic(t) * 0.05})`;
                    break;
                  }
                  case 'stack': {
                    wordFontSize = scaledFontSize * 1.9;
                    color = style?.fontColor ?? '#FFFFFF';
                    fontWeight = 900;
                    wordShadow = joinShadows(baseShadow, `0 ${6 * previewScale}px ${18 * previewScale}px rgba(0,0,0,0.55)`);
                    const t = Math.min(1, Math.max(0, delta / 140));
                    opacity = Math.min(1, t * 2);
                    transform = `scale(${0.85 + easeOutQuad(t) * 0.2})`;
                    break;
                  }
                  default:
                    break;
                }
              }

              // Inactive context words in the viral stacked styles shrink & dim
              // so the focal word dominates.
              if (!isWordActive && anim === 'hormozi') {
                wordFontSize = scaledFontSize * 0.85;
                opacity = 0.85;
                color = style?.fontColor ?? '#FFFFFF';
              }
              if (!isWordActive && anim === 'stack') {
                wordFontSize = scaledFontSize * 0.75;
                opacity = 0.45;
                color = style?.fontColor ?? '#FFFFFF';
              }

              const fontFamily =
                isWordActive && style?.highlightFontFamily
                  ? style.highlightFontFamily
                  : style?.fontFamily ?? 'Verdana';

              return (
                <span
                  key={i}
                  style={{
                    fontFamily,
                    fontSize: wordFontSize,
                    fontWeight,
                    lineHeight: isStacked ? 0.95 : 1.15,
                    color,
                    opacity,
                    textShadow: wordShadow,
                    transform,
                    transformOrigin: 'center center',
                    display: 'inline-block',
                    marginRight: isStacked ? 0 : '0.35em',
                    marginBottom: isStacked ? 0 : '0.12em',
                    textTransform: anim === 'emphasis' ? 'uppercase' : undefined,
                    letterSpacing: anim === 'emphasis' ? '0.01em' : anim === 'hormozi' ? '-0.01em' : undefined,
                    ...(karaokeBox || {}),
                  }}
                >
                  {word.text}
                </span>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
