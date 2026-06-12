import React from "react";
import {
  AbsoluteFill,
  Sequence,
  useCurrentFrame,
  useVideoConfig,
  spring,
  interpolate,
} from "remotion";
import type { SubtitleConfig } from "../lib/types";
import { groupCaptionsIntoBlocks, getActiveWordIndex } from "../lib/captions";
import { getFontStack } from "../lib/fonts";

interface SubtitlesProps {
  config: SubtitleConfig;
}

const POSITION_MAP: Record<string, React.CSSProperties> = {
  top: { top: "12%", bottom: "auto" },
  middle: { top: "45%", bottom: "auto" },
  bottom: { bottom: "10%", top: "auto" },
};

// Detect "loud" words (ALL CAPS, numbers, or punctuation hits)
const isLoudWord = (text: string) => {
  if (!text) return false;
  const t = text.trim();
  if (/[!?]$/.test(t)) return true;
  if (/\d/.test(t)) return true;
  const letters = t.replace(/[^A-Za-z]/g, "");
  if (letters.length >= 3 && letters === letters.toUpperCase()) return true;
  return false;
};

// Build the outline for the chosen stroke. Returns "" when the stroke is
// off (width <= 0) — nothing is forced, so "no stroke" really means none.
const buildTextShadow = (borderWidth: number, borderColor: string) => {
  if (borderWidth <= 0) {
    return "";
  }
  const w = borderWidth;
  const layers: string[] = [
    `${w}px 0 0 ${borderColor}`,
    `-${w}px 0 0 ${borderColor}`,
    `0 ${w}px 0 ${borderColor}`,
    `0 -${w}px 0 ${borderColor}`,
    `${w}px ${w}px 0 ${borderColor}`,
    `-${w}px -${w}px 0 ${borderColor}`,
    `${w}px -${w}px 0 ${borderColor}`,
    `-${w}px ${w}px 0 ${borderColor}`,
  ];
  return layers.join(", ");
};

// Compose shadow layers, dropping empty ones (e.g. stroke off).
const joinShadows = (...parts: (string | undefined | false)[]) =>
  parts.filter(Boolean).join(", ") || "none";

