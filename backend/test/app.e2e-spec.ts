import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { AppModule } from './../src/app.module';

describe('Asset Extraction Platform (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  // ── GET /assets ───────────────────────────────────────────────────

  describe('GET /assets', () => {
    it('should return an array (empty at startup)', async () => {
      const res = await request(app.getHttpServer()).get('/assets').expect(200);
      expect(Array.isArray(res.body)).toBe(true);
    });
  });

  // ── GET /assets/review ────────────────────────────────────────────

  describe('GET /assets/review', () => {
    it('should return an array', async () => {
      const res = await request(app.getHttpServer()).get('/assets/review').expect(200);
      expect(Array.isArray(res.body)).toBe(true);
    });
  });

  // ── DELETE /assets ────────────────────────────────────────────────

  describe('DELETE /assets', () => {
    it('should clear all assets and return ok: true', async () => {
      const res = await request(app.getHttpServer()).delete('/assets').expect(200);
      expect(res.body.ok).toBe(true);
    });
  });

  // ── POST /ingestion/upload (CSV) ──────────────────────────────────

  describe('POST /ingestion/upload', () => {
    it('should reject upload with no file', async () => {
      await request(app.getHttpServer())
        .post('/ingestion/upload')
        .expect(400);
    });

    it('should process a simple CSV file and return assets', async () => {
      // Create a minimal CSV file in temp directory
      const csvContent = [
        'name,value,currency,jurisdiction,latitude,longitude',
        'Test Solar Plant,5000000,USD,"Texas, USA",31.5,-99.0',
        'Sample Wind Farm,3000000,USD,"California, USA",36.7,-118.0',
      ].join('\n');

      const tmpFile = path.join(os.tmpdir(), `test-upload-${Date.now()}.csv`);
      fs.writeFileSync(tmpFile, csvContent);

      try {
        const res = await request(app.getHttpServer())
          .post('/ingestion/upload')
          .attach('file', tmpFile)
          .timeout(30_000);

        expect(res.status).toBe(201);
        expect(res.body).toHaveProperty('jobId');
        expect(res.body).toHaveProperty('assetCount');
        expect(typeof res.body.assetCount).toBe('number');
      } finally {
        fs.unlinkSync(tmpFile);
      }
    });

    it('should return assets in GET /assets after upload', async () => {
      // Clear first
      await request(app.getHttpServer()).delete('/assets');

      const csvContent = [
        'name,value,currency,jurisdiction',
        'E2E Test Asset,1000000,USD,New York',
      ].join('\n');

      const tmpFile = path.join(os.tmpdir(), `test-e2e-${Date.now()}.csv`);
      fs.writeFileSync(tmpFile, csvContent);

      try {
        await request(app.getHttpServer())
          .post('/ingestion/upload')
          .attach('file', tmpFile)
          .timeout(30_000);

        const assetsRes = await request(app.getHttpServer()).get('/assets').expect(200);
        expect(Array.isArray(assetsRes.body)).toBe(true);
      } finally {
        fs.unlinkSync(tmpFile);
      }
    });
  });

  // ── GET /ingestion/jobs/:jobId/status ─────────────────────────────

  describe('GET /ingestion/jobs/:jobId/status', () => {
    it('should return not-found for unknown jobId', async () => {
      const res = await request(app.getHttpServer())
        .get('/ingestion/jobs/non-existent-job-123/status')
        .expect(200);
      expect(res.body.status).toBe('not-found');
    });
  });

  // ── PATCH /assets/:id ────────────────────────────────────────────

  describe('PATCH /assets/:id', () => {
    it('should return 404 for non-existent asset', async () => {
      await request(app.getHttpServer())
        .patch('/assets/non-existent-id')
        .send({ value: 999 })
        .expect(404);
    });
  });

  // ── GET /assets/delta/:jobId ──────────────────────────────────────

  describe('GET /assets/delta/:jobId', () => {
    it('should return empty array for unknown jobId', async () => {
      const res = await request(app.getHttpServer())
        .get('/assets/delta/unknown-job')
        .expect(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body).toHaveLength(0);
    });
  });
});
