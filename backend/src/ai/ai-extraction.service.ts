// ============================================================
// AI EXTRACTION SERVICE
// Fixes: uses OpenAI (gpt-4o) + Claude (claude-opus-4-5) instead of Gemini
// Strategy: OpenAI for initial extraction → Claude for validation + reconciliation
// ============================================================

import { Injectable, Logger } from '@nestjs/common';
import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { SourceEvidence, FieldConfidence, CanonicalAsset } from '../common/asset.schema';

export interface RawDocumentChunk {
  text: string;
  pageNumber?: number;
  source: string;
  fileName: string;
  fileId: string;
  chunkIndex: number;
  isOcrText: boolean;
}

export interface AIExtractionResult {
  assets: Partial<CanonicalAsset>[];
  model: string;
  tokensUsed: number;
  warnings: string[];
}

@Injectable()
export class AIExtractionService {
  private readonly logger = new Logger(AIExtractionService.name);
  private readonly openai: OpenAI;
  private readonly anthropic: Anthropic;

  constructor() {
    this.openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    this.anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }

  // ── STEP 1: OpenAI extracts raw assets from document text ──────────
  async extractWithOpenAI(chunk: RawDocumentChunk): Promise<AIExtractionResult> {
    const prompt = this.buildExtractionPrompt(chunk);

    try {
      const response = await this.openai.chat.completions.create({
        model: 'gpt-4o',
        messages: [
          {
            role: 'system',
            content: `You are a financial intelligence extraction system. Extract structured asset records from documents.
Always respond with valid JSON only. No explanation text outside JSON.
For every field you extract, provide: value, confidence (0-1), factType (extracted|inferred|estimated|conflicting|unsupported), and a brief explanation.
FactType rules:
- extracted: directly stated in text
- inferred: logically derived (e.g. currency from jurisdiction)
- estimated: approximate calculation
- conflicting: multiple different values found
- unsupported: assumed without evidence`,
          },
          { role: 'user', content: prompt },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.1,
      });

      const raw = JSON.parse(response.choices[0].message.content || '{"assets":[]}');
      const assets = this.normalizeOpenAIResponse(raw, chunk);

      return {
        assets,
        model: 'gpt-4o',
        tokensUsed: response.usage?.total_tokens || 0,
        warnings: [],
      };
    } catch (err) {
      this.logger.error(`OpenAI extraction failed: ${err.message}`);
      return { assets: [], model: 'gpt-4o', tokensUsed: 0, warnings: [err.message] };
    }
  }

  // ── STEP 2: Claude validates + enriches the extracted assets ────────
  async validateAndEnrichWithClaude(
    extractedAssets: Partial<CanonicalAsset>[],
    originalChunk: RawDocumentChunk,
  ): Promise<AIExtractionResult> {
    if (!extractedAssets.length) return { assets: [], model: 'claude-opus-4-5', tokensUsed: 0, warnings: [] };

    const prompt = this.buildValidationPrompt(extractedAssets, originalChunk);

    try {
      const response = await this.anthropic.messages.create({
        model: 'claude-opus-4-5',
        max_tokens: 4096,
        messages: [
          {
            role: 'user',
            content: prompt,
          },
        ],
      });

      const textContent = response.content.find((b) => b.type === 'text');
      const jsonMatch = textContent?.text.match(/```json\n?([\s\S]*?)\n?```/) ||
                        textContent?.text.match(/(\{[\s\S]*\})/);

      if (!jsonMatch) {
        this.logger.warn('Claude returned no parseable JSON, using OpenAI result as-is');
        return { assets: extractedAssets, model: 'claude-opus-4-5', tokensUsed: 0, warnings: ['Claude JSON parse failed'] };
      }

      const validated = JSON.parse(jsonMatch[1]);
      const assets = this.normalizeClaudeResponse(validated, extractedAssets, originalChunk);

      return {
        assets,
        model: 'claude-opus-4-5',
        tokensUsed: response.usage.input_tokens + response.usage.output_tokens,
        warnings: validated.warnings || [],
      };
    } catch (err) {
      this.logger.error(`Claude validation failed: ${err.message}`);
      return { assets: extractedAssets, model: 'claude-opus-4-5', tokensUsed: 0, warnings: [err.message] };
    }
  }

  // ── STEP 3: Claude performs final reconciliation across all assets ───
  async reconcileWithClaude(
    allAssets: Partial<CanonicalAsset>[],
  ): Promise<{ mergedAssets: Partial<CanonicalAsset>[]; duplicateClusters: Record<string, string[]> }> {
    if (allAssets.length < 2) {
      return { mergedAssets: allAssets, duplicateClusters: {} };
    }

    const summaries = allAssets.map((a, i) => ({
      index: i,
      id: a.id,
      name: (a.assetName as any)?.value,
      alternateNames: a.alternateNames,
      lat: (a.latitude as any)?.value,
      lon: (a.longitude as any)?.value,
      jurisdiction: (a.jurisdiction as any)?.value,
      assetType: (a.assetType as any)?.value,
    }));

    try {
      const response = await this.anthropic.messages.create({
        model: 'claude-opus-4-5',
        max_tokens: 2048,
        messages: [
          {
            role: 'user',
            content: `You are reconciling a list of extracted assets. Identify duplicates and near-duplicates.

Assets:
${JSON.stringify(summaries, null, 2)}

Respond with JSON only:
{
  "duplicateClusters": {
    "cluster_id_1": ["asset_id_a", "asset_id_b"],
    ...
  },
  "mergeRecommendations": [
    { "keepId": "asset_id_a", "mergeIds": ["asset_id_b"], "rationale": "..." }
  ]
}`,
          },
        ],
      });

      const textContent = response.content.find((b) => b.type === 'text');
      const jsonMatch = textContent?.text.match(/```json\n?([\s\S]*?)\n?```/) ||
                        textContent?.text.match(/(\{[\s\S]*\})/);

      if (!jsonMatch) return { mergedAssets: allAssets, duplicateClusters: {} };

      const result = JSON.parse(jsonMatch[1]);
      const mergedAssets = this.applyMergeRecommendations(allAssets, result.mergeRecommendations || []);

      return {
        mergedAssets,
        duplicateClusters: result.duplicateClusters || {},
      };
    } catch (err) {
      this.logger.error(`Claude reconciliation failed: ${err.message}`);
      return { mergedAssets: allAssets, duplicateClusters: {} };
    }
  }

  // ── Prompt builders ────────────────────────────────────────────────
  private buildExtractionPrompt(chunk: RawDocumentChunk): string {
    return `Extract all financial/physical assets from this document text.

FILE: ${chunk.fileName} | Page: ${chunk.pageNumber ?? 'N/A'} | OCR: ${chunk.isOcrText}

TEXT:
${chunk.text.substring(0, 8000)}

Return JSON with this structure:
{
  "assets": [
    {
      "assetName": { "value": "...", "confidence": 0.95, "factType": "extracted", "explanation": "..." },
      "value": { "value": 1500000, "confidence": 0.8, "factType": "extracted", "explanation": "..." },
      "currency": { "value": "USD", "confidence": 0.9, "factType": "inferred", "explanation": "Inferred from US jurisdiction" },
      "jurisdiction": { "value": "New York, USA", "confidence": 0.85, "factType": "extracted", "explanation": "..." },
      "latitude": { "value": 40.7128, "confidence": 0.7, "factType": "inferred", "explanation": "Geocoded from address" },
      "longitude": { "value": -74.0060, "confidence": 0.7, "factType": "inferred", "explanation": "..." },
      "assetType": { "value": "Commercial Real Estate", "confidence": 0.9, "factType": "extracted", "explanation": "..." },
      "alternateNames": ["...", "..."],
      "valueBasis": { "value": "market value", "confidence": 0.75, "factType": "extracted", "explanation": "..." }
    }
  ]
}`;
  }

  private buildValidationPrompt(assets: Partial<CanonicalAsset>[], chunk: RawDocumentChunk): string {
    return `You are validating extracted assets against the source document.

SOURCE TEXT (first 4000 chars):
${chunk.text.substring(0, 4000)}

EXTRACTED ASSETS TO VALIDATE:
${JSON.stringify(assets, null, 2)}

For each asset:
1. Verify values against source text
2. Add/correct alternate names if you see them in the source
3. Identify parent/child relationships between assets
4. Flag any validation issues (impossible coordinates, unit mismatches, etc.)
5. Lower confidence if value is unsupported by source text

Respond with:
\`\`\`json
{
  "validatedAssets": [ ... same structure with corrections ... ],
  "validationFlags": [
    { "assetIndex": 0, "code": "IMPOSSIBLE_COORDS", "severity": "error", "message": "...", "field": "latitude" }
  ],
  "warnings": []
}
\`\`\``;
  }

  // ── Normalizers ────────────────────────────────────────────────────
  private normalizeOpenAIResponse(raw: any, chunk: RawDocumentChunk): Partial<CanonicalAsset>[] {
    const assets: Partial<CanonicalAsset>[] = (raw.assets || []).map((a: any, i: number) => {
      const evidence: SourceEvidence = {
        fileId: chunk.fileId,
        fileName: chunk.fileName,
        pageNumber: chunk.pageNumber,
        rawText: chunk.text.substring(0, 200),
        extractionMethod: 'openai',
      };

      const wrapField = (field: any): FieldConfidence => ({
        value: field?.value ?? null,
        confidence: field?.confidence ?? 0.5,
        factType: field?.factType ?? 'extracted',
        sourceEvidence: [evidence],
        explanation: field?.explanation ?? '',
      });

      return {
        id: `asset_${chunk.fileId}_${chunk.chunkIndex}_${i}`,
        version: 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        assetName: wrapField(a.assetName),
        value: wrapField(a.value),
        currency: wrapField(a.currency),
        jurisdiction: wrapField(a.jurisdiction),
        latitude: wrapField(a.latitude),
        longitude: wrapField(a.longitude),
        assetType: wrapField(a.assetType),
        alternateNames: a.alternateNames || [],
        valueBasis: wrapField(a.valueBasis),
        childAssetIds: [],
        relationships: [],
        validationFlags: [],
        sourceFileIds: [chunk.fileId],
        extractionRuns: [],
        overallConfidence: 0.5,
        reviewRecommendation: 'review',
      };
    });

    return assets;
  }

  private normalizeClaudeResponse(
    validated: any,
    original: Partial<CanonicalAsset>[],
    chunk: RawDocumentChunk,
  ): Partial<CanonicalAsset>[] {
    const flagsByIndex: Record<number, any[]> = {};
    for (const flag of validated.validationFlags || []) {
      const idx = flag.assetIndex ?? 0;
      flagsByIndex[idx] = flagsByIndex[idx] || [];
      flagsByIndex[idx].push(flag);
    }

    return (validated.validatedAssets || original).map((a: any, i: number) => ({
      ...original[i],
      ...a,
      validationFlags: [
        ...(original[i]?.validationFlags || []),
        ...(flagsByIndex[i] || []),
      ],
    }));
  }

  private applyMergeRecommendations(
    assets: Partial<CanonicalAsset>[],
    recommendations: Array<{ keepId: string; mergeIds: string[]; rationale: string }>,
  ): Partial<CanonicalAsset>[] {
    const toRemove = new Set<string>();
    for (const rec of recommendations) {
      // FIX: spread operator error — use forEach instead of spread
      rec.mergeIds.forEach((id) => toRemove.add(id));
      const keeper = assets.find((a) => a.id === rec.keepId);
      if (keeper) {
        keeper.relationships = [
          ...(keeper.relationships || []),
          ...rec.mergeIds.map((mid) => ({
            relatedAssetId: mid,
            relationType: 'duplicate' as const,
            confidence: 0.9,
            rationale: rec.rationale,
          })),
        ];
      }
    }
    return assets.filter((a) => !toRemove.has(a.id!));
  }
}