export const Subtitles: React.FC<SubtitlesProps> = ({ config }) => {
  const { fps } = useVideoConfig();
  const blocks = groupCaptionsIntoBlocks(
    config.captions,
    20,
    2000,
    config.wordsPerLine
  );

  return (
    <AbsoluteFill>
      {blocks.map((block, i) => {
        const startFrame = Math.round((block.startMs / 1000) * fps);
        const durationFrames = Math.max(
          1,
          Math.round(((block.endMs - block.startMs) / 1000) * fps)
        );

        return (
          <Sequence
            key={i}
            from={startFrame}
            durationInFrames={durationFrames}
            layout="none"
          >
            <SubtitleBlock
              block={block}
              config={config}
              blockStartMs={block.startMs}
            />
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};

interface SubtitleBlockProps {
  block: ReturnType<typeof groupCaptionsIntoBlocks>[number];
  config: SubtitleConfig;
  blockStartMs: number;
}

const SubtitleBlock: React.FC<SubtitleBlockProps> = ({
  block,
  config,
  blockStartMs,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { style, position } = config;

  // Current time relative to composition start (sequence-relative frame)
  const currentTimeMs = blockStartMs + (frame / fps) * 1000;
  const activeIndex = getActiveWordIndex(block.words, currentTimeMs);

  // Free-form drag position takes precedence over the top/middle/bottom preset.
  const hasFreePos =
    typeof config.posX === "number" && typeof config.posY === "number";
  const positionStyle: React.CSSProperties = hasFreePos
    ? {
        left: `${config.posX}%`,
        top: `${config.posY}%`,
        right: "auto",
        bottom: "auto",
        transform: "translate(-50%, -50%)",
      }
    : POSITION_MAP[position] ?? POSITION_MAP.bottom;
  const fontStack = getFontStack(style.fontFamily);
  const highlightFontStack = style.highlightFontFamily
    ? getFontStack(style.highlightFontFamily)
    : fontStack;

  // Background box style
  const hasBg = style.bgOpacity > 0;
  const bgStyle: React.CSSProperties = hasBg
    ? {
        backgroundColor: `${style.bgColor}${Math.round(style.bgOpacity * 255)
          .toString(16)
          .padStart(2, "0")}`,
        borderRadius: 8,
        padding: "8px 16px",
      }
    : {};

  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        display: "flex",
        justifyContent: "center",
        ...positionStyle,
      }}
    >
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          justifyContent: "center",
          alignItems: "center",
          maxWidth: "92%",
          // Hormozi / Stack styles force one word per line so the active
          // keyword pops as a giant centered word (see the Reels mock-ups).
          flexDirection:
            style.animation === "hormozi" || style.animation === "stack"
              ? "column"
              : "row",
          gap:
            style.animation === "hormozi"
              ? "0.05em"
              : style.animation === "stack"
              ? "0.02em"
              : 0,
          ...bgStyle,
        }}
      >
        {block.words.map((word, i) => (
          <WordSpan
            key={i}
            word={word.text}
            isActive={i === activeIndex}
            wordIndex={i}
            totalWords={block.words.length}
            style={style}
            fontStack={fontStack}
            highlightFontStack={highlightFontStack}
            animation={style.animation}
            frame={frame}
            fps={fps}
            wordStartMs={word.startMs}
            blockStartMs={blockStartMs}
          />
        ))}
      </div>
    </div>
  );
};

interface WordSpanProps {
  word: string;
  isActive: boolean;
  wordIndex: number;
  totalWords: number;
  style: SubtitleConfig["style"];
  fontStack: string;
  highlightFontStack?: string;
  animation: SubtitleConfig["style"]["animation"];
  frame: number;
  fps: number;
  wordStartMs: number;
  blockStartMs: number;
}

const WordSpan: React.FC<WordSpanProps> = ({
  word,
  isActive,
  wordIndex,
  totalWords,
  style,
  fontStack,
  highlightFontStack,
  animation,
  frame,
  fps,
  wordStartMs,
  blockStartMs,
}) => {
  const wordStartFrame = Math.round(
    ((wordStartMs - blockStartMs) / 1000) * fps
  );

  let transform = "";
  let color = isActive ? style.highlightColor : style.fontColor;
  let extraStyle: React.CSSProperties = {};
  let textShadowOverride: string | undefined;
  let fontSizeOverride: number | undefined;

  // The user-controlled stroke ("" when turned off). Reused by every
  // animation so "no stroke" stays no stroke even on the active word.
  const strokeShadow = buildTextShadow(style.borderWidth, style.borderColor);

  // Emphasis animation: detect loud words and give them extra pop
  const loud = isLoudWord(word);

  if (isActive) {
    switch (animation) {
      case "pop": {
        const s = spring({
          frame: frame - wordStartFrame,
          fps,
          config: { mass: 0.5, stiffness: 300, damping: 12 },
          durationInFrames: 10,
        });
        const scaleValue = interpolate(s, [0, 1], [1, 1.25]);
        transform = `scale(${scaleValue})`;
        break;
      }
      case "bounce": {
        const delta = frame - wordStartFrame;
        const activeWindow = Math.round(0.22 * fps);
        const t = Math.min(1, Math.max(0, delta / activeWindow));
        const ease = 1 - Math.pow(1 - t, 3);
        const y = -12 * (1 - ease);
        const scaleValue = 1 + t * 0.08;
        transform = `translateY(${y}px) scale(${scaleValue})`;
        break;
      }
      case "fadeup": {
        const delta = frame - wordStartFrame;
        const dur = Math.round(0.18 * fps);
        const t = Math.min(1, Math.max(0, delta / dur));
        const ease = 1 - Math.pow(1 - t, 2);
        const y = (1 - ease) * 16;
        const opacity = delta < 0 ? 0 : ease;
        extraStyle = { opacity };
        transform = `translateY(${y}px) scale(${isActive ? 1.06 : 1})`;
        break;
      }
      case "emphasis": {
        if (loud) {
          const s = spring({
            frame: frame - wordStartFrame,
            fps,
            config: { mass: 0.6, stiffness: 280, damping: 10 },
            durationInFrames: 12,
          });
          const scaleValue = interpolate(s, [0, 1], [1, 1.35]);
          transform = `scale(${scaleValue}) translateY(-4px)`;
          textShadowOverride = joinShadows(`0 0 10px ${style.highlightColor}`, `0 0 20px ${style.highlightColor}aa`, strokeShadow);
        } else {
          const s = spring({
            frame: frame - wordStartFrame,
            fps,
            config: { mass: 0.5, stiffness: 300, damping: 12 },
            durationInFrames: 10,
          });
          const scaleValue = interpolate(s, [0, 1], [1, 1.12]);
          transform = `scale(${scaleValue})`;
        }
        break;
      }
      case "karaoke": {
        extraStyle = {
          backgroundColor: style.highlightColor,
          color: style.bgColor || "#000000",
          borderRadius: 4,
          padding: "2px 6px",
        };
        break;
      }
      case "word-highlight": {
        extraStyle = {
          textShadow: `0 0 12px ${style.highlightColor}, 0 0 24px ${style.highlightColor}40`,
        };
        break;
      }
      case "hormozi": {
        // Hormozi/Reels viral style: spoken word grows MUCH larger, glows
        // yellow, and (because the parent flex container switches to column
        // for this mode) takes its own row.
        const delta = frame - wordStartFrame;
        const popWindow = Math.round(0.18 * fps);
        const t = Math.min(1, Math.max(0, delta / popWindow));
        const ease = 1 - Math.pow(1 - t, 3);
        const scaleValue = 1 + ease * 0.05;
        transform = `scale(${scaleValue})`;
        fontSizeOverride = style.fontSize * 2.3;
        textShadowOverride = joinShadows(
          `0 0 14px ${style.highlightColor}`,
          `0 0 28px ${style.highlightColor}cc`,
          `0 0 42px ${style.highlightColor}80`,
          strokeShadow
        );
        break;
      }
      case "stack": {
        // Word Stack: each spoken word pops in big white with a soft glow,
        // mimicking the magazine-layout look from the "Your feed looks
        // 5 different people" mock-up. Lower-key than Hormozi.
        const delta = frame - wordStartFrame;
        const popWindow = Math.round(0.14 * fps);
        const t = Math.min(1, Math.max(0, delta / popWindow));
        const ease = 1 - Math.pow(1 - t, 2);
        const opacity = Math.min(1, t * 2);
        const scaleValue = 0.85 + ease * 0.2;
        transform = `scale(${scaleValue})`;
        extraStyle = { opacity };
        fontSizeOverride = style.fontSize * 1.9;
        color = style.fontColor;
        textShadowOverride = joinShadows(strokeShadow, "0 6px 18px rgba(0,0,0,0.55)");
        break;
      }
      default:
        break;
    }
  }

  // Hormozi: words that aren't the active focus shrink and fade so the
  // spoken word visually dominates (matches the "how do you HOOK somebody"
  // composition).
  if (animation === "hormozi" && !isActive) {
    fontSizeOverride = style.fontSize * 0.85;
    extraStyle = { ...extraStyle, opacity: 0.85 };
    color = style.fontColor;
  }

  // Stack: inactive words are dim and slightly smaller — the focal word
  // pops alone in the centre of the stack.
  if (animation === "stack" && !isActive) {
    fontSizeOverride = style.fontSize * 0.75;
    extraStyle = { ...extraStyle, opacity: 0.45 };
    color = style.fontColor;
  }

  // Text stroke via textShadow (CSS paint-order not reliable in Remotion).
  // strokeShadow is "" when the user turned the stroke off, so nothing is drawn.
  const finalTextShadow = textShadowOverride
    ? textShadowOverride
    : animation !== "karaoke"
    ? joinShadows(strokeShadow, extraStyle.textShadow as string)
    : strokeShadow || "none";

  // Force-uppercase for Hormozi-style is overkill — those reels typically
  // keep natural casing on context words and only loud-emphasis the focal
  // word. We leave casing alone unless the user chose "emphasis".
  const isViralActive =
    isActive && (animation === "hormozi" || animation === "stack");

  return (
    <span
      style={{
        fontFamily: isViralActive && highlightFontStack
          ? highlightFontStack
          : isActive && highlightFontStack
          ? highlightFontStack
          : fontStack,
        fontSize: fontSizeOverride ?? style.fontSize,
        fontWeight: isViralActive ? 900 : 800,
        lineHeight: animation === "hormozi" || animation === "stack" ? 0.95 : 1.15,
        color: animation === "karaoke" && isActive ? undefined : color,
        textShadow: finalTextShadow,
        transform,
        transformOrigin: "center center",
        display: "inline-block",
        transition: "none",
        marginRight: animation === "hormozi" || animation === "stack" ? 0 : "0.35em",
        marginBottom: animation === "hormozi" || animation === "stack" ? 0 : "0.12em",
        textTransform: animation === "emphasis" ? "uppercase" : undefined,
        letterSpacing:
          animation === "emphasis"
            ? "0.01em"
            : animation === "hormozi"
            ? "-0.01em"
            : undefined,
        ...extraStyle,
      }}
    >
      {word}
    </span>
  );
};
