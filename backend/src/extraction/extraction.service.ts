import { Injectable, Logger } from '@nestjs/common';
import { execFile } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { v4 as uuidv4 } from 'uuid';
import { Asset, AssetFactType, ReviewRecommendation } from '../assets/asset.entity';

const execFileAsync = promisify(execFile);

export type ExtractInput = {
  text: string;
  jobId: string;
  sourceFile: string;
  filePath?: string;
  fileType?: string;
};

@Injectable()
export class ExtractionService {
  private readonly logger = new Logger(ExtractionService.name);

  private currentJobId = '';
  private currentSourceFile = '';

  private readonly chunkSizeChars = 30_000;

  private getClient(): GoogleGenerativeAI {
    const apiKey = process.env.GEMINI_API_KEY ?? '';
    return new GoogleGenerativeAI(apiKey);
  }

  private resolveExtractScriptPath(): string {
    const fromDist = path.join(__dirname, '..', 'scripts', 'extract_tables.py');
    const fromCwdSrc = path.join(process.cwd(), 'src', 'scripts', 'extract_tables.py');
    const fromCwdLegacy = path.join(process.cwd(), 'scripts', 'extract_tables.py');
    if (fs.existsSync(fromDist)) return fromDist;
    if (fs.existsSync(fromCwdSrc)) return fromCwdSrc;
    if (fs.existsSync(fromCwdLegacy)) return fromCwdLegacy;
    return fromDist;
  }

  private pythonExecutable(): string {
    return process.platform === 'win32' ? 'python' : 'python3';
  }

