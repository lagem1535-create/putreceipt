// 오픈소스 AI 엔진 (Hugging Face transformers.js, 브라우저에서 직접 실행 — 서버 없음, API 키 없음)
// 모델은 최초 사용 시에만 CDN에서 내려받고, 이후에는 브라우저 캐시에 저장되어 재사용됩니다.
const TRANSFORMERS_CDN = "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.2.4";
const EMBED_MODEL = "Xenova/paraphrase-multilingual-MiniLM-L12-v2";
const GEN_MODEL = "onnx-community/Qwen2.5-0.5B-Instruct";

let transformersMod = null;
let embedderPromise = null;
let generatorPromise = null;

async function loadTransformers() {
  if (transformersMod) return transformersMod;
  transformersMod = await import(TRANSFORMERS_CDN);
  return transformersMod;
}

export function isSupported() {
  return typeof WebAssembly !== "undefined";
}

// progressCb(percent:0-100, label:string) — 모델 다운로드 진행률 표시용 (선택)
export async function getEmbedder(progressCb) {
  if (!embedderPromise) {
    embedderPromise = (async () => {
      const { pipeline } = await loadTransformers();
      return pipeline("feature-extraction", EMBED_MODEL, {
        dtype: "q8",
        progress_callback: (info) => {
          if (progressCb && info?.status === "progress") progressCb(Math.round(info.progress || 0), "임베딩 모델");
        },
      });
    })();
  }
  return embedderPromise;
}

export async function getGenerator(progressCb) {
  if (!generatorPromise) {
    generatorPromise = (async () => {
      const { pipeline } = await loadTransformers();
      return pipeline("text-generation", GEN_MODEL, {
        dtype: "q4",
        progress_callback: (info) => {
          if (progressCb && info?.status === "progress") progressCb(Math.round(info.progress || 0), "요약 모델");
        },
      });
    })();
  }
  return generatorPromise;
}

export function cosineSim(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  if (!na || !nb) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

// 문장/구(query)들을 임베딩 벡터로 변환합니다. 실패 시 예외를 던집니다(호출부에서 폴백 처리).
export async function embedTexts(texts, progressCb) {
  const extractor = await getEmbedder(progressCb);
  const list = Array.isArray(texts) ? texts : [texts];
  const output = await extractor(list.map(t => `query: ${t}`), { pooling: "mean", normalize: true });
  const dims = output.dims;
  const vectors = [];
  const data = output.data;
  const size = dims[dims.length - 1];
  for (let i = 0; i < list.length; i++) vectors.push(Array.from(data.slice(i * size, (i + 1) * size)));
  return Array.isArray(texts) ? vectors : vectors[0];
}

// 지출 통계를 바탕으로 자연스러운 한국어 요약 문단을 생성합니다.
export async function summarizeExpenses(stats, progressCb) {
  const generator = await getGenerator(progressCb);
  const topCategory = stats.byCategory?.[0];
  const userPrompt = `아래 지출 데이터를 바탕으로 경비 정산 보고서에 들어갈 한국어 요약을 2~3문장으로 작성해줘. 숫자는 그대로 사용하고, 과장하지 말고 사실만 담백하게 써줘.\n\n기간: ${stats.from} ~ ${stats.to}\n총 지출: ${stats.total}원\n영수증 수: ${stats.count}건\n평균 결제 금액: ${stats.avg}원\n가장 지출이 큰 카테고리: ${topCategory ? `${topCategory.c} (${topCategory.v}원)` : "없음"}`;
  const messages = [
    { role: "system", content: "당신은 회사 경비 정산 담당자를 돕는 한국어 비서입니다. 간결하고 정확한 요약만 작성합니다." },
    { role: "user", content: userPrompt },
  ];
  const result = await generator(messages, { max_new_tokens: 160, temperature: 0.4, do_sample: false });
  const text = result?.[0]?.generated_text;
  if (Array.isArray(text)) { const last = text[text.length - 1]; return (last?.content || "").trim(); }
  return String(text || "").trim();
}
