// ============================================================
// FILE: backend/src/ai/ai.service.ts
// FIX: Gemini hatao — OpenAI (extraction) + Claude (validation) use karo
// ============================================================
import { Injectable, Logger } from '@nestjs/common';
import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';

export interface AIAssetResult {
  assetName: string;
  value: number | null;
  currency: string | null;
  jurisdiction: string | null;
  latitude: number | null;
  longitude: number | null;
  assetType: string | null;
  valueBasis: string | null;
  alternateNames: string[];
  confidence: number;
  factType: Record<string, string>;
  explanation: string;
  validationFlags: string[];
}

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);
  private readonly openai: OpenAI;
  private readonly anthropic: Anthropic;

  constructor() {
    this.openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    this.anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }

  // ── Step 1: OpenAI extracts raw assets ──────────────────────────────
  async extractWithOpenAI(text: string, fileName: string): Promise<AIAssetResult[]> {
    if (!process.env.OPENAI_API_KEY) {
      this.logger.warn('OPENAI_API_KEY not set — skipping OpenAI extraction');
      return [];
    }

    try {
      const response = await this.openai.chat.completions.create({
        model: 'gpt-4o',
        temperature: 0.1,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: `You are a financial asset extraction engine. Extract all physical/financial assets from documents.
Return ONLY valid JSON. For each field specify: value, confidence (0-1), factType (extracted|inferred|estimated|conflicting|unsupported).
factType rules:
- extracted: directly written in source text
- inferred: logically derived (e.g. USD from USA jurisdiction)
- estimated: approximated value
- conflicting: multiple different values found for same field
- unsupported: assumed with no evidence`,
          },
          {
            role: 'user',
            content: `Extract assets from this document.
FILE: ${fileName}

TEXT:
${text.substring(0, 8000)}

Return JSON:
{
  "assets": [
    {
      "assetName": "...",
      "value": 1500000,
      "currency": "USD",
      "jurisdiction": "New York, USA",
      "latitude": 40.71,
      "longitude": -74.00,
      "assetType": "Commercial Real Estate",
      "valueBasis": "market value",
      "alternateNames": ["alias1", "alias2"],
      "confidence": 0.85,
      "factType": {
        "assetName": "extracted",
        "value": "extracted",
        "currency": "inferred",
        "latitude": "inferred",
        "longitude": "inferred"
      },
      "explanation": "Found in table row 3, value stated as $1.5M",
      "validationFlags": []
    }
  ]
}`,
          },
        ],
      });

      const raw = JSON.parse(response.choices[0].message.content || '{"assets":[]}');
      return (raw.assets || []) as AIAssetResult[];
    } catch (err) {
      this.logger.error(`OpenAI extraction error: ${err.message}`);
      return [];
    }
  }

  // ── Step 2: Claude validates + enriches OpenAI results ───────────────
  async validateWithClaude(
    assets: AIAssetResult[],
    sourceText: string,
  ): Promise<AIAssetResult[]> {
    if (!process.env.ANTHROPIC_API_KEY || assets.length === 0) {
      this.logger.warn('ANTHROPIC_API_KEY not set or no assets — skipping Claude validation');
      return assets;
    }

    try {
      const response = await this.anthropic.messages.create({
        model: 'claude-opus-4-5',
        max_tokens: 4096,
        messages: [
          {
            role: 'user',
            content: `You are validating extracted financial assets against source text.

SOURCE TEXT (first 4000 chars):
${sourceText.substring(0, 4000)}

EXTRACTED ASSETS TO VALIDATE:
${JSON.stringify(assets, null, 2)}

For each asset:
1. Verify values against source — lower confidence if not supported
2. Add alternate names you see in the source
3. Flag validation issues: impossible coordinates, unit mismatches, HQ misattribution
4. Identify parent/child relationships between assets
5. If currency is missing, infer from jurisdiction (mark as "inferred")

Return corrected assets as JSON:
\`\`\`json
{"assets": [...same structure with corrections...]}
\`\`\``,
          },
        ],
      });

      const textBlock = response.content.find((b) => b.type === 'text');
      const match =
        textBlock?.text.match(/```json\n?([\s\S]*?)\n?```/) ||
        textBlock?.text.match(/(\{[\s\S]*\})/);

      if (!match) return assets;

      const parsed = JSON.parse(match[1]);
      return (parsed.assets || assets) as AIAssetResult[];
    } catch (err) {
      this.logger.error(`Claude validation error: ${err.message}`);
      return assets;
    }
  }

  // ── Step 3: Claude deduplicates across all assets ────────────────────
  async deduplicateWithClaude(
    assets: AIAssetResult[],
  ): Promise<{ kept: AIAssetResult[]; duplicateClusters: Record<string, string[]> }> {
    if (!process.env.ANTHROPIC_API_KEY || assets.length < 2) {
      return { kept: assets, duplicateClusters: {} };
    }

    try {
      const summaries = assets.map((a, i) => ({
        idx: i,
        name: a.assetName,
        altNames: a.alternateNames,
        lat: a.latitude,
        lon: a.longitude,
        jurisdiction: a.jurisdiction,
      }));

      const response = await this.anthropic.messages.create({
        model: 'claude-opus-4-5',
        max_tokens: 2048,
        messages: [
          {
            role: 'user',
            content: `Identify duplicate assets in this list. Same asset = same name/location across sources.

${JSON.stringify(summaries, null, 2)}

Return JSON only:
\`\`\`json
{
  "duplicateGroups": [[0, 3], [1, 5, 7]],
  "keepIndices": [0, 1]
}
\`\`\`
keepIndices = which index to keep from each group (highest confidence one).`,
          },
        ],
      });

      const textBlock = response.content.find((b) => b.type === 'text');
      const match =
        textBlock?.text.match(/```json\n?([\s\S]*?)\n?```/) ||
        textBlock?.text.match(/(\{[\s\S]*\})/);

      if (!match) return { kept: assets, duplicateClusters: {} };

      const result = JSON.parse(match[1]);
      const removeSet = new Set<number>();
      const clusters: Record<string, string[]> = {};

      (result.duplicateGroups || []).forEach((group: number[], gi: number) => {
        const clusterId = `cluster_${gi}`;
        clusters[clusterId] = group.map((i) => assets[i]?.assetName || String(i));
        const keepIdx: number = result.keepIndices?.[gi] ?? group[0];
        group.forEach((i) => { if (i !== keepIdx) removeSet.add(i); });
      });

      const kept = assets.filter((_, i) => !removeSet.has(i));
      return { kept, duplicateClusters: clusters };
    } catch (err) {
      this.logger.error(`Claude deduplication error: ${err.message}`);
      return { kept: assets, duplicateClusters: {} };
    }
  }
}