  async extractAssets(input: ExtractInput): Promise<Asset[]> {
    const { text: documentText, jobId, sourceFile, filePath, fileType } = input;
    this.currentJobId = jobId;
    this.currentSourceFile = sourceFile;

    try {
      let ruleBasedAssets: Asset[] = [];
      if (filePath && fs.existsSync(filePath)) {
        this.logger.log(`Running rule-based extraction for ${sourceFile}`);
        ruleBasedAssets = await this.extractWithRulesEngine(
          filePath,
          fileType ?? 'unknown',
          jobId,
          sourceFile,
        );
        this.logger.log(`Rule-based: ${ruleBasedAssets.length} assets from ${sourceFile}`);
      }

      let aiAssets: Asset[] = [];
      const isPdf = (fileType ?? '').toLowerCase() === 'pdf';
      const geminiKey = (process.env.GEMINI_API_KEY ?? '').trim();
      const geminiUsable =
        geminiKey.length > 0 && !geminiKey.includes('your_key') && geminiKey !== 'your_key_here';

      if (isPdf && documentText && documentText.length > 100 && geminiUsable) {
        try {
          const filteredText = this.filterRelevantText(documentText);
          const chunks = this.chunkText(filteredText);
          this.logger.log(`AI extraction: ${chunks.length} chunks for ${sourceFile}`);

          const client = this.getClient();
          const system = this.buildSystemPrompt();
          const model = client.getGenerativeModel({
            model: 'gemini-1.5-flash',
            systemInstruction: system,
            generationConfig: { maxOutputTokens: 8192, temperature: 0.1 },
          });

          const chunksToProcess = chunks.slice(0, 3);
          for (let i = 0; i < chunksToProcess.length; i++) {
            try {
              this.logger.log(`AI chunk ${i + 1}/${chunksToProcess.length}`);
              const rawText = await this.callGeminiWithRetry(
                model,
                this.buildPrompt(chunksToProcess[i]),
              );
              const parsed = this.parseResponse(rawText);
              if (parsed.length > 0) {
                const mapped = this.mapParsedToAssets(parsed, sourceFile, jobId);
                aiAssets.push(...mapped);
                this.logger.log(`AI chunk ${i + 1}: ${mapped.length} assets`);
              }
              if (i < chunksToProcess.length - 1) {
                await new Promise((res) => setTimeout(res, 5000));
              }
            } catch (err: unknown) {
              const msg =
                err instanceof Error ? err.message : String(err);
              this.logger.warn(`AI chunk ${i + 1} failed: ${msg.substring(0, 120)}`);
            }
          }
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          this.logger.warn(`AI extraction skipped: ${msg.substring(0, 120)}`);
        }
      } else if (isPdf && documentText && documentText.length > 100 && !geminiUsable) {
        this.logger.log('AI extraction skipped (GEMINI_API_KEY missing or placeholder)');
      }

      const allAssets = [...ruleBasedAssets, ...aiAssets];
      const seen = new Set<string>();
      const deduped = allAssets.filter((a) => {
        const key = a.assetName.toLowerCase().trim();
        if (seen.has(key) || !key || key.length < 2) return false;
        seen.add(key);
        return true;
      });

      this.logger.log(
        `Total: ${deduped.length} assets (${ruleBasedAssets.length} rule-based + ${aiAssets.length} AI) for ${sourceFile}`,
      );
      return deduped;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Extraction failed for job ${jobId}: ${msg}`);
      return [];
    } finally {
      this.currentJobId = '';
      this.currentSourceFile = '';
    }
  }

  private async extractWithRulesEngine(
    filePath: string,
    fileType: string,
    jobId: string,
    sourceFile: string,
  ): Promise<Asset[]> {
    const scriptPath = this.resolveExtractScriptPath();
    if (!fs.existsSync(scriptPath)) {
      this.logger.warn(`Rule engine script not found: ${scriptPath}`);
      return [];
    }

    try {
      const { stdout, stderr } = await execFileAsync(
        this.pythonExecutable(),
        [scriptPath, filePath],
        {
          timeout: 120_000,
          maxBuffer: 10 * 1024 * 1024,
        },
      );

      if (stderr?.trim()) {
        this.logger.warn(`Rule engine stderr: ${stderr.substring(0, 400)}`);
      }

      const parsed = JSON.parse(stdout || '[]') as unknown;
      if (!Array.isArray(parsed)) return [];

      return this.mapParsedToAssets(parsed, sourceFile, jobId);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Rule engine failed: ${msg}`);
      return [];
    }
  }

  private mapParsedToAssets(
    parsed: unknown[],
    sourceFile: string,
    jobId: string,
  ): Asset[] {
    const now = new Date();
    return parsed
      .filter(
        (r): r is Record<string, unknown> =>
          !!r && typeof r === 'object' && !Array.isArray(r),
      )
      .map((raw) => {
        const overall = this.toNumber(raw.overallConfidence, 0);
        const recommendation: ReviewRecommendation =
          overall > 0.85 ? 'auto-accept' : overall >= 0.5 ? 'review' : 'reject';

        return {
          id: uuidv4(),
          assetName: this.toString(raw.assetName, ''),
          alternateName: this.toStringArray(raw.alternateName),
          value: this.toNullableNumber(raw.value),
          currency: this.toNullableString(raw.currency),
          jurisdiction: this.toNullableString(raw.jurisdiction),
          latitude: this.toNullableNumber(raw.latitude),
          longitude: this.toNullableNumber(raw.longitude),
          assetType: this.toNullableString(raw.assetType),
          valueBasis: this.toNullableString(raw.valueBasis),
          parentAssetId: this.toNullableString(raw.parentAssetId),
          childAssetIds: this.toStringArray(raw.childAssetIds),
          fieldConfidence: this.toRecordNumber(raw.fieldConfidence),
          overallConfidence: this.clamp01(overall),
          sourceEvidence: this.toStringArray(raw.sourceEvidence),
          explanation: this.toString(raw.explanation, ''),
          validationFlags: this.toStringArray(raw.validationFlags),
          duplicateClusterId: this.toNullableString(raw.duplicateClusterId),
          reviewRecommendation: this.normalizeReviewRecommendation(
            raw.reviewRecommendation,
            recommendation,
          ),
          factType: this.toRecordFactType(raw.factType),
          sourceFile,
          sourceJobId: jobId,
          createdAt: now,
          updatedAt: now,
        };
      });
  }

  private normalizeReviewRecommendation(
    v: unknown,
    fallback: ReviewRecommendation,
  ): ReviewRecommendation {
    if (v === 'auto-accept' || v === 'review' || v === 'reject') return v;
    if (typeof v === 'string') {
      const t = v.trim() as ReviewRecommendation;
      if (t === 'auto-accept' || t === 'review' || t === 'reject') return t;
    }
    return fallback;
  }

  private filterRelevantText(text: string): string {
    const lines = text.split('\n');
    const relevantKeywords = [
      'asset',
      'property',
      'portfolio',
      'investment',
      'value',
      'fair value',
      'million',
      'billion',
      'CAD',
      'USD',
      'GBP',
      'EUR',
      'AUD',
      'building',
      'land',
      'real estate',
      'fund',
      'equity',
      'holding',
      'acquisition',
      'disposal',
      'market value',
      'book value',
      'square feet',
      'sq ft',
      'hectare',
      'acre',
    ];

    const scored: { score: number }[] = [];
    for (let i = 0; i < lines.length; i++) {
      const lower = lines[i].toLowerCase();
      let score = 0;
      for (const kw of relevantKeywords) {
        if (lower.includes(kw)) score++;
      }
      scored.push({ score });
    }

    const keepIndices = new Set<number>();
    for (let i = 0; i < scored.length; i++) {
      if (scored[i].score > 0) {
        for (let j = Math.max(0, i - 2); j <= Math.min(scored.length - 1, i + 2); j++) {
          keepIndices.add(j);
        }
      }
    }

    const filtered = lines.filter((_, i) => keepIndices.has(i)).join('\n');
    const pctKept =
      text.length > 0 ? Math.round((filtered.length / text.length) * 100) : 0;
    this.logger.log(
      `Text filtered: ${text.length} → ${filtered.length} chars (${pctKept}% kept)`,
    );
    return filtered.length > 500 ? filtered : text;
  }

  private chunkText(documentText: string): string[] {
    const text = documentText ?? '';
    if (!text.trim()) return [];
    const max = this.chunkSizeChars;
    if (text.length <= max) return [text];

    const chunks: string[] = [];
    let start = 0;
    while (start < text.length) {
      let end = Math.min(start + max, text.length);
      if (end < text.length) {
        const slice = documentText.slice(start, end);
        const paraBreak = slice.lastIndexOf('\n\n');
        if (paraBreak > max * 0.4) {
          end = start + paraBreak + 2;
        } else {
          const lineBreak = slice.lastIndexOf('\n');
          if (lineBreak > max * 0.4) {
            end = start + lineBreak + 1;
          }
        }
      }
      const piece = documentText.slice(start, end).trim();
      if (piece.length > 0) chunks.push(piece);
      start = Math.max(end, start + 1);
    }

    return chunks.length > 0 ? chunks : [text];
  }

  private buildPrompt(text: string): string {
    return `JOB_ID: ${this.currentJobId}\nSOURCE_FILE: ${this.currentSourceFile}\n\nTEXT:\n${text}`;
  }

  private buildSystemPrompt(): string {
    return [
      'You are an expert information extraction model for an Asset Extraction Platform.',
      'Given a document text, extract ALL assets mentioned and return ONLY a valid JSON array (no markdown, no commentary).',
      '',
      'Each asset object MUST include every field below with correct types:',
      '- assetName: string',
      '- alternateName: string[] (can be empty)',
      '- value: number | null',
      '- currency: string | null',
      '- jurisdiction: string | null',
      '- latitude: number | null',
      '- longitude: number | null',
      '- assetType: string | null',
      '- valueBasis: string | null',
      '- parentAssetId: string | null',
      '- childAssetIds: string[] (can be empty)',
      '- fieldConfidence: Record<string, number> where each value is 0.0 to 1.0',
      '- overallConfidence: number 0.0 to 1.0',
      '- sourceEvidence: string[] (short quotes from the source text)',
      '- explanation: string (why you assigned these values and confidences)',
      '- validationFlags: string[] (can be empty)',
      '- duplicateClusterId: string | null',
      "- reviewRecommendation: 'auto-accept' | 'review' | 'reject'",
      "- factType: Record<string, 'extracted' | 'inferred' | 'estimated' | 'conflicting' | 'unsupported'>",
      '',
      'Rules:',
      "- factType per field: 'extracted' if directly stated, 'inferred' if derived, 'estimated' if approximated, 'conflicting' if contradictory statements, 'unsupported' if missing/unknown.",
      '- fieldConfidence per field: 0.0 (unknown) to 1.0 (certain).',
      '- overallConfidence: weighted average; weight assetName and value higher than other fields.',
      "- reviewRecommendation: 'auto-accept' if overallConfidence > 0.85, 'review' if 0.5 to 0.85, 'reject' if < 0.5.",
      '',
      'Output must be a JSON array. If no assets found, output [].',
    ].join('\n');
  }

  private parseResponse(raw: string): unknown[] {
    try {
      let cleaned = raw.trim();
      if (cleaned.startsWith('```')) {
        cleaned = cleaned
          .replace(/^```(?:json)?\s*/i, '')
          .replace(/\s*```$/, '')
          .trim();
      }

      const arrayStart = cleaned.indexOf('[');
      const arrayEnd = cleaned.lastIndexOf(']');
      if (arrayStart !== -1 && arrayEnd !== -1) {
        cleaned = cleaned.slice(arrayStart, arrayEnd + 1);
      }

      const parsed = JSON.parse(cleaned) as unknown;
      return Array.isArray(parsed) ? parsed : [];
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`JSON parse failed, returning empty: ${msg}`);
      this.logger.debug(`Raw response was: ${raw?.substring(0, 500)}`);
      return [];
    }
  }

  private async callGeminiWithRetry(
    model: { generateContent: (prompt: string) => Promise<{ response: { text: () => string } }> },
    prompt: string,
    maxRetries = 3,
  ): Promise<string> {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const result = await model.generateContent(prompt);
        return result.response.text();
      } catch (err: unknown) {
        const errAny = err as { message?: string };
        const msg =
          typeof errAny?.message === 'string' ? errAny.message : String(err ?? '');

        const isRetryable =
          msg.includes('503') ||
          msg.includes('Service Unavailable') ||
          msg.includes('429') ||
          msg.includes('Too Many Requests');

        if (isRetryable && attempt < maxRetries) {
          const retryMatch = msg.match(/retry in (\d+(?:\.\d+)?)s/i);
          const waitMs = retryMatch
            ? Math.ceil(parseFloat(retryMatch[1])) * 1000 + 2000
            : attempt * 5000;
          this.logger.warn(
            `Rate limited. Waiting ${waitMs}ms before retry ${attempt}/${maxRetries}`,
          );
          await new Promise((res) => setTimeout(res, waitMs));
          continue;
        }
        throw err;
      }
    }
    return '';
  }

  private clamp01(n: number): number {
    if (!Number.isFinite(n)) return 0;
    return Math.max(0, Math.min(1, n));
  }

  private toString(v: unknown, fallback: string): string {
    return typeof v === 'string' ? v : fallback;
  }

  private toNullableString(v: unknown): string | null {
    return typeof v === 'string' && v.trim().length > 0 ? v : null;
  }

  private toNumber(v: unknown, fallback: number): number {
    const n = typeof v === 'number' ? v : Number(v);
    return Number.isFinite(n) ? n : fallback;
  }

  private toNullableNumber(v: unknown): number | null {
    if (v === null || v === undefined || v === '') return null;
    const n = typeof v === 'number' ? v : Number(v);
    return Number.isFinite(n) ? n : null;
  }

  private toStringArray(v: unknown): string[] {
    if (!Array.isArray(v)) return [];
    return v.map((x) => (typeof x === 'string' ? x : String(x))).filter((s) => s.length > 0);
  }

  private toRecordNumber(v: unknown): Record<string, number> {
    if (!v || typeof v !== 'object') return {};
    const out: Record<string, number> = {};
    for (const [k, val] of Object.entries(v)) {
      const n = typeof val === 'number' ? val : Number(val);
      out[k] = this.clamp01(Number.isFinite(n) ? n : 0);
    }
    return out;
  }

  private toRecordFactType(v: unknown): Record<string, AssetFactType> {
    if (!v || typeof v !== 'object') return {};
    const allowed = new Set<AssetFactType>([
      'extracted',
      'inferred',
      'estimated',
      'conflicting',
      'unsupported',
    ]);
    const out: Record<string, AssetFactType> = {};
    for (const [k, val] of Object.entries(v)) {
      if (typeof val === 'string' && allowed.has(val as AssetFactType)) {
        out[k] = val as AssetFactType;
      } else {
        out[k] = 'unsupported';
      }
    }
    return out;
  }
}
