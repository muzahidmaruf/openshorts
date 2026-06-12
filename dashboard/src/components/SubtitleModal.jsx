import React, { useState, useEffect } from 'react';
import { X, Type, Loader2, Sparkles, Check } from 'lucide-react';
import { getApiUrl } from '../config';
import SubtitlePreview from './SubtitlePreview';

const COLOR_PRESETS = [
    { color: '#FFFFFF', label: 'White' },
    { color: '#FFFF00', label: 'Yellow' },
    { color: '#00FFFF', label: 'Cyan' },
    { color: '#00FF00', label: 'Green' },
    { color: '#FF0000', label: 'Red' },
    { color: '#FF69B4', label: 'Pink' },
];

const ANIMATION_OPTIONS = [
    { value: 'hormozi', label: 'Viral 🔥' },
    { value: 'stack', label: 'Word Stack' },
    { value: 'pop', label: 'Pop' },
    { value: 'bounce', label: 'Bounce' },
    { value: 'fadeup', label: 'Fade Up' },
    { value: 'emphasis', label: 'Emphasis' },
    { value: 'word-highlight', label: 'Glow' },
    { value: 'karaoke', label: 'Karaoke' },
    { value: 'none', label: 'None' },
];

const STORAGE_KEY = 'os_subtitle_prefs';

const loadPrefs = () => {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        return raw ? JSON.parse(raw) : {};
    } catch {
        return {};
    }
};

const savePrefs = (prefs) => {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
    } catch {
        // ignore
    }
};

