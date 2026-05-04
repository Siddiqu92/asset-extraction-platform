import { Body, Controller, Post } from '@nestjs/common';
import { ExtractionService } from './extraction.service';
import { Asset } from '../assets/asset.entity';

type ExtractTextDto = {
  text: string;
  jobId: string;
  sourceFile: string;
};

@Controller('extraction')
export class ExtractionController {
  constructor(private readonly extractionService: ExtractionService) {}

  @Post('extract-text')
  async extractText(@Body() body: ExtractTextDto): Promise<Asset[]> {
    return this.extractionService.extractAssets({
      text: body.text ?? '',
      jobId: body.jobId ?? '',
      sourceFile: body.sourceFile ?? '',
    });
  }
}

