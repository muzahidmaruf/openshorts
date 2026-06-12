import React, { useState } from 'react';
import { X, Download, Loader2, Film } from 'lucide-react';
import { getApiUrl } from '../config';

const RESOLUTIONS = [
    { label: 'Original', height: null, desc: 'Source quality' },
    { label: '1080p', height: 1920, desc: 'Full HD · ~10-15 MB' },
    { label: '720p', height: 1280, desc: 'HD · ~6-10 MB' },
    { label: '540p', height: 960, desc: 'SD · ~3-5 MB' },
    { label: '480p', height: 854, desc: 'Low · ~2-4 MB' },
];

export default function DownloadModal({ isOpen, onClose, videoUrl, filename }) {
    const [selected, setSelected] = useState(RESOLUTIONS[0]);
    const [isDownloading, setIsDownloading] = useState(false);

    if (!isOpen) return null;

    const handleDownload = async () => {
        setIsDownloading(true);
        try {
            // If original, fetch directly
            if (!selected.height) {
                const response = await fetch(videoUrl);
                if (!response.ok) throw new Error('Download failed');
                const blob = await response.blob();
                const url = window.URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.style.display = 'none';
                a.href = url;
                a.download = filename;
                document.body.appendChild(a);
                a.click();
                window.URL.revokeObjectURL(url);
                document.body.removeChild(a);
                onClose();
                return;
            }

            // Request transcoded version from backend
            const res = await fetch(getApiUrl('/api/download'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    video_path: videoUrl.replace(getApiUrl(''), ''),
                    resolution: selected.height,
                }),
            });

            if (!res.ok) {
                const err = await res.json().catch(() => ({ detail: 'Download failed' }));
                throw new Error(err.detail || 'Download failed');
            }

            const blob = await res.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.style.display = 'none';
            a.href = url;
            a.download = filename.replace('.mp4', `_${selected.label}.mp4`);
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(url);
            document.body.removeChild(a);
            onClose();
        } catch (err) {
            console.error('Download error:', err);
            alert(err.message || 'Download failed');
        } finally {
            setIsDownloading(false);
        }
    };

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-[fadeIn_0.2s_ease-out]">
            <div className="bg-[#121214] border border-white/10 p-6 rounded-2xl w-full max-w-md shadow-2xl relative">
                <button
                    onClick={onClose}
                    className="absolute top-4 right-4 text-zinc-500 hover:text-white"
                >
                    <X size={20} />
                </button>

                <h3 className="text-xl font-bold text-white mb-1 flex items-center gap-2">
                    <Film className="text-primary" /> Download Video
                </h3>
                <p className="text-xs text-zinc-400 mb-5">
                    Choose a resolution. Lower resolutions are smaller and upload faster.
                </p>

                <div className="space-y-2 mb-6">
                    {RESOLUTIONS.map((res) => (
                        <button
                            key={res.label}
                            onClick={() => setSelected(res)}
                            disabled={isDownloading}
                            className={`w-full flex items-center justify-between p-3 rounded-xl border text-left transition-all ${
                                selected.label === res.label
                                    ? 'bg-primary/20 border-primary text-white'
                                    : 'bg-white/5 border-white/5 text-zinc-300 hover:bg-white/10'
                            }`}
                        >
                            <div className="flex items-center gap-3">
                                <div
                                    className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${
                                        selected.label === res.label
                                            ? 'border-primary'
                                            : 'border-zinc-500'
                                    }`}
                                >
                                    {selected.label === res.label && (
                                        <div className="w-2 h-2 rounded-full bg-primary" />
                                    )}
                                </div>
                                <div>
                                    <div className="text-sm font-bold">{res.label}</div>
                                    <div className="text-[10px] text-zinc-500">{res.desc}</div>
                                </div>
                            </div>
                            {res.height && (
                                <span className="text-[10px] text-zinc-500 font-mono">
                                    {Math.round(res.height * 9 / 16)}×{res.height}
                                </span>
                            )}
                        </button>
                    ))}
                </div>

                <button
                    onClick={handleDownload}
                    disabled={isDownloading}
                    className="w-full py-3 bg-gradient-to-r from-yellow-500 to-orange-500 hover:from-yellow-400 hover:to-orange-400 text-black font-bold rounded-xl shadow-lg shadow-orange-500/20 transition-all active:scale-[0.98] flex items-center justify-center gap-2"
                >
                    {isDownloading ? (
                        <Loader2 size={20} className="animate-spin" />
                    ) : (
                        <Download size={20} />
                    )}
                    {isDownloading ? 'Processing...' : `Download ${selected.label}`}
                </button>
            </div>
        </div>
    );
}
