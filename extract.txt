import { Injectable, Logger } from '@nestjs/common';
import { execFile, execFileSync } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { Asset, AssetFactType, ReviewRecommendation, ValidationFlag } from '../assets/asset.entity';
import { AiService } from '../ai/ai.service';

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
  private resolvedPythonPath: string | null = null;

  constructor(private readonly aiService: AiService) {}

  private resolveExtractScriptPath(): string {
    const fromDist = path.join(__dirname, '..', 'scripts', 'extract_tables.py');
    const fromCwdSrc = path.join(process.cwd(), 'src', 'scripts', 'extract_tables.py');
    const fromCwdLegacy = path.join(process.cwd(), 'scripts', 'extract_tables.py');
    if (fs.existsSync(fromDist)) return fromDist;
    if (fs.existsSync(fromCwdSrc)) return fromCwdSrc;
    if (fs.existsSync(fromCwdLegacy)) return fromCwdLegacy;
    return fromDist;
  }

  private resolvePythonExecutable(): string {
    const fromEnv = (process.env.PYTHON_RULE_ENGINE ?? '').trim();
    if (fromEnv && fs.existsSync(fromEnv)) {
      this.resolvedPythonPath = fromEnv;
      return fromEnv;
    }
    if (this.resolvedPythonPath) return this.resolvedPythonPath;
    const launcher = process.platform === 'win32' ? 'python' : 'python3';
    try {
      const out = execFileSync(
        launcher,
        ['-c', 'import sys; print(sys.executable)'],
        { encoding: 'utf8', windowsHide: true },
      ).trim().split(/\r?\n/).filter(Boolean).pop();
      if (out && fs.existsSync(out)) {
        this.resolvedPythonPath = out;
        return out;
      }
    } catch { /* use launcher */ }
    this.resolvedPythonPath = launcher;
    return launcher;
  }

  async extractAssets(input: ExtractInput): Promise<Asset[]> {
    const { text: documentText, jobId, sourceFile, filePath, fileType } = input;
    this.currentJobId = jobId;
    this.currentSourceFile = sourceFile;

    try {
      let ruleBasedAssets: Asset[] = [];
      if (filePath && fs.existsSync(filePath)) {
        this.logger.log(`Running rule-based extraction for ${sourceFile}`);
        ruleBasedAssets = await this.extractWithRulesEngine(filePath, fileType ?? 'unknown', jobId, sourceFile);
        this.logger.log(`Rule-based: ${ruleBasedAssets.length} assets from ${sourceFile}`);
      }

      let aiAssets: Asset[] = [];
      const ft = (fileType ?? '').toLowerCase();
      const isPdf = ft === 'pdf';
      const isStructured = ['csv', 'xlsx', 'xls', 'zip'].includes(ft);

      const openAiKey = (process.env.OPENAI_API_KEY ?? '').trim();
      const claudeKey = (process.env.ANTHROPIC_API_KEY ?? '').trim();
      const hasAiKey =
        (openAiKey.length > 0 && !openAiKey.includes('your_key')) ||
        (claudeKey.length > 0 && !claudeKey.includes('your_key'));

      const needsAi =
        isPdf &&
        !!(documentText && documentText.length > 100) &&
        hasAiKey &&
        ruleBasedAssets.length < 50;

      if (isStructured) {
        this.logger.log(`Skipping AI for structured file "${ft}" — rule engine only`);
      }

      if (needsAi) {
        try {
          const filteredText = this.filterRelevantText(documentText);
          const chunks = this.chunkText(filteredText);
          this.logger.log(`AI extraction: ${chunks.length} chunks for ${sourceFile}`);
          const chunksToProcess = chunks.slice(0, 3);
          for (let i = 0; i < chunksToProcess.length; i++) {
            this.logger.log(`Processing AI chunk ${i + 1}/${chunksToProcess.length}`);
            const openAiRaw = await this.aiService.extractWithOpenAI(chunksToProcess[i]);
            this.logger.log(`OpenAI chunk ${i + 1}: ${openAiRaw.length} assets`);
            const validated = await this.aiService.validateWithClaude(chunksToProcess[i], openAiRaw);
            this.logger.log(`Claude validated chunk ${i + 1}: ${validated.length} assets`);
            if (validated.length > 0) {
              const mapped = this.mapParsedToAssets(validated, sourceFile, jobId);
              aiAssets.push(...mapped);
            }
            if (i < chunksToProcess.length - 1) {
              await new Promise((res) => setTimeout(res, 3000));
            }
          }
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          this.logger.warn(`AI extraction failed: ${msg.substring(0, 200)}`);
        }
      } else if (isPdf && !hasAiKey) {
        this.logger.log('AI skipped — no OPENAI_API_KEY or ANTHROPIC_API_KEY configured');
      }

      const allAssets = [...ruleBasedAssets, ...aiAssets];
      const deduped = this.deduplicateAssetsByNormalizedName(allAssets);
      this.logger.log(
        `Total: ${deduped.length} assets (${ruleBasedAssets.length} rule + ${aiAssets.length} AI) for ${sourceFile}`,
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

  private deduplicateAssetsByNormalizedName(assets: Asset[]): Asset[] {
    const seen = new Map<string, Asset>();
    const passthrough: Asset[] = [];
    for (const asset of assets) {
      const raw = (asset.assetName ?? '').trim().toLowerCase();
      if (!raw) continue;
      const compact = raw.replace(/[^a-z0-9]/g, '');
      const key = compact.length < 12 ? `__raw__:${raw.slice(0, 80)}` : compact.slice(0, 40);
      if (compact.length < 4) { passthrough.push(asset); continue; }
      const existing = seen.get(key);
      if (!existing) { seen.set(key, asset); continue; }
      const existingHasCoords = existing.latitude != null && existing.longitude != null;
      const newHasCoords = asset.latitude != null && asset.longitude != null;
      if (newHasCoords && !existingHasCoords) {
        seen.set(key, asset);
      } else if ((asset.overallConfidence ?? 0) > (existing.overallConfidence ?? 0)) {
        seen.set(key, asset);
      }
    }
    return [...Array.from(seen.values()), ...passthrough];
  }

  private async extractWithRulesEngine(
    filePath: string, fileType: string, jobId: string, sourceFile: string,
  ): Promise<Asset[]> {
    const scriptPath = this.resolveExtractScriptPath();
    if (!fs.existsSync(scriptPath)) {
      this.logger.warn(`Rule engine script not found: ${scriptPath}`);
      return [];
    }
    const timeoutMs = (fileType ?? '').toLowerCase() === 'zip' ? 600_000 : 120_000;
    try {
      const { stdout, stderr } = await execFileAsync(
        this.resolvePythonExecutable(),
        [scriptPath, filePath],
        { timeout: timeoutMs, maxBuffer: 10 * 1024 * 1024 },
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

  private mapParsedToAssets(parsed: unknown[], sourceFile: string, jobId: string): Asset[] {
    const now = new Date();
    return parsed
      .filter((r): r is Record<string, unknown> => !!r && typeof r === 'object' && !Array.isArray(r))
      .map((raw) => {
        const overall = this.toNumber(raw.overallConfidence, 0);
        const recommendation: ReviewRecommendation =
          overall > 0.85 ? 'auto-accept' : overall >= 0.5 ? 'review' : 'reject';

        return {
          id: uuidv4(),
          assetName: this.toString(raw.assetName, ''),
          alternateName: this.toStringArray(raw.alternateName),
          alternateNames: this.toStringArray((raw.alternateNames as unknown[]) ?? raw.alternateName),
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
          validationFlags: [] as ValidationFlag[],
          duplicateClusterId: this.toNullableString(raw.duplicateClusterId),
          reviewRecommendation: this.normalizeReviewRecommendation(raw.reviewRecommendation, recommendation),
          factType: this.toRecordFactType(raw.factType),
          sourceFile,
          sourceJobId: jobId,
          datasetType: this.toNullableString(raw.datasetType) ?? undefined,
          createdAt: now,
          updatedAt: now,
        };
      });
  }

  private filterRelevantText(text: string): string {
    const lines = text.split('\n');
    const keywords = ['asset','property','portfolio','investment','value','fair value',
      'million','billion','CAD','USD','GBP','EUR','AUD','building','land',
      'real estate','fund','equity','holding','acquisition','market value','book value'];
    const scored = lines.map((line) => {
      const lower = line.toLowerCase();
      return { score: keywords.filter((kw) => lower.includes(kw)).length };
    });
    const keepIndices = new Set<number>();
    scored.forEach((s, i) => {
      if (s.score > 0) {
        for (let j = Math.max(0, i - 2); j <= Math.min(scored.length - 1, i + 2); j++) {
          keepIndices.add(j);
        }
      }
    });
    const filtered = lines.filter((_, i) => keepIndices.has(i)).join('\n');
    return filtered.length > 500 ? filtered : text;
  }

  private chunkText(text: string): string[] {
    if (!text.trim()) return [];
    const max = this.chunkSizeChars;
    if (text.length <= max) return [text];
    const chunks: string[] = [];
    let start = 0;
    while (start < text.length) {
      let end = Math.min(start + max, text.length);
      if (end < text.length) {
        const slice = text.slice(start, end);
        const paraBreak = slice.lastIndexOf('\n\n');
        if (paraBreak > max * 0.4) end = start + paraBreak + 2;
        else {
          const lineBreak = slice.lastIndexOf('\n');
          if (lineBreak > max * 0.4) end = start + lineBreak + 1;
        }
      }
      const piece = text.slice(start, end).trim();
      if (piece.length > 0) chunks.push(piece);
      start = Math.max(end, start + 1);
    }
    return chunks.length > 0 ? chunks : [text];
  }

  private normalizeReviewRecommendation(v: unknown, fallback: ReviewRecommendation): ReviewRecommendation {
    if (v === 'auto-accept' || v === 'review' || v === 'reject') return v;
    return fallback;
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
    const allowed = new Set<AssetFactType>(['extracted','inferred','estimated','conflicting','unsupported']);
    const out: Record<string, AssetFactType> = {};
    for (const [k, val] of Object.entries(v)) {
      out[k] = typeof val === 'string' && allowed.has(val as AssetFactType)
        ? (val as AssetFactType) : 'unsupported';
    }
    return out;
  }
}
