import { Injectable, Logger } from '@nestjs/common';

export interface AiAssetResult {
  assetName: string;
  alternateName: string[];
  value: number | null;
  currency: string | null;
  jurisdiction: string | null;
  latitude: number | null;
  longitude: number | null;
  assetType: string | null;
  valueBasis: string | null;
  parentAssetId: string | null;
  childAssetIds: string[];
  fieldConfidence: Record<string, number>;
  overallConfidence: number;
  sourceEvidence: string[];
  explanation: string;
  validationFlags: string[];
  duplicateClusterId: string | null;
  reviewRecommendation: 'auto-accept' | 'review' | 'reject';
  factType: Record<string, string>;
}

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);

  private readonly systemPrompt = `You are an expert information extraction model for an Asset Extraction Platform.
Given a document text, extract ALL assets mentioned and return ONLY a valid JSON array (no markdown, no commentary).

CRITICAL FILTERING RULES:
Do NOT extract section headings, table of contents entries, page headers, or navigation text as assets.
Only extract items that have an associated monetary value, specific location, or are clearly described as an investment/property/holding.
Skip generic labels: "total", "subtotal", "net", "gross", "other", "n/a", "note", "page", "item".

Each asset object MUST include every field below:
- assetName: string
- alternateName: string[]
- value: number | null
- currency: string | null
- jurisdiction: string | null
- latitude: number | null
- longitude: number | null
- assetType: string | null
- valueBasis: string | null
- parentAssetId: string | null
- childAssetIds: string[]
- fieldConfidence: Record<string, number> (0.0 to 1.0)
- overallConfidence: number (0.0 to 1.0)
- sourceEvidence: string[]
- explanation: string
- validationFlags: string[]
- duplicateClusterId: string | null
- reviewRecommendation: 'auto-accept' | 'review' | 'reject'
- factType: Record<string, 'extracted'|'inferred'|'estimated'|'conflicting'|'unsupported'>

Rules:
- factType per field: 'extracted' if directly stated, 'inferred' if derived, 'estimated' if approximated
- reviewRecommendation: 'auto-accept' if overallConfidence > 0.85, 'review' if 0.5-0.85, 'reject' if < 0.5
Output must be a JSON array. If no assets found, output [].`;

  /**
   * Primary extraction using OpenAI GPT-4o-mini
   */
  async extractWithOpenAI(text: string): Promise<AiAssetResult[]> {
    const apiKey = (process.env.OPENAI_API_KEY ?? '').trim();
    if (!apiKey || apiKey.includes('your_key')) {
      this.logger.warn('OPENAI_API_KEY missing — skipping OpenAI extraction');
      return [];
    }

    try {
      this.logger.log('Calling OpenAI GPT-4o-mini for extraction...');
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          temperature: 0.1,
          max_tokens: 8192,
          messages: [
            { role: 'system', content: this.systemPrompt },
            { role: 'user', content: text },
          ],
        }),
      });

      if (!response.ok) {
        const err = await response.text();
        this.logger.warn(`OpenAI API error ${response.status}: ${err.substring(0, 200)}`);
        return [];
      }

      const data = await response.json() as {
        choices: { message: { content: string } }[];
      };
      const content = data.choices?.[0]?.message?.content ?? '';
      return this.parseJsonResponse(content);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`OpenAI extraction failed: ${msg.substring(0, 200)}`);
      return [];
    }
  }

  /**
   * Secondary validation using Claude (Anthropic) — cross-checks OpenAI results
   */
  async validateWithClaude(text: string, openAiResults: AiAssetResult[]): Promise<AiAssetResult[]> {
    const apiKey = (process.env.ANTHROPIC_API_KEY ?? '').trim();
    if (!apiKey || apiKey.includes('your_key')) {
      this.logger.warn('ANTHROPIC_API_KEY missing — skipping Claude validation');
      return openAiResults;
    }

    try {
      this.logger.log('Calling Claude for validation/cross-check...');

      const validationPrompt = openAiResults.length > 0
        ? `Here are assets already extracted by another model: ${JSON.stringify(openAiResults.slice(0, 5))}

Now independently extract assets from this text and return a JSON array. 
Merge or correct the above results if you find errors. 
Focus especially on: missing assets, wrong coordinates, wrong currency, wrong values.

TEXT:
${text}`
        : text;

      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 8192,
          system: this.systemPrompt,
          messages: [{ role: 'user', content: validationPrompt }],
        }),
      });

      if (!response.ok) {
        const err = await response.text();
        this.logger.warn(`Claude API error ${response.status}: ${err.substring(0, 200)}`);
        return openAiResults;
      }

      const data = await response.json() as {
        content: { type: string; text: string }[];
      };
      const content = data.content?.find((c) => c.type === 'text')?.text ?? '';
      const claudeResults = this.parseJsonResponse(content);

      if (claudeResults.length === 0) return openAiResults;

      // Merge: Claude results take priority for confidence correction
      this.logger.log(`Claude returned ${claudeResults.length} assets for cross-check`);
      return this.mergeAiResults(openAiResults, claudeResults);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Claude validation failed: ${msg.substring(0, 200)}`);
      return openAiResults;
    }
  }

  /**
   * Merge OpenAI + Claude results — prefer higher confidence per asset
   */
  private mergeAiResults(
    openAiResults: AiAssetResult[],
    claudeResults: AiAssetResult[],
  ): AiAssetResult[] {
    const merged = [...openAiResults];

    for (const claudeAsset of claudeResults) {
      const existingIdx = merged.findIndex(
        (a) =>
          a.assetName.trim().toLowerCase() ===
          claudeAsset.assetName.trim().toLowerCase(),
      );

      if (existingIdx === -1) {
        // New asset found by Claude — add it
        merged.push(claudeAsset);
      } else {
        // Same asset — keep higher confidence version
        if (claudeAsset.overallConfidence > merged[existingIdx].overallConfidence) {
          merged[existingIdx] = claudeAsset;
        }
      }
    }

    return merged;
  }

  private parseJsonResponse(raw: string): AiAssetResult[] {
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
      return Array.isArray(parsed) ? (parsed as AiAssetResult[]) : [];
    } catch {
      return [];
    }
  }
}