
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { GoogleGenAI, Type } from "@google/genai";
import { 
  Upload, FileType, Download, CheckCircle2, AlertCircle, 
  Loader2, Plus, Trash2, GripVertical, ArrowDown, 
  FileText, Hash, Type as TypeIcon, X, Info, LayoutTemplate,
  Database, HelpCircle, ChevronRight, Share2, Settings, DownloadCloud, UploadCloud
} from 'lucide-react';

// --- Types ---

type FieldSourceType = 'csv_column' | 'constant' | 'filename' | 'smart_answer';

interface ExportField {
  id: string;
  headerName: string;
  type: FieldSourceType;
  sourceValue: string | number; 
  answerConfig?: {
    sourceKeyIdx: number | string; 
    outputMode: 'key' | 'content'; 
    optionIndices: (number | string)[]; 
  };
}

// --- Utility Functions ---

const parseCSV = (text: string): string[][] => {
  if (!text) return [];
  const result: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const nextChar = text[i + 1];
    if (inQuotes && char === '"' && nextChar === '"') { cell += '"'; i++; }
    else if (char === '"') { inQuotes = !inQuotes; }
    else if (!inQuotes && char === ',') { row.push(cell.trim()); cell = ''; }
    else if (!inQuotes && (char === '\n' || char === '\r')) {
      if (char === '\r' && nextChar === '\n') i++;
      row.push(cell.trim());
      if (row.length > 0 || cell !== '') result.push(row);
      row = []; cell = '';
    } else { cell += char; }
  }
  if (cell || row.length > 0) { row.push(cell.trim()); result.push(row); }
  return result.filter(r => r.length > 0 && r.some(c => c !== ''));
};

const processSmartAnswer = (row: string[], config: ExportField['answerConfig']): string => {
  if (!config || config.sourceKeyIdx === '') return '';
  const rawKey = String(row[Number(config.sourceKeyIdx)] || '').trim();
  const key = rawKey.toUpperCase().replace(/[Ａ-Ｚ０-９]/g, (s) => String.fromCharCode(s.charCodeAt(0) - 0xFEE0));
  if (config.outputMode === 'key') return key;
  let targetIdx = -1;
  if (/^[A-Z]$/.test(key)) targetIdx = key.charCodeAt(0) - 65;
  else if (/^[1-9]$/.test(key)) targetIdx = parseInt(key) - 1;
  if (targetIdx >= 0 && targetIdx < config.optionIndices.length) {
    const colIdx = config.optionIndices[targetIdx];
    if (colIdx !== '') return row[Number(colIdx)] || '';
  }
  return rawKey;
};

const generateCSV = (config: ExportField[], sourceData: string[][], filename: string): string => {
  const headers = config.map(f => f.headerName);
  const csvRows = [headers.join(',')];
  sourceData.slice(1).forEach(row => {
    const outputRow = config.map(field => {
      let val = '';
      if (field.type === 'filename') val = filename;
      else if (field.type === 'constant') val = String(field.sourceValue);
      else if (field.type === 'csv_column') val = row[Number(field.sourceValue)] || '';
      else if (field.type === 'smart_answer') val = processSmartAnswer(row, field.answerConfig);
      return `"${val.replace(/"/g, '""')}"`;
    });
    csvRows.push(outputRow.join(','));
  });
  return csvRows.join('\n');
};

const downloadFile = (content: string, fileName: string, mimeType: string) => {
  const blob = new Blob([mimeType.includes('csv') ? "\uFEFF" + content : content], { type: `${mimeType};charset=utf-8;` });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.setAttribute("href", url);
  link.setAttribute("download", fileName);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
};

