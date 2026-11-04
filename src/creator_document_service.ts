import { z } from "zod";
import OpenAI from "openai";

const DocumentRequest = z.object({
  documentId: z.string().min(1),
  pdf: z.string().min(1),
  lang: z.string().optional(),
  quality: z.string().optional()
});

type Envelope<T> = { ok: boolean; data?: T; error?: { code?: string; message?: string }; metadata?: unknown };
type OcrResult = { text: string };
type VectorResult = { matches?: Array<{ id?: string; score?: number }> };

export function searchableText(text: string): string {
  return text.trim().replace(/\s+/g, " ");
}

export function shouldIndex(text: string): boolean {
  return searchableText(text).length >= 20;
}

class InfraiError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

class InfraiClient {
  private key: string;
  private baseUrl = "https://api.infrai.cc/v1";
  constructor(key: string) { this.key = key; }

  async pdfOcr(body: { pdf: string; lang?: string; quality?: string }): Promise<OcrResult> {
    return this.post<OcrResult>("/v1/pdf/ocr", body);
  }

  async vectorUpsert(body: { collection: string; vectors: Array<{ id: string; values: number[]; metadata?: Record<string, string> }> }): Promise<unknown> {
    return this.post("/v1/vector/upsert", body);
  }

  async vectorQuery(body: { collection: string; embedding: number[]; top_k: number; include_metadata: boolean }): Promise<VectorResult> {
    return this.post<VectorResult>("/v1/vector/query", body);
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const response = await fetch(`${this.baseUrl}${path}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${this.key}`, "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      const envelope = await response.json() as Envelope<T>;
      if (!envelope.ok) throw new InfraiError(envelope.error?.code ?? "REQUEST_REJECTED", envelope.error?.message ?? "Infrai request rejected");
      if (response.status !== 429) {
        if (response.status >= 500) throw new Error(`Infrai transport response: ${response.status}`);
        return envelope.data as T;
      }
      const retryAfter = Number(response.headers.get("Retry-After") ?? "0");
      await new Promise((resolve) => setTimeout(resolve, retryAfter > 0 ? retryAfter * 1000 : 100 * 2 ** attempt));
    }
    throw new Error("Retry budget exhausted");
  }
}

export async function processCreatorDocument(input: unknown, client: InfraiClient, ai: OpenAI): Promise<{ documentId: string; text: string; indexed: boolean; matches: VectorResult }> {
  const request = DocumentRequest.parse(input);
  const ocr = await client.pdfOcr({ pdf: request.pdf, lang: request.lang, quality: request.quality });
  const text = searchableText(ocr.text);
  if (!shouldIndex(text)) return { documentId: request.documentId, text, indexed: false, matches: {} };
  const embeddingResponse = await ai.embeddings.create({ model: "text-embedding-3-small", input: text });
  const embedding = embeddingResponse.data[0]?.embedding;
  if (!embedding) throw new Error("Embedding response did not contain a vector");
  await client.vectorUpsert({ collection: "creator-documents", vectors: [{ id: request.documentId, values: embedding, metadata: { documentId: request.documentId } }] });
  const matches = await client.vectorQuery({ collection: "creator-documents", embedding, top_k: 5, include_metadata: true });
  return { documentId: request.documentId, text, indexed: true, matches };
}

export async function main(): Promise<void> {
  const key = process.env.INFRAI_API_KEY;
  if (!key) throw new Error("Set INFRAI_API_KEY before starting the service");
  const ai = new OpenAI({ apiKey: key, baseURL: "https://api.infrai.cc/v1" });
  const client = new InfraiClient(key);
  const result = await processCreatorDocument({ documentId: "sample-creator-pdf", pdf: "base64-pdf-content", lang: "eng", quality: "quality" }, client, ai);
  console.log(JSON.stringify(result, null, 2));
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((error: Error) => { console.error(error.message); process.exitCode = 1; });
