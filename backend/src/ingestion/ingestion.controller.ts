import {
  Controller,
  Get,
  Param,
  Post,
  Req,
  Res,
  UseInterceptors,
  UploadedFile,
  UploadedFiles,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor, FilesInterceptor } from '@nestjs/platform-express';
import type { Request, Response } from 'express';
import { IngestionService } from './ingestion.service';

@Controller('ingestion')
export class IngestionController {
  constructor(private readonly ingestionService: IngestionService) {}

  @Get('jobs/:jobId/status')
  getJobStatus(@Param('jobId') jobId: string) {
    return this.ingestionService.getJobStatus(jobId);
  }

  @Post('upload')
  @UseInterceptors(FileInterceptor('file'))
  async uploadFile(
    @UploadedFile() file: Express.Multer.File,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    if (!file) {
      throw new BadRequestException('No file uploaded');
    }
    req.socket.setTimeout(600_000);
    res.socket?.setTimeout(600_000);
    return this.ingestionService.processFile(file);
  }

  @Post('upload-multiple')
  @UseInterceptors(FilesInterceptor('files', 10))
  async uploadMultiple(@UploadedFiles() files: Express.Multer.File[]) {
    if (!files || files.length === 0) {
      throw new BadRequestException('No files uploaded');
    }
    const results = await Promise.all(
      files.map((file) => this.ingestionService.processFile(file)),
    );
    return results;
  }
}