export default function SubtitleModal({ isOpen, onClose, onGenerate, isProcessing, videoUrl, jobId, clipIndex, geminiApiKey, existingHook }) {
    const prefs = loadPrefs();
    const [position, setPosition] = useState(prefs.position ?? 'bottom');
    // Free-form caption anchor as % of the canvas (center point). Presets seed
    // these; the drag handle / sliders fine-tune them on either axis.
    const PRESET_Y = { top: 12, middle: 50, bottom: 90 };
    const [posX, setPosX] = useState(prefs.posX ?? 50);
    const [posY, setPosY] = useState(prefs.posY ?? PRESET_Y[prefs.position ?? 'bottom']);
    const [fontSize, setFontSize] = useState(prefs.fontSize ?? 24);
    const [fontName, setFontName] = useState(prefs.fontName ?? 'Verdana');
    const [highlightFontName, setHighlightFontName] = useState(prefs.highlightFontName ?? '');
    const [fontColor, setFontColor] = useState(prefs.fontColor ?? '#FFFFFF');
    const [highlightColor, setHighlightColor] = useState(prefs.highlightColor ?? '#FFDD00');
    const [borderColor, setBorderColor] = useState(prefs.borderColor ?? '#000000');
    const [borderWidth, setBorderWidth] = useState(prefs.borderWidth ?? 2);
    const [bgColor, setBgColor] = useState(prefs.bgColor ?? '#000000');
    const [bgOpacity, setBgOpacity] = useState(prefs.bgOpacity ?? 0.0);
    const [animation, setAnimation] = useState(prefs.animation ?? 'pop');
    const [wordsPerLine, setWordsPerLine] = useState(prefs.wordsPerLine ?? 3);
    const [showTextEditor, setShowTextEditor] = useState(false);
    const [editMode, setEditMode] = useState('words'); // 'words' (per-word) | 'bulk'

    // Remotion preview state
    const [captions, setCaptions] = useState([]);
    const [originalCaptions, setOriginalCaptions] = useState([]);
    const [editableText, setEditableText] = useState('');
    const [durationSec, setDurationSec] = useState(30);
    const [captionsLoading, setCaptionsLoading] = useState(false);
    const [useRemotionPreview, setUseRemotionPreview] = useState(false);
    const [captionLanguage, setCaptionLanguage] = useState('en');

    // AI spell-fix state
    const [spellFixing, setSpellFixing] = useState(false);
    const [spellFixMsg, setSpellFixMsg] = useState(null);

    // System fonts
    const [systemFonts, setSystemFonts] = useState([]);
    const [fontsLoading, setFontsLoading] = useState(false);

    // Fetch system fonts once when modal opens
    useEffect(() => {
        if (!isOpen) return;
        setFontsLoading(true);
        fetch(getApiUrl('/api/fonts'))
            .then((res) => res.ok ? res.json() : null)
            .then((data) => {
                if (data && data.fonts && data.fonts.length > 0) {
                    setSystemFonts(data.fonts);
                    // If current fontName isn't in the list, keep it anyway
                }
            })
            .catch(() => {})
            .finally(() => setFontsLoading(false));
    }, [isOpen]);

    // Fetch word-level captions when modal opens
    useEffect(() => {
        if (!isOpen || !jobId || clipIndex === undefined) return;

        setCaptionsLoading(true);
        fetch(getApiUrl(`/api/clip/${jobId}/${clipIndex}/transcript`))
            .then((res) => res.ok ? res.json() : null)
            .then((data) => {
                if (data && data.captions && data.captions.length > 0) {
                    setCaptions(data.captions);
                    setOriginalCaptions(data.captions);
                    setEditableText(data.captions.map(c => c.text).join(' '));
                    setDurationSec(data.durationSec || 30);
                    setCaptionLanguage(data.language || 'en');
                    setUseRemotionPreview(true);
                } else {
                    setUseRemotionPreview(false);
                }
            })
            .catch(() => setUseRemotionPreview(false))
            .finally(() => setCaptionsLoading(false));
    }, [isOpen, jobId, clipIndex]);

    // When user edits text, redistribute words across original timestamps
    const handleTextEdit = (newText) => {
        setEditableText(newText);
        const newWords = newText.split(/\s+/).filter(w => w.length > 0);
        if (newWords.length === 0 || originalCaptions.length === 0) {
            setCaptions([]);
            return;
        }

        // Distribute new words across the time span of original captions
        const totalDurationMs = originalCaptions[originalCaptions.length - 1].endMs - originalCaptions[0].startMs;
        const startMs = originalCaptions[0].startMs;
        const wordDurationMs = totalDurationMs / newWords.length;

        const newCaptions = newWords.map((word, i) => ({
            text: word,
            startMs: Math.round(startMs + i * wordDurationMs),
            endMs: Math.round(startMs + (i + 1) * wordDurationMs),
        }));
        setCaptions(newCaptions);
    };

    // Apply an updated caption array to all the dependent state in one place.
    const applyCaptions = (next) => {
        setCaptions(next);
        setOriginalCaptions(next);
        setEditableText(next.map((c) => c.text).join(' '));
    };

    // Edit a single word in place — keeps every other word's exact timestamp.
    // Splits this word's time slot evenly if the user types multiple words.
    const handleWordChange = (index, value) => {
        const src = captions[index];
        if (!src) return;

        const pieces = value.split(/\s+/).filter((w) => w.length > 0);
        let next;
        if (pieces.length <= 1) {
            // Simple in-place replacement (also allows clearing to '')
            next = captions.map((c, i) => (i === index ? { ...c, text: value } : c));
        } else {
            // User typed several words into one slot → subdivide its time range
            const span = (src.endMs - src.startMs) / pieces.length;
            const expanded = pieces.map((w, k) => ({
                text: w,
                startMs: Math.round(src.startMs + k * span),
                endMs: Math.round(src.startMs + (k + 1) * span),
            }));
            next = [...captions.slice(0, index), ...expanded, ...captions.slice(index + 1)];
        }
        applyCaptions(next);
    };

    // Delete a single caption word (e.g. a filler the AI mis-heard).
    const handleWordDelete = (index) => {
        applyCaptions(captions.filter((_, i) => i !== index));
    };

    // Fix spelling/typos in the captions with a cheap Gemini model. Word count
    // and per-word timestamps are preserved (the backend enforces 1:1 mapping).
    const handleFixSpelling = async () => {
        const apiKey = geminiApiKey || localStorage.getItem('gemini_key');
        if (!apiKey) {
            setSpellFixMsg({ ok: false, text: 'Gemini API key missing — set it in Settings.' });
            setTimeout(() => setSpellFixMsg(null), 4000);
            return;
        }
        if (captions.length === 0) return;

        setSpellFixing(true);
        setSpellFixMsg(null);
        try {
            const res = await fetch(getApiUrl('/api/subtitle/fix-spelling'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-Gemini-Key': apiKey },
                body: JSON.stringify({
                    words: captions.map(c => c.text),
                    language: captionLanguage,
                }),
            });
            if (!res.ok) throw new Error(await res.text());
            const data = await res.json();

            if (data.error) throw new Error(data.error);

            const fixed = data.words || [];
            if (fixed.length !== captions.length) {
                throw new Error('Correction length mismatch');
            }

            // Map corrected words back onto the existing timestamps
            let changes = 0;
            const corrected = captions.map((c, i) => {
                if (fixed[i] !== c.text) changes++;
                return { ...c, text: fixed[i] };
            });

            applyCaptions(corrected);
            setSpellFixMsg({
                ok: true,
                text: changes === 0 ? 'No spelling issues found.' : `Fixed ${changes} word${changes === 1 ? '' : 's'}.`,
            });
            setTimeout(() => setSpellFixMsg(null), 4000);
        } catch (e) {
            setSpellFixMsg({ ok: false, text: 'Spell-fix failed. Try again.' });
            setTimeout(() => setSpellFixMsg(null), 4000);
        } finally {
            setSpellFixing(false);
        }
    };

    if (!isOpen) return null;

    // Ensure absolute video URL for the preview (bypass Vite proxy issues)
    const previewVideoUrl = videoUrl.startsWith('http')
        ? videoUrl
        : `${window.location.protocol}//${window.location.hostname}:8000${videoUrl}`;

    // Build subtitle config for Remotion
    const subtitleConfig = {
        captions,
        position,
        posX,
        posY,
        wordsPerLine,
        style: {
            fontFamily: fontName,
            highlightFontFamily: highlightFontName || undefined,
            fontSize: fontSize * 2.2, // Scale up for 1080p (modal fontSize is for small preview)
            fontColor,
            highlightColor,
            borderColor,
            borderWidth: borderWidth * 1.5,
            bgColor,
            bgOpacity,
            animation,
        },
    };

    // Fallback: static CSS preview
    const bw = Math.max(borderWidth, 0);
    const bc = borderColor;
    const outlineShadow = bw > 0
        ? [
            `${bw}px 0 0 ${bc}`, `-${bw}px 0 0 ${bc}`,
            `0 ${bw}px 0 ${bc}`, `0 -${bw}px 0 ${bc}`,
            `${bw}px ${bw}px 0 ${bc}`, `-${bw}px -${bw}px 0 ${bc}`,
            `${bw}px -${bw}px 0 ${bc}`, `-${bw}px ${bw}px 0 ${bc}`,
        ].join(', ')
        : 'none';

    const fallbackPreviewStyle = {
        fontFamily: fontName,
        color: fontColor,
        fontSize: '20px',
        fontWeight: 800,
        lineHeight: 1.15,
        maxWidth: '92%',
        padding: '6px 12px',
        borderRadius: '4px',
        textAlign: 'center',
        textTransform: animation === 'emphasis' ? 'uppercase' : undefined,
        letterSpacing: animation === 'emphasis' ? '0.01em' : undefined,
        ...(bgOpacity > 0
            ? {
                backgroundColor: `${bgColor}${Math.round(bgOpacity * 255).toString(16).padStart(2, '0')}`,
                textShadow: 'none',
            }
            : { textShadow: outlineShadow }
        ),
    };

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-[fadeIn_0.2s_ease-out]">
            <div className="bg-[#121214] border border-white/10 p-6 rounded-2xl w-full max-w-5xl shadow-2xl relative flex flex-col md:flex-row gap-6 max-h-[90vh]">
                <button
                    onClick={onClose}
                    className="absolute top-4 right-4 text-zinc-500 hover:text-white z-10"
                >
                    <X size={20} />
                </button>

                {/* Left: Preview */}
                <div className="flex-1 flex flex-col items-center justify-center bg-black rounded-lg border border-white/5 overflow-hidden relative aspect-[9/16] max-h-[600px]">
                    {captionsLoading ? (
                        <div className="flex items-center gap-2 text-zinc-400">
                            <Loader2 size={16} className="animate-spin" />
                            <span className="text-sm">Loading preview...</span>
                        </div>
                    ) : useRemotionPreview ? (
                        <SubtitlePreview
                            videoUrl={previewVideoUrl}
                            captions={captions}
                            config={subtitleConfig}
                            onPositionChange={(x, y) => { setPosX(x); setPosY(y); }}
                        />
                    ) : (
                        <>
                            <video src={previewVideoUrl} className="w-full h-full object-contain opacity-50" controls muted playsInline preload="auto" />
                            <div className={`absolute w-full px-8 text-center transition-all duration-300 pointer-events-none flex flex-col items-center justify-center
                                ${position === 'top' ? 'top-20' : ''}
                                ${position === 'middle' ? 'top-0 bottom-0' : ''}
                                ${position === 'bottom' ? 'bottom-20' : ''}
                            `}>
                                <span style={fallbackPreviewStyle}>
                                    This is how your subtitles<br/>will appear on the video
                                </span>
                            </div>
                        </>
                    )}
                </div>

                {/* Right: Controls */}
                <div className="w-full md:w-80 flex flex-col">
                    <h3 className="text-xl font-bold text-white mb-4 flex items-center gap-2 shrink-0">
                        <Type className="text-primary" /> Auto Subtitles
                    </h3>

                    <div className="space-y-5 flex-1 overflow-y-auto custom-scrollbar pr-1">
                        {/* Position Selector */}
                        <div>
                            <label className="text-xs font-bold text-zinc-400 uppercase tracking-wider mb-2 block">Position</label>
                            <div className="grid grid-cols-3 gap-2">
                                {['top', 'middle', 'bottom'].map((pos) => (
                                    <button
                                        key={pos}
                                        onClick={() => { setPosition(pos); setPosX(50); setPosY(PRESET_Y[pos]); }}
                                        className={`p-2 rounded-lg border text-center text-xs font-medium transition-all ${position === pos && posX === 50 && posY === PRESET_Y[pos] ? 'bg-primary/20 border-primary text-white' : 'bg-white/5 border-white/5 text-zinc-400 hover:bg-white/10'}`}
                                    >
                                        {pos.charAt(0).toUpperCase() + pos.slice(1)}
                                    </button>
                                ))}
                            </div>
                            <p className="text-[10px] text-zinc-500 mt-2">Drag the captions in the preview, or fine-tune below.</p>
                        </div>

                        {/* Fine position — X / Y axes */}
                        <div>
                            <label className="text-xs font-bold text-zinc-400 uppercase tracking-wider mb-2 block">Horizontal (X): {Math.round(posX)}%</label>
                            <input
                                type="range" min="0" max="100" step="1" value={posX}
                                onChange={(e) => setPosX(parseInt(e.target.value))}
                                className="w-full accent-primary"
                            />
                            <label className="text-xs font-bold text-zinc-400 uppercase tracking-wider mb-2 mt-3 block">Vertical (Y): {Math.round(posY)}%</label>
                            <input
                                type="range" min="0" max="100" step="1" value={posY}
                                onChange={(e) => setPosY(parseInt(e.target.value))}
                                className="w-full accent-primary"
                            />
                        </div>

                        {/* Animation Style (new) */}
                        <div>
                            <label className="text-xs font-bold text-zinc-400 uppercase tracking-wider mb-2 block">Animation</label>
                            <div className="grid grid-cols-2 gap-2">
                                {ANIMATION_OPTIONS.map((opt) => (
                                    <button
                                        key={opt.value}
                                        onClick={() => setAnimation(opt.value)}
                                        className={`p-2 rounded-lg border text-center text-xs font-medium transition-all ${animation === opt.value ? 'bg-primary/20 border-primary text-white' : 'bg-white/5 border-white/5 text-zinc-400 hover:bg-white/10'}`}
                                    >
                                        {opt.label}
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* Words per line */}
                        <div>
                            <label className="text-xs font-bold text-zinc-400 uppercase tracking-wider mb-2 block">Words per line</label>
                            <div className="flex gap-2">
                                {[2, 3, 4, 5].map((n) => (
                                    <button
                                        key={n}
                                        onClick={() => setWordsPerLine(n)}
                                        className={`flex-1 py-2 rounded-lg border text-center text-xs font-medium transition-all ${wordsPerLine === n ? 'bg-primary/20 border-primary text-white' : 'bg-white/5 border-white/5 text-zinc-400 hover:bg-white/10'}`}
                                    >
                                        {n}
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* Editable Transcript (collapsible) */}
                        {captions.length > 0 && (
                            <div>
                                <button
                                    type="button"
                                    onClick={() => setShowTextEditor(!showTextEditor)}
                                    className="w-full flex items-center justify-between text-xs font-bold text-zinc-400 uppercase tracking-wider mb-2"
                                >
                                    <span>Edit Text ({captions.length} words)</span>
                                    <span className={`transition-transform ${showTextEditor ? 'rotate-180' : ''}`}>▾</span>
                                </button>

                                {/* AI spell-fix — corrects transcription typos with a cheap Gemini model */}
                                <button
                                    type="button"
                                    onClick={handleFixSpelling}
                                    disabled={spellFixing}
                                    className="w-full flex items-center justify-center gap-2 py-2 mb-2 rounded-lg border border-violet-500/30 bg-violet-500/10 text-violet-300 hover:bg-violet-500/20 text-xs font-bold transition-all disabled:opacity-60"
                                >
                                    {spellFixing ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
                                    {spellFixing ? 'Fixing spelling...' : 'Fix Spelling with AI'}
                                </button>
                                {spellFixMsg && (
                                    <div className={`flex items-center gap-1.5 text-[11px] mb-2 ${spellFixMsg.ok ? 'text-green-400' : 'text-red-400'}`}>
                                        {spellFixMsg.ok ? <Check size={12} /> : null}
                                        <span>{spellFixMsg.text}</span>
                                    </div>
                                )}

                                {showTextEditor && (
                                    <div className="animate-[fadeIn_0.15s_ease-out]">
                                        {/* Mode toggle: per-word (precise timing) vs bulk text */}
                                        <div className="grid grid-cols-2 gap-2 mb-2">
                                            <button
                                                type="button"
                                                onClick={() => setEditMode('words')}
                                                className={`py-1.5 rounded-lg border text-center text-[11px] font-medium transition-all ${editMode === 'words' ? 'bg-primary/20 border-primary text-white' : 'bg-white/5 border-white/5 text-zinc-400 hover:bg-white/10'}`}
                                            >
                                                Per-word
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => setEditMode('bulk')}
                                                className={`py-1.5 rounded-lg border text-center text-[11px] font-medium transition-all ${editMode === 'bulk' ? 'bg-primary/20 border-primary text-white' : 'bg-white/5 border-white/5 text-zinc-400 hover:bg-white/10'}`}
                                            >
                                                Bulk text
                                            </button>
                                        </div>

                                        {editMode === 'words' ? (
                                            <>
                                                <p className="text-[10px] text-zinc-500 mb-2">Edit any word — its timing is preserved. Hover to delete. Type a space to split one word into two.</p>
                                                <div className="max-h-48 overflow-y-auto custom-scrollbar flex flex-wrap gap-1.5 p-2 bg-black/40 border border-white/10 rounded-lg">
                                                    {captions.map((cap, i) => (
                                                        <span key={i} className="relative group/word inline-flex items-center">
                                                            <input
                                                                value={cap.text}
                                                                onChange={(e) => handleWordChange(i, e.target.value)}
                                                                title={`${(cap.startMs / 1000).toFixed(2)}s – ${(cap.endMs / 1000).toFixed(2)}s`}
                                                                className="bg-white/5 border border-white/10 rounded px-1.5 py-1 text-sm text-white text-center focus:outline-none focus:border-primary transition-colors"
                                                                style={{ width: `${Math.max(cap.text.length + 1, 3)}ch` }}
                                                            />
                                                            <button
                                                                type="button"
                                                                onClick={() => handleWordDelete(i)}
                                                                title="Delete word"
                                                                className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-red-500/80 text-white items-center justify-center hidden group-hover/word:flex hover:bg-red-500"
                                                            >
                                                                <X size={10} />
                                                            </button>
                                                        </span>
                                                    ))}
                                                </div>
                                            </>
                                        ) : (
                                            <textarea
                                                value={editableText}
                                                onChange={(e) => handleTextEdit(e.target.value)}
                                                rows={5}
                                                className="w-full bg-black/40 border border-white/10 rounded-lg p-2.5 text-sm text-white focus:outline-none focus:border-primary/50 resize-none leading-relaxed"
                                                placeholder="Edit subtitle text..."
                                            />
                                        )}
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Font Family */}
                        <div>
                            <label className="text-xs font-bold text-zinc-400 uppercase tracking-wider mb-2 block">Primary Font</label>
                            <select
                                value={fontName}
                                onChange={(e) => setFontName(e.target.value)}
                                disabled={fontsLoading}
                                className="w-full bg-black/40 border border-white/10 rounded-lg p-2 text-sm text-white focus:outline-none focus:border-primary/50 disabled:opacity-50"
                            >
                                {fontsLoading && (
                                    <option value={fontName}>{fontName}</option>
                                )}
                                {systemFonts.map((f) => (
                                    <option key={`pri-${f.path || f.name}`} value={f.name} style={{ fontFamily: f.name }}>{f.name}</option>
                                ))}
                            </select>
                        </div>

                        {/* Highlight Font */}
                        <div>
                            <label className="text-xs font-bold text-zinc-400 uppercase tracking-wider mb-2 block">Highlight Word Font</label>
                            <select
                                value={highlightFontName}
                                onChange={(e) => setHighlightFontName(e.target.value)}
                                disabled={fontsLoading}
                                className="w-full bg-black/40 border border-white/10 rounded-lg p-2 text-sm text-white focus:outline-none focus:border-primary/50 disabled:opacity-50"
                            >
                                <option value="">Same as primary ({fontName})</option>
                                {fontsLoading && highlightFontName && (
                                    <option value={highlightFontName}>{highlightFontName}</option>
                                )}
                                {systemFonts.map((f) => (
                                    <option key={`hl-${f.path || f.name}`} value={f.name} style={{ fontFamily: f.name }}>{f.name}</option>
                                ))}
                            </select>
                            {highlightFontName && (
                                <button
                                    type="button"
                                    onClick={() => setHighlightFontName('')}
                                    className="mt-1 text-[10px] text-zinc-500 hover:text-white underline"
                                >
                                    Reset to same as primary
                                </button>
                            )}
                        </div>

                        {/* Font Size */}
                        <div>
                            <label className="text-xs font-bold text-zinc-400 uppercase tracking-wider mb-2 block">
                                Font Size: {fontSize}px
                            </label>
                            <div className="flex items-center gap-3">
                                <span className="text-[10px] text-zinc-500">14</span>
                                <input
                                    type="range"
                                    min="14"
                                    max="72"
                                    step="2"
                                    value={fontSize}
                                    onChange={(e) => setFontSize(parseInt(e.target.value))}
                                    className="w-full accent-primary"
                                />
                                <span className="text-[10px] text-zinc-500">72</span>
                            </div>
                            <div className="flex justify-between text-[10px] text-zinc-500 mt-1">
                                <span>Small</span>
                                <span>Large</span>
                            </div>
                        </div>

                        {/* Text Color */}
                        <div>
                            <label className="text-xs font-bold text-zinc-400 uppercase tracking-wider mb-2 block">Text Color</label>
                            <div className="flex flex-wrap gap-2">
                                {COLOR_PRESETS.map((c) => (
                                    <button
                                        key={c.color}
                                        onClick={() => setFontColor(c.color)}
                                        className={`w-7 h-7 rounded-full border-2 transition-all ${fontColor === c.color ? 'border-white scale-110' : 'border-white/20 hover:border-white/50'}`}
                                        style={{ backgroundColor: c.color }}
                                        title={c.label}
                                    />
                                ))}
                                <label className="w-7 h-7 rounded-full border-2 border-dashed border-white/20 cursor-pointer flex items-center justify-center hover:border-white/50 transition-all overflow-hidden relative" title="Custom color">
                                    <span className="text-[10px] text-zinc-400">+</span>
                                    <input type="color" value={fontColor} onChange={(e) => setFontColor(e.target.value)} className="absolute inset-0 opacity-0 cursor-pointer" />
                                </label>
                            </div>
                        </div>

                        {/* Highlight Color (new) */}
                        <div>
                            <label className="text-xs font-bold text-zinc-400 uppercase tracking-wider mb-2 block">Highlight Color</label>
                            <div className="flex flex-wrap gap-2">
                                {[{ color: '#FFDD00', label: 'Gold' }, { color: '#FF4444', label: 'Red' }, { color: '#00FF88', label: 'Green' }, { color: '#00BBFF', label: 'Blue' }, { color: '#FF69B4', label: 'Pink' }].map((c) => (
                                    <button
                                        key={c.color}
                                        onClick={() => setHighlightColor(c.color)}
                                        className={`w-7 h-7 rounded-full border-2 transition-all ${highlightColor.toUpperCase() === c.color ? 'border-white scale-110' : 'border-white/20 hover:border-white/50'}`}
                                        style={{ backgroundColor: c.color }}
                                        title={c.label}
                                    />
                                ))}
                                <label
                                    className="w-7 h-7 rounded-full border-2 border-dashed border-white/20 cursor-pointer flex items-center justify-center hover:border-white/50 transition-all overflow-hidden relative"
                                    title="Custom highlight color"
                                    style={{ backgroundColor: highlightColor }}
                                >
                                    <span className="text-[10px] text-white mix-blend-difference">+</span>
                                    <input
                                        type="color"
                                        value={highlightColor}
                                        onChange={(e) => setHighlightColor(e.target.value)}
                                        className="absolute inset-0 opacity-0 cursor-pointer"
                                    />
                                </label>
                            </div>
                        </div>

                        {/* Text Stroke / Outline */}
                        <div>
                            <div className="flex items-center justify-between mb-2">
                                <label className="text-xs font-bold text-zinc-400 uppercase tracking-wider">Text Stroke</label>
                                <label className="relative inline-flex items-center cursor-pointer" title="Toggle stroke / outline">
                                    <input
                                        type="checkbox"
                                        checked={borderWidth > 0}
                                        onChange={(e) => setBorderWidth(e.target.checked ? (borderWidth > 0 ? borderWidth : 2) : 0)}
                                        className="sr-only peer"
                                    />
                                    <div className="w-8 h-4 bg-zinc-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[0px] after:left-[0px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-primary"></div>
                                </label>
                            </div>
                            {borderWidth > 0 ? (
                                <div className="flex items-center gap-3 animate-[fadeIn_0.2s_ease-out]">
                                    <label className="relative w-8 h-8 rounded-lg border border-white/10 cursor-pointer overflow-hidden shrink-0" title="Stroke color">
                                        <div className="w-full h-full" style={{ backgroundColor: borderColor }} />
                                        <input type="color" value={borderColor} onChange={(e) => setBorderColor(e.target.value)} className="absolute inset-0 opacity-0 cursor-pointer" />
                                    </label>
                                    <div className="flex-1">
                                        <input
                                            type="range"
                                            min="1"
                                            max="8"
                                            value={borderWidth}
                                            onChange={(e) => setBorderWidth(parseInt(e.target.value))}
                                            className="w-full accent-primary"
                                        />
                                        <div className="flex justify-between text-[10px] text-zinc-500">
                                            <span>Thin</span>
                                            <span>Thick: {borderWidth}px</span>
                                        </div>
                                    </div>
                                </div>
                            ) : (
                                <p className="text-[10px] text-zinc-500">Stroke off — text has no outline.</p>
                            )}
                        </div>

                        {/* Background Box */}
                        <div>
                            <div className="flex items-center justify-between mb-2">
                                <label className="text-xs font-bold text-zinc-400 uppercase tracking-wider">Background Box</label>
                                <label className="relative inline-flex items-center cursor-pointer">
                                    <input type="checkbox" checked={bgOpacity > 0} onChange={(e) => setBgOpacity(e.target.checked ? 0.5 : 0)} className="sr-only peer" />
                                    <div className="w-8 h-4 bg-zinc-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[0px] after:left-[0px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-primary"></div>
                                </label>
                            </div>
                            {bgOpacity > 0 && (
                                <div className="space-y-3 animate-[fadeIn_0.2s_ease-out]">
                                    <div className="flex items-center gap-3">
                                        <label className="relative w-8 h-8 rounded-lg border border-white/10 cursor-pointer overflow-hidden shrink-0" title="Background color">
                                            <div className="w-full h-full" style={{ backgroundColor: bgColor }} />
                                            <input type="color" value={bgColor} onChange={(e) => setBgColor(e.target.value)} className="absolute inset-0 opacity-0 cursor-pointer" />
                                        </label>
                                        <div className="flex-1">
                                            <input
                                                type="range"
                                                min="10"
                                                max="100"
                                                value={Math.round(bgOpacity * 100)}
                                                onChange={(e) => setBgOpacity(parseInt(e.target.value) / 100)}
                                                className="w-full accent-primary"
                                            />
                                            <div className="flex justify-between text-[10px] text-zinc-500">
                                                <span>Transparent</span>
                                                <span>{Math.round(bgOpacity * 100)}%</span>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>

                    <button
                        onClick={() => {
                            savePrefs({
                                position, posX, posY, fontSize, fontName, highlightFontName, fontColor, highlightColor,
                                borderColor, borderWidth, bgColor, bgOpacity, animation, wordsPerLine,
                            });
                            onGenerate({
                                position, fontSize, fontName, highlightFontName, fontColor, borderColor, borderWidth, bgColor, bgOpacity,
                                max_words: wordsPerLine,
                                // Remotion data
                                remotion: useRemotionPreview ? subtitleConfig : null,
                            });
                        }}
                        disabled={isProcessing}
                        className="w-full py-3 mt-4 bg-gradient-to-r from-yellow-500 to-orange-500 hover:from-yellow-400 hover:to-orange-400 text-black font-bold rounded-xl shadow-lg shadow-orange-500/20 transition-all active:scale-[0.98] flex items-center justify-center gap-2 shrink-0"
                    >
                        {isProcessing ? <Loader2 size={20} className="animate-spin" /> : <Type size={20} />}
                        {isProcessing ? 'Generating...' : 'Generate Subtitles'}
                    </button>
                </div>
            </div>
        </div>
    );
}