function ExamFactory() {
  const [file, setFile] = useState<File | null>(null);
  const [fileBuffer, setFileBuffer] = useState<ArrayBuffer | null>(null);
  const [encoding, setEncoding] = useState<'utf-8' | 'big5'>('utf-8');
  const [originalData, setOriginalData] = useState<string[][]>([]);
  const [exportConfig, setExportConfig] = useState<ExportField[]>([]);
  const [isSuggesting, setIsSuggesting] = useState(false);
  const [draggedItemIndex, setDraggedItemIndex] = useState<number | null>(null);

  const headers = useMemo(() => originalData[0] || [], [originalData]);

  useEffect(() => {
    if (fileBuffer) {
      try {
        const text = new TextDecoder(encoding).decode(fileBuffer);
        const parsed = parseCSV(text);
        setOriginalData(parsed);
        if (parsed.length > 0 && exportConfig.length === 0) autoSuggest(parsed[0]);
      } catch (e) { alert("編碼錯誤，請嘗試切換格式"); }
    }
  }, [fileBuffer, encoding]);

  const autoSuggest = async (sourceHeaders: string[]) => {
    setIsSuggesting(true);
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: `欄位：${sourceHeaders.join(', ')}。請識別題目(question)、選項1-4(option1-4)、答案(answer)的索引(0-based)。`,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              question: { type: Type.INTEGER, nullable: true },
              option1: { type: Type.INTEGER, nullable: true },
              option2: { type: Type.INTEGER, nullable: true },
              option3: { type: Type.INTEGER, nullable: true },
              option4: { type: Type.INTEGER, nullable: true },
              answer: { type: Type.INTEGER, nullable: true },
            }
          }
        }
      });
      const mapping = JSON.parse(response.text);
      const fields: ExportField[] = [
        { id: 'f_name', headerName: '來源檔名', type: 'filename', sourceValue: '' },
        { id: 'f_q', headerName: '題目內容', type: 'csv_column', sourceValue: mapping.question ?? '' },
        { id: 'f_o1', headerName: '選項1', type: 'csv_column', sourceValue: mapping.option1 ?? '' },
        { id: 'f_o2', headerName: '選項2', type: 'csv_column', sourceValue: mapping.option2 ?? '' },
        { id: 'f_o3', headerName: '選項3', type: 'csv_column', sourceValue: mapping.option3 ?? '' },
        { id: 'f_o4', headerName: '選項4', type: 'csv_column', sourceValue: mapping.option4 ?? '' },
        { 
          id: 'f_ans', 
          headerName: '正確答案文字', 
          type: 'smart_answer', 
          sourceValue: '',
          answerConfig: {
            sourceKeyIdx: mapping.answer ?? '',
            outputMode: 'content',
            optionIndices: [mapping.option1 ?? '', mapping.option2 ?? '', mapping.option3 ?? '', mapping.option4 ?? '']
          }
        }
      ];
      setExportConfig(fields);
    } catch (e) {
      setExportConfig([{ id: 'f_err', headerName: '題目', type: 'csv_column', sourceValue: 0 }]);
    } finally { setIsSuggesting(false); }
  };

  const addField = (type: FieldSourceType, value: any = '', label = '新欄位') => {
    const field: ExportField = {
      id: Math.random().toString(36).substr(2, 9),
      headerName: label,
      type,
      sourceValue: value,
      ...(type === 'smart_answer' ? { answerConfig: { sourceKeyIdx: '', outputMode: 'content', optionIndices: ['', '', '', ''] } } : {})
    };
    setExportConfig([...exportConfig, field]);
  };

  const updateField = (id: string, updates: Partial<ExportField>) => {
    setExportConfig(exportConfig.map(f => f.id === id ? { ...f, ...updates } : f));
  };

  const exportCurrentConfig = () => {
    const configData = JSON.stringify(exportConfig, null, 2);
    downloadFile(configData, "題庫轉換設定檔.json", "application/json");
  };

  const importConfig = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const imported = JSON.parse(ev.target?.result as string);
        setExportConfig(imported);
      } catch (e) { alert("無效的設定檔格式"); }
    };
    reader.readAsText(file);
  };

  // Drag handlers
  const onDragStart = (index: number) => setDraggedItemIndex(index);
  const onDragEnter = (index: number) => {
    if (draggedItemIndex === null || draggedItemIndex === index) return;
    const newConfig = [...exportConfig];
    const itemToMove = newConfig[draggedItemIndex];
    newConfig.splice(draggedItemIndex, 1);
    newConfig.splice(index, 0, itemToMove);
    setDraggedItemIndex(index);
    setExportConfig(newConfig);
  };
  const onDragEnd = () => setDraggedItemIndex(null);
  const onDragOver = (e: React.DragEvent) => e.preventDefault();

  return (
    <div className="min-h-screen bg-[#F8FAFC] flex flex-col font-sans text-slate-900 selection:bg-indigo-100">
      <header className="bg-white border-b border-slate-200 px-10 py-6 flex items-center justify-between sticky top-0 z-50 shadow-sm">
        <div className="flex items-center gap-5">
          <div className="bg-gradient-to-br from-indigo-600 to-violet-700 p-4 rounded-[1.25rem] text-white shadow-xl shadow-indigo-100"><LayoutTemplate size={28} /></div>
          <div>
            <h1 className="text-2xl font-black tracking-tight text-slate-800">題庫格式加工廠 <span className="text-indigo-600 bg-indigo-50 px-3 py-1 rounded-xl text-sm ml-2">PRO</span></h1>
            <p className="text-xs text-slate-400 font-bold uppercase tracking-[0.2em] mt-1">Advanced Data Mapper & Answer Transformer</p>
          </div>
        </div>
        
        {file && (
          <div className="flex items-center gap-6">
             <div className="flex bg-slate-100 p-2 rounded-2xl border border-slate-200">
              {(['utf-8', 'big5'] as const).map(enc => (
                <button key={enc} onClick={() => setEncoding(enc)} className={`px-6 py-2.5 rounded-xl text-xs font-black uppercase transition-all ${encoding === enc ? 'bg-white shadow-sm text-indigo-600' : 'text-slate-400 hover:text-slate-600'}`}>{enc}</button>
              ))}
            </div>
            <button 
              onClick={() => downloadFile(generateCSV(exportConfig, originalData, file.name), `加工成品_${file.name}`, "text/csv")}
              className="bg-indigo-600 hover:bg-indigo-700 text-white px-10 py-4 rounded-[1.25rem] text-base font-black shadow-2xl shadow-indigo-100 flex items-center gap-3 active:scale-95 transition-all"
            >
              <Download size={22} /> 下載 CSV 成品
            </button>
          </div>
        )}
      </header>

      <main className="flex-1 grid grid-cols-1 lg:grid-cols-12 overflow-hidden">
        {/* Step 1 & 2: Sources Panel */}
        <aside className="lg:col-span-3 bg-white border-r border-slate-200 p-8 overflow-y-auto">
          <div className="mb-12">
            <h2 className="text-xs font-black text-slate-400 uppercase tracking-widest mb-6 flex items-center gap-3">
              <Database size={16} /> 1. 資料源與工具
            </h2>
            {!file ? (
              <div className="relative group border-2 border-dashed border-slate-200 rounded-[2.5rem] p-12 text-center hover:border-indigo-400 hover:bg-indigo-50/50 transition-all cursor-pointer">
                <input type="file" accept=".csv" onChange={(e) => {
                  const f = e.target.files?.[0];
                  if(f) { setFile(f); const r = new FileReader(); r.onload = (ev) => setFileBuffer(ev.target?.result as ArrayBuffer); r.readAsArrayBuffer(f); }
                }} className="absolute inset-0 opacity-0 cursor-pointer" />
                <div className="bg-slate-50 w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-6 group-hover:scale-110 transition-transform shadow-sm"><Upload className="text-slate-300 group-hover:text-indigo-500" size={36} /></div>
                <p className="text-sm font-black text-slate-600">上傳來源題庫 CSV</p>
                <p className="text-xs text-slate-400 mt-3 font-medium">支援各類編碼與分隔符號</p>
              </div>
            ) : (
              <div className="p-6 bg-indigo-50/50 rounded-[1.5rem] border border-indigo-100 flex items-center justify-between group shadow-sm">
                <div className="truncate pr-4">
                  <p className="text-sm font-black text-indigo-900 truncate">{file.name}</p>
                  <p className="text-xs text-indigo-400 font-bold uppercase mt-1 tracking-wider">{originalData.length - 1} 筆試題已載入</p>
                </div>
                <button onClick={() => {setFile(null); setOriginalData([]); setExportConfig([]);}} className="text-indigo-300 hover:text-red-500 p-2.5 hover:bg-white rounded-xl transition-all"><X size={20} /></button>
              </div>
            )}
          </div>

          <div className="mb-12 space-y-4">
            <p className="text-xs font-black text-slate-300 uppercase tracking-widest px-2 mb-4">設定檔管理（分享使用）</p>
            <div className="grid grid-cols-2 gap-3">
              <button onClick={exportCurrentConfig} className="flex flex-col items-center justify-center gap-2 p-5 bg-violet-50 text-violet-700 rounded-2xl hover:bg-violet-100 transition-all border border-violet-100 font-black text-xs">
                <DownloadCloud size={20} />
                匯出設定
              </button>
              <label className="flex flex-col items-center justify-center gap-2 p-5 bg-violet-50 text-violet-700 rounded-2xl hover:bg-violet-100 transition-all border border-violet-100 font-black text-xs cursor-pointer">
                <UploadCloud size={20} />
                匯入設定
                <input type="file" accept=".json" onChange={importConfig} className="hidden" />
              </label>
            </div>
            <p className="text-[10px] text-slate-400 font-bold px-2 italic leading-relaxed">※ 匯出目前的欄位順序與答案轉換邏輯，讓朋友直接使用。</p>
          </div>

          <div className="space-y-4">
            <p className="text-xs font-black text-slate-300 uppercase tracking-widest px-2 mb-4">功能性輸出欄位</p>
            <button onClick={() => addField('smart_answer', '', '正確答案')} className="w-full flex items-center gap-4 p-5 bg-amber-50 text-amber-700 rounded-[1.5rem] hover:bg-amber-100 transition-all text-left font-black text-sm border border-amber-100 shadow-sm">
              <div className="bg-amber-500/10 p-2.5 rounded-xl"><CheckCircle2 size={18}/></div>
              智慧答案對應
            </button>
            <button onClick={() => addField('filename', '', '檔案名稱')} className="w-full flex items-center gap-4 p-5 bg-indigo-50 text-indigo-700 rounded-[1.5rem] hover:bg-indigo-100 transition-all text-left font-black text-sm border border-indigo-100 shadow-sm">
              <div className="bg-indigo-500/10 p-2.5 rounded-xl"><FileText size={18}/></div>
              固定：原始檔名
            </button>
            <button onClick={() => addField('constant', '固定文字', '備註內容')} className="w-full flex items-center gap-4 p-5 bg-emerald-50 text-emerald-700 rounded-[1.5rem] hover:bg-emerald-100 transition-all text-left font-black text-sm border border-emerald-100 shadow-sm">
              <div className="bg-emerald-500/10 p-2.5 rounded-xl"><TypeIcon size={18}/></div>
              自訂：固定數值
            </button>
            
            <div className="pt-10 space-y-4">
              <p className="text-xs font-black text-slate-300 uppercase tracking-widest px-2 mb-4">來源欄位列表</p>
              <div className="grid grid-cols-1 gap-3">
                {headers.map((h, i) => (
                  <button key={i} onClick={() => addField('csv_column', i, h || `第 ${i+1} 欄`)} className="w-full flex items-center gap-4 p-5 bg-slate-50 text-slate-600 rounded-[1.25rem] hover:bg-indigo-600 hover:text-white transition-all text-left group border border-slate-100 shadow-sm">
                    <Hash size={18} className="text-slate-300 group-hover:text-white" /> 
                    <span className="text-sm font-bold flex-1 truncate">{h || `第 ${i+1} 欄`}</span> 
                    <Plus size={20} className="opacity-0 group-hover:opacity-100 translate-x-3 group-hover:translate-x-0 transition-all" />
                  </button>
                ))}
              </div>
            </div>
          </div>
        </aside>

        {/* Step 3: Workbench Design */}
        <div className="lg:col-span-5 bg-[#F8FAFC] p-10 overflow-y-auto border-r border-slate-200">
          <div className="max-w-2xl mx-auto">
            <div className="flex items-center justify-between mb-12">
              <h2 className="text-3xl font-black text-slate-800 flex items-center gap-4">
                輸出結構設計器
                {isSuggesting && <Loader2 size={28} className="animate-spin text-indigo-600" />}
              </h2>
              <div className="flex items-center gap-3 text-slate-400 bg-white px-6 py-3 rounded-2xl border border-slate-200 text-sm font-bold shadow-sm">
                <LayoutTemplate size={18}/>
                {exportConfig.length} 欄位
              </div>
            </div>

            <div className="space-y-6">
              {exportConfig.length === 0 ? (
                <div className="py-32 text-center border-2 border-dashed border-slate-200 rounded-[3.5rem] bg-white/50 flex flex-col items-center">
                   <div className="bg-slate-100 p-8 rounded-full mb-8 text-slate-300"><LayoutTemplate size={56} /></div>
                   <p className="text-lg font-black text-slate-500">目前結構為空</p>
                   <p className="text-sm text-slate-400 mt-3">請從左側點選欄位或匯入設定檔開始</p>
                </div>
              ) : (
                <div className="space-y-6">
                  {exportConfig.map((field, idx) => (
                    <div 
                      key={field.id} 
                      draggable="true"
                      onDragStart={() => onDragStart(idx)}
                      onDragEnter={() => onDragEnter(idx)}
                      onDragEnd={onDragEnd}
                      onDragOver={onDragOver}
                      className={`bg-white p-8 rounded-[2.5rem] shadow-sm border border-slate-200 group hover:border-indigo-500 transition-all cursor-grab active:cursor-grabbing ${draggedItemIndex === idx ? 'opacity-40 scale-95 border-indigo-400 shadow-inner' : 'hover:shadow-2xl hover:shadow-indigo-50/50'}`}
                    >
                      <div className="flex items-start gap-6">
                        <div className="mt-2 text-slate-200 group-hover:text-slate-400 transition-colors">
                          <GripVertical size={24} />
                        </div>

                        <div className="flex-1" onDragStart={(e) => e.stopPropagation()}>
                          <div className="flex items-center justify-between gap-8 mb-6">
                            <div className="flex-1">
                              <label className="text-xs font-black text-slate-300 uppercase tracking-widest mb-2 block">匯出欄位標題</label>
                              <input 
                                type="text" 
                                value={field.headerName} 
                                onMouseDown={(e) => e.stopPropagation()}
                                onChange={(e) => updateField(field.id, { headerName: e.target.value })} 
                                className="bg-transparent font-black text-slate-800 border-b-2 border-slate-100 focus:border-indigo-500 outline-none text-xl w-full py-2 transition-colors" 
                              />
                            </div>
                            <button 
                              onClick={() => setExportConfig(exportConfig.filter(f => f.id !== field.id))} 
                              className="text-slate-200 hover:text-red-500 p-4 hover:bg-red-50 rounded-[1.25rem] transition-all"
                            >
                              <Trash2 size={24}/>
                            </button>
                          </div>

                          <div className="bg-slate-50/50 p-8 rounded-[2rem] border border-slate-100 shadow-inner">
                            <div className="flex items-center gap-4 mb-6">
                               <span className={`px-4 py-1.5 rounded-full text-xs font-black uppercase tracking-wider shadow-sm ${
                                field.type === 'smart_answer' ? 'bg-amber-600 text-white' : 
                                field.type === 'csv_column' ? 'bg-indigo-600 text-white' : 'bg-slate-500 text-white'
                              }`}>{field.type === 'smart_answer' ? '智慧答案轉換' : field.type}</span>
                            </div>

                            {field.type === 'csv_column' && (
                              <div className="space-y-3">
                                <label className="text-xs font-black text-slate-400 uppercase">對應來源欄位</label>
                                <select value={field.sourceValue} onMouseDown={(e) => e.stopPropagation()} onChange={(e) => updateField(field.id, { sourceValue: e.target.value })} className="w-full bg-white border border-slate-200 rounded-2xl px-5 py-4 text-base font-bold outline-none focus:ring-4 ring-indigo-50 shadow-sm">
                                  <option value="">（請選擇欄位）</option>
                                  {headers.map((h, i) => <option key={i} value={i}>{h || `第 ${i+1} 欄`}</option>)}
                                </select>
                              </div>
                            )}

                            {field.type === 'constant' && (
                              <div className="space-y-3">
                                <label className="text-xs font-black text-slate-400 uppercase">填充固定文字</label>
                                <input type="text" value={field.sourceValue} onMouseDown={(e) => e.stopPropagation()} onChange={(e) => updateField(field.id, { sourceValue: e.target.value })} className="w-full bg-white border border-slate-200 rounded-2xl px-5 py-4 text-base outline-none focus:ring-4 ring-emerald-50 shadow-sm" placeholder="在此輸入文字..." />
                              </div>
                            )}

                            {field.type === 'smart_answer' && field.answerConfig && (
                              <div className="space-y-8">
                                <div className="grid grid-cols-2 gap-8">
                                  <div className="space-y-3">
                                    <label className="text-xs font-black text-slate-400 uppercase flex items-center gap-2"><HelpCircle size={14}/> 來源代號欄位</label>
                                    <select value={field.answerConfig.sourceKeyIdx} onMouseDown={(e) => e.stopPropagation()} onChange={(e) => updateField(field.id, { answerConfig: { ...field.answerConfig!, sourceKeyIdx: e.target.value } })} className="w-full bg-white border border-slate-200 rounded-2xl px-4 py-4 text-base font-bold focus:ring-4 ring-amber-50 shadow-sm">
                                      <option value="">選擇代號欄位...</option>
                                      {headers.map((h, i) => <option key={i} value={i}>{h || `第 ${i+1} 欄`}</option>)}
                                    </select>
                                  </div>
                                  <div className="space-y-3">
                                    <label className="text-xs font-black text-slate-400 uppercase">輸出格式</label>
                                    <div className="flex bg-white border border-slate-200 rounded-2xl p-1.5 shadow-inner">
                                      <button onClick={() => updateField(field.id, { answerConfig: { ...field.answerConfig!, outputMode: 'key' } })} className={`flex-1 py-3 rounded-xl text-xs font-black uppercase transition-all ${field.answerConfig.outputMode === 'key' ? 'bg-amber-600 text-white shadow-md' : 'text-slate-400 hover:text-slate-600'}`}>僅代號</button>
                                      <button onClick={() => updateField(field.id, { answerConfig: { ...field.answerConfig!, outputMode: 'content' } })} className={`flex-1 py-3 rounded-xl text-xs font-black uppercase transition-all ${field.answerConfig.outputMode === 'content' ? 'bg-amber-600 text-white shadow-md' : 'text-slate-400 hover:text-slate-600'}`}>文字內容</button>
                                    </div>
                                  </div>
                                </div>

                                <div className={`p-8 rounded-[2rem] border transition-all ${field.answerConfig.outputMode === 'content' ? 'bg-white border-amber-200 ring-4 ring-amber-50 shadow-sm' : 'bg-slate-100 border-slate-200 opacity-50 grayscale pointer-events-none'}`}>
                                  <div className="flex items-center justify-between mb-6">
                                    <p className="text-xs font-black text-amber-700 uppercase tracking-widest">選項代號 ⮕ 文字內容對應</p>
                                    <Info size={18} className="text-amber-400" />
                                  </div>
                                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                    {[1, 2, 3, 4].map((num, i) => (
                                      <div key={i} className="flex flex-col gap-2">
                                        <div className="flex items-center gap-3">
                                          <span className="w-10 h-10 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center text-sm font-black border border-amber-100 shadow-sm">
                                            {String.fromCharCode(65+i)}
                                          </span>
                                          <ChevronRight size={16} className="text-slate-300" />
                                          <select 
                                            value={field.answerConfig!.optionIndices[i]} 
                                            onMouseDown={(e) => e.stopPropagation()}
                                            onChange={(e) => {
                                              const newIndices = [...field.answerConfig!.optionIndices];
                                              newIndices[i] = e.target.value;
                                              updateField(field.id, { answerConfig: { ...field.answerConfig!, optionIndices: newIndices } });
                                            }} 
                                            className="flex-1 bg-slate-50 border border-slate-200 rounded-xl px-3 py-3 text-xs font-bold outline-none shadow-sm focus:bg-white"
                                          >
                                            <option value="">（不對應）</option>
                                            {headers.map((h, hi) => <option key={hi} value={hi}>{h || `欄位 ${hi+1}`}</option>)}
                                          </select>
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                  <p className="text-xs text-slate-400 mt-6 leading-relaxed italic">※ 拖動卡片左側圖示可重新排序欄位順序。</p>
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Step 4: Live Export Preview */}
        <div className="lg:col-span-4 bg-[#0F172A] p-10 flex flex-col h-full border-l border-white/5 shadow-2xl relative">
          <div className="flex items-center justify-between mb-12">
            <div>
              <h2 className="text-3xl font-black text-white flex items-center gap-5">
                <CheckCircle2 size={32} className="text-emerald-400 shadow-lg shadow-emerald-500/20" /> 
                最終匯出預覽
              </h2>
              <p className="text-slate-500 text-xs font-bold uppercase tracking-widest mt-2">Real-time Data Processing</p>
            </div>
          </div>

          <div className="flex-1 overflow-auto custom-scrollbar rounded-[3rem] bg-black/40 border border-white/5 backdrop-blur-sm shadow-inner">
            {originalData.length > 1 && exportConfig.length > 0 ? (
              <table className="w-full text-left text-sm border-separate border-spacing-0">
                <thead className="sticky top-0 z-10">
                  <tr className="bg-[#1E293B]">
                    {exportConfig.map((f, i) => (
                      <th key={i} className="px-6 py-6 border-b border-white/5 text-slate-400 font-black uppercase tracking-widest whitespace-nowrap first:rounded-tl-[3rem] last:rounded-tr-[3rem]">
                        {f.headerName || '(未命名)'}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {originalData.slice(1, 21).map((row, rIdx) => (
                    <tr key={rIdx} className="hover:bg-white/5 transition-colors group">
                      {exportConfig.map((f, fIdx) => {
                        let val = '-';
                        if (f.type === 'filename') val = file?.name || '-';
                        else if (f.type === 'constant') val = String(f.sourceValue);
                        else if (f.type === 'csv_column') val = row[Number(f.sourceValue)] || '';
                        else if (f.type === 'smart_answer') val = processSmartAnswer(row, f.answerConfig);
                        
                        return (
                          <td key={fIdx} className="px-6 py-6 text-slate-300 max-w-[250px] truncate font-medium group-hover:text-white leading-relaxed" title={val}>
                            {f.type === 'smart_answer' && f.answerConfig?.outputMode === 'content' ? (
                              <span className="text-emerald-400 font-black tracking-wide">{val}</span>
                            ) : val}
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className="h-full flex flex-col items-center justify-center p-20 text-center text-white/10">
                <LayoutTemplate size={100} className="mb-8 opacity-5" />
                <p className="text-2xl font-black tracking-tight">等待匯出設定</p>
                <p className="text-sm mt-4 max-w-[250px] mx-auto opacity-50 font-medium leading-relaxed">定義結構後，這裡將呈現最終 CSV 的視覺化預覽。</p>
              </div>
            )}
          </div>
          
          <div className="mt-12 p-8 bg-gradient-to-br from-white/5 to-white/[0.02] rounded-[2.5rem] border border-white/10 flex items-center justify-between">
            <div className="flex items-center gap-6">
              <div className="bg-indigo-500/20 p-5 rounded-[1.25rem] text-indigo-400 border border-indigo-500/20 shadow-lg"><Database size={28}/></div>
              <div>
                <p className="font-black text-white text-base">資料已就緒</p>
                <p className="text-xs text-slate-500 font-black uppercase tracking-[0.2em] mt-2">
                  {exportConfig.length} 輸出欄位 • {originalData.length > 0 ? originalData.length - 1 : 0} 筆總資料
                </p>
              </div>
            </div>
            <div className="hidden xl:block bg-emerald-500/10 px-6 py-3 rounded-2xl border border-emerald-500/20 shadow-inner">
               <span className="text-emerald-400 text-xs font-black uppercase tracking-widest flex items-center gap-3">
                 <div className="w-3 h-3 rounded-full bg-emerald-500 animate-pulse" /> 引擎狀態：優良
               </span>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

const rootElement = document.getElementById('root');
if (rootElement) {
  createRoot(rootElement).render(<ExamFactory />);
}
