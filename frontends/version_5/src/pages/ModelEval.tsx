import React, { useState, useRef } from 'react';

interface EvalResult {
  model: string;
  old_count: number;
  old_dets: number;
  new_count: number;
  new_dets: number;
  diff: number;
}

export default function ModelEval() {
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [linePosition, setLinePosition] = useState<number>(0.5);
  const [loading, setLoading] = useState<boolean>(false);
  const [results, setResults] = useState<EvalResult[] | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const selected = e.target.files[0];
      setFile(selected);
      setPreviewUrl(URL.createObjectURL(selected));
      setResults(null);
    }
  };

  const handleEvaluate = async () => {
    if (!file) return;
    setLoading(true);
    setResults(null);

    const formData = new FormData();
    formData.append('file', file);
    formData.append('line_position', linePosition.toString());
    formData.append('confidence', '0.4');
    formData.append('fps', '10');

    try {
      const res = await fetch('/api/video/eval_all', {
        method: 'POST',
        body: formData,
      });
      const data = await res.json();
      if (data.results) {
        setResults(data.results);
      } else {
        alert(data.error || 'Evaluation failed');
      }
    } catch (err) {
      console.error(err);
      alert('Error during evaluation request');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 shadow-xl text-white">
        <h1 className="text-2xl font-bold mb-2">Model & Method Evaluator</h1>
        <p className="text-slate-400 text-sm mb-6">
          Upload a video, set your crossing line, and evaluate all 5 models against both Old (Centroid) & New (Enhanced + Hungarian) tracking methods.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Upload & Controls */}
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">Select Video</label>
              <input
                type="file"
                accept="video/*"
                onChange={handleFileChange}
                className="w-full text-sm text-slate-400 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-blue-600 file:text-white hover:file:bg-blue-500 cursor-pointer"
              />
            </div>

            <div>
              <div className="flex justify-between items-center mb-1">
                <label className="text-sm font-medium text-slate-300">Line Position</label>
                <span className="text-sm font-mono text-blue-400">{Math.round(linePosition * 100)}%</span>
              </div>
              <input
                type="range"
                min="0.1"
                max="0.9"
                step="0.05"
                value={linePosition}
                onChange={(e) => setLinePosition(parseFloat(e.target.value))}
                className="w-full h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-blue-500"
              />
            </div>

            <button
              onClick={handleEvaluate}
              disabled={!file || loading}
              className="w-full py-3 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed font-semibold rounded-lg shadow transition duration-200"
            >
              {loading ? 'Evaluating All Models (takes ~30-60s)...' : 'Run Full Evaluation'}
            </button>
          </div>

          {/* Video Preview with Overlay Line */}
          <div className="relative bg-black rounded-lg overflow-hidden flex items-center justify-center border border-slate-700 min-h-[220px]">
            {previewUrl ? (
              <div className="relative w-full h-full">
                <video
                  ref={videoRef}
                  src={previewUrl}
                  controls
                  className="w-full h-auto max-h-[300px] object-contain"
                />
                {/* Vertical Line Indicator Overlay */}
                <div
                  className="absolute top-0 bottom-0 w-0.5 bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.8)] pointer-events-none"
                  style={{ left: `${linePosition * 100}%` }}
                >
                  <span className="absolute top-2 left-2 bg-red-600 text-white text-[10px] font-bold px-1.5 py-0.5 rounded">
                    LINE
                  </span>
                </div>
              </div>
            ) : (
              <span className="text-slate-500 text-sm">Upload video to preview & set line</span>
            )}
          </div>
        </div>
      </div>

      {/* Results Table */}
      {results && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 shadow-xl text-white">
          <h2 className="text-lg font-bold mb-4">Evaluation Results</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm border-collapse">
              <thead>
                <tr className="border-b border-slate-800 text-slate-400 bg-slate-950/50">
                  <th className="p-3">Model</th>
                  <th className="p-3 text-center">OLD Count</th>
                  <th className="p-3 text-center">OLD Dets</th>
                  <th className="p-3 text-center">NEW Count</th>
                  <th className="p-3 text-center">NEW Dets</th>
                  <th className="p-3 text-center">Count Delta</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {results.map((r, i) => (
                  <tr key={i} className="hover:bg-slate-800/40">
                    <td className="p-3 font-mono font-medium text-blue-300">{r.model}</td>
                    <td className="p-3 text-center font-bold text-amber-400">{r.old_count}</td>
                    <td className="p-3 text-center text-slate-400">{r.old_dets}</td>
                    <td className="p-3 text-center font-bold text-emerald-400">{r.new_count}</td>
                    <td className="p-3 text-center text-slate-400">{r.new_dets}</td>
                    <td className="p-3 text-center font-mono">
                      <span className={`px-2 py-0.5 rounded text-xs font-bold ${r.diff === 0 ? 'bg-slate-800 text-slate-300' : r.diff < 0 ? 'bg-red-950 text-red-400' : 'bg-emerald-950 text-emerald-400'}`}>
                        {r.diff > 0 ? `+${r.diff}` : r.diff}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
