import React, { useState } from 'react';
import { Youtube, Upload, FileVideo, X, Wand2, Scissors, FileText } from 'lucide-react';

export default function MediaInput({ onProcess, isProcessing }) {
    const [mode, setMode] = useState('url'); // 'url' | 'file'
    const [url, setUrl] = useState('');
    const [file, setFile] = useState(null);
    const [cleanVideo, setCleanVideo] = useState(false); // Remove filler words
    const [singleReel, setSingleReel] = useState(false); // Create single polished reel
    const [targetDuration, setTargetDuration] = useState(60); // Target reel duration
    const [numClips, setNumClips] = useState(5); // Number of clips to generate
    const [script, setScript] = useState(''); // Optional reference script
    const [showScript, setShowScript] = useState(false);

    const handleSubmit = (e) => {
        e.preventDefault();
        const common = {
            cleanVideo,
            singleReel,
            targetDuration: singleReel ? targetDuration : null,
            numClips: singleReel ? null : numClips,
            script: script.trim() || null,
        };
        if (mode === 'url' && url) {
            onProcess({ type: 'url', payload: url, ...common });
        } else if (mode === 'file' && file) {
            onProcess({ type: 'file', payload: file, ...common });
        }
    };

    const handleScriptFile = async (e) => {
        const f = e.target.files?.[0];
        if (!f) return;
        try {
            const text = await f.text();
            setScript(text);
        } catch (err) {
            console.error('Failed to read script file', err);
        }
    };

    const handleDrop = (e) => {
        e.preventDefault();
        if (e.dataTransfer.files && e.dataTransfer.files[0]) {
            setFile(e.dataTransfer.files[0]);
            setMode('file');
        }
    };

    return (
        <div className="bg-surface border border-white/5 rounded-2xl p-6 animate-[fadeIn_0.6s_ease-out]">
            <div className="flex gap-4 mb-6 border-b border-white/5 pb-4">
                <button
                    onClick={() => setMode('url')}
                    className={`flex items-center gap-2 pb-2 px-2 transition-all ${mode === 'url'
                        ? 'text-primary border-b-2 border-primary -mb-[17px]'
                        : 'text-zinc-400 hover:text-white'
                        }`}
                >
                    <Youtube size={18} />
                    YouTube URL
                </button>
                <button
                    onClick={() => setMode('file')}
                    className={`flex items-center gap-2 pb-2 px-2 transition-all ${mode === 'file'
                        ? 'text-primary border-b-2 border-primary -mb-[17px]'
                        : 'text-zinc-400 hover:text-white'
                        }`}
                >
                    <Upload size={18} />
                    Upload File
                </button>
            </div>

            <form onSubmit={handleSubmit}>
                {mode === 'url' ? (
                    <div className="space-y-4">
                        <input
                            type="url"
                            value={url}
                            onChange={(e) => setUrl(e.target.value)}
                            placeholder="https://www.youtube.com/watch?v=..."
                            className="input-field"
                            required
                        />
                    </div>
                ) : (
                    <div
                        className={`border-2 border-dashed rounded-xl p-8 text-center transition-all ${file ? 'border-primary/50 bg-primary/5' : 'border-zinc-700 hover:border-zinc-500 bg-white/5'
                            }`}
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={handleDrop}
                    >
                        {file ? (
                            <div className="flex items-center justify-center gap-3 text-white">
                                <FileVideo className="text-primary" />
                                <span className="font-medium">{file.name}</span>
                                <button
                                    type="button"
                                    onClick={() => setFile(null)}
                                    className="p-1 hover:bg-white/10 rounded-full"
                                >
                                    <X size={16} />
                                </button>
                            </div>
                        ) : (
                            <label className="cursor-pointer block">
                                <input
                                    type="file"
                                    accept="video/*"
                                    onChange={(e) => setFile(e.target.files?.[0] || null)}
                                    className="hidden"
                                />
                                <Upload className="mx-auto mb-3 text-zinc-500" size={24} />
                                <p className="text-zinc-400">Click to upload or drag and drop</p>
                                <p className="text-xs text-zinc-600 mt-1">MP4, MOV up to 500MB</p>
                            </label>
                        )}
                    </div>
                )}

                {/* Mode Selection */}
                <div className="mt-4 space-y-3">
                    {/* Single Reel Mode */}
                    <div className="p-3 bg-gradient-to-r from-violet-500/10 to-purple-500/10 border border-violet-500/30 rounded-lg">
                        <label className="flex items-start gap-3 cursor-pointer">
                            <input
                                type="checkbox"
                                checked={singleReel}
                                onChange={(e) => setSingleReel(e.target.checked)}
                                className="mt-1 accent-violet-500"
                            />
                            <div className="text-sm flex-1">
                                <div className="flex items-center gap-2 text-white font-medium">
                                    <Scissors size={14} className="text-violet-400" />
                                    Create Single Polished Reel
                                </div>
                                <p className="text-xs text-zinc-400 mt-1">
                                    Perfect for 4-5 min raw recordings. Removes filler words, pauses, repeated sentences, and improves face framing. Outputs one flawless reel.
                                </p>

                                {singleReel && (
                                    <div className="mt-3 pt-3 border-t border-white/10">
                                        <label className="block text-xs text-zinc-300 mb-2">
                                            Target Duration: <span className="text-violet-400 font-mono">{targetDuration}s</span>
                                        </label>
                                        <input
                                            type="range"
                                            min="15"
                                            max="180"
                                            step="5"
                                            value={targetDuration}
                                            onChange={(e) => setTargetDuration(Number(e.target.value))}
                                            className="w-full accent-violet-500"
                                        />
                                        <div className="flex justify-between text-[10px] text-zinc-500 mt-1">
                                            <span>15s</span>
                                            <span>60s</span>
                                            <span>120s</span>
                                            <span>180s</span>
                                        </div>
                                        <p className="text-[10px] text-zinc-500 mt-2">
                                            Smart content selection to fit your target duration while keeping the best parts.
                                        </p>
                                    </div>
                                )}
                            </div>
                        </label>
                    </div>

                    {/* Optional Reference Script */}
                    <div className="p-3 bg-white/5 border border-white/10 rounded-lg">
                        <button
                            type="button"
                            onClick={() => setShowScript(s => !s)}
                            className="w-full flex items-center justify-between text-left"
                        >
                            <div className="flex items-center gap-2 text-white font-medium text-sm">
                                <FileText size={14} className="text-primary" />
                                Reference Script <span className="text-xs text-zinc-500 font-normal">(optional)</span>
                                {script.trim() && (
                                    <span className="text-[10px] text-emerald-400 font-mono">
                                        · {script.trim().length} chars
                                    </span>
                                )}
                            </div>
                            <span className="text-xs text-zinc-400">{showScript ? 'Hide' : 'Add'}</span>
                        </button>
                        <p className="text-xs text-zinc-400 mt-1">
                            Paste the script you intended to deliver. The AI will align the actual transcript to it — picking the best take of each line and dropping flubs / restarts / off-script tangents.
                        </p>
                        {showScript && (
                            <div className="mt-3 space-y-2">
                                <textarea
                                    value={script}
                                    onChange={(e) => setScript(e.target.value)}
                                    placeholder={"Paste your script here...\n\nExample:\n5 mistakes new founders make.\n1. Building before talking to customers.\n2. ..."}
                                    rows={6}
                                    className="input-field w-full text-sm font-mono leading-relaxed resize-y"
                                />
                                <div className="flex items-center justify-between">
                                    <label className="text-xs text-zinc-400 cursor-pointer hover:text-white inline-flex items-center gap-1">
                                        <Upload size={12} />
                                        <span>Load from .txt file</span>
                                        <input
                                            type="file"
                                            accept=".txt,.md,text/plain"
                                            onChange={handleScriptFile}
                                            className="hidden"
                                        />
                                    </label>
                                    {script && (
                                        <button
                                            type="button"
                                            onClick={() => setScript('')}
                                            className="text-xs text-zinc-500 hover:text-red-400"
                                        >
                                            Clear
                                        </button>
                                    )}
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Number of Clips */}
                    <div className={`p-3 bg-white/5 border border-white/10 rounded-lg ${singleReel ? 'opacity-50 pointer-events-none' : ''}`}>
                        <div className="text-sm">
                            <div className="flex items-center gap-2 text-white font-medium mb-2">
                                <Scissors size={14} className="text-primary" />
                                Number of Clips: <span className="text-primary font-mono">{numClips}</span>
                            </div>
                            <input
                                type="range"
                                min="1"
                                max="15"
                                step="1"
                                value={numClips}
                                onChange={(e) => setNumClips(Number(e.target.value))}
                                className="w-full accent-primary"
                                disabled={singleReel}
                            />
                            <div className="flex justify-between text-[10px] text-zinc-500 mt-1">
                                <span>1</span>
                                <span>5</span>
                                <span>10</span>
                                <span>15</span>
                            </div>
                            <p className="text-xs text-zinc-400 mt-2">
                                Choose how many viral moments the AI should extract from your video.
                            </p>
                        </div>
                    </div>

                    {/* Clean Video Option (for clip generation) */}
                    <div className="p-3 bg-white/5 border border-white/10 rounded-lg">
                        <label className="flex items-start gap-3 cursor-pointer">
                            <input
                                type="checkbox"
                                checked={cleanVideo}
                                onChange={(e) => setCleanVideo(e.target.checked)}
                                disabled={singleReel}
                                className="mt-1 accent-primary disabled:opacity-50"
                            />
                            <div className="text-sm">
                                <div className="flex items-center gap-2 text-white font-medium">
                                    <Wand2 size={14} className="text-primary" />
                                    Clean before generating clips
                                </div>
                                <p className="text-xs text-zinc-400 mt-1">
                                    Remove filler words and pauses before extracting viral clips (multiple outputs).
                                </p>
                            </div>
                        </label>
                    </div>
                </div>

                <button
                    type="submit"
                    disabled={isProcessing || (mode === 'url' && !url) || (mode === 'file' && !file)}
                    className="w-full btn-primary mt-4 flex items-center justify-center gap-2"
                >
                    {isProcessing ? (
                        <>
                            <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                            Processing Video...
                        </>
                    ) : (
                        <>
                            Generate Clips
                        </>
                    )}
                </button>
            </form>
        </div>
    );
}
