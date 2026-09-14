import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { AppException } from '../common/exceptions/app.exception';
import { ErrorCodes } from '../common/exceptions/error-codes';

/**
 * The one place this API puts a file.
 *
 * It existed inside `RadiologyService` — the S3 client, the bucket, the key
 * scheme and the error handling, all private to the module that happened to
 * need it first. The next route that needed to store something (a hospital's
 * logo) could either couple itself to radiology or paste the client again, and
 * the second copy is how two routes end up writing to two different buckets.
 */
@Injectable()
export class ObjectStorageService {
  private readonly logger = new Logger(ObjectStorageService.name);
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly endpoint: string;

  constructor(private readonly configService: ConfigService) {
    const endpoint =
      this.configService.get<string>('S3_ENDPOINT') ||
      'https://hms.s3.skillhiveinnovations.com';
    const accessKeyId =
      this.configService.get<string>('S3_ACCESS_KEY') || 'minio_admin';
    const secretAccessKey =
      this.configService.get<string>('S3_SECRET_KEY') || 'minio_password';

    this.bucket = this.configService.get<string>('S3_BUCKET') || 'hmsbucket';
    this.endpoint = endpoint;
    this.client = new S3Client({
      endpoint,
      region: 'us-east-1',
      credentials: { accessKeyId, secretAccessKey },
      forcePathStyle: true,
    });
  }

  /**
   * Stores [file] under `<organizationId>/<folder>/` and answers with its URL.
   *
   * [allowedMimeTypes] is re-checked here rather than only in the route's
   * `fileFilter`: this is a public service API and the next caller may not
   * come through that route.
   */
  async upload(
    file: Express.Multer.File,
    options: {
      organizationId: string;
      folder: string;
      allowedMimeTypes: readonly string[];
    },
  ): Promise<string> {
    if (!file) {
      throw new AppException('No file uploaded', ErrorCodes.BAD_REQUEST);
    }

    if (!options.allowedMimeTypes.includes(file.mimetype)) {
      throw new AppException(
        `Unsupported file type "${file.mimetype}". Allowed types: ${options.allowedMimeTypes.join(', ')}.`,
        ErrorCodes.VALIDATION_ERROR,
      );
    }

    const extension = file.originalname.split('.').pop() || '';
    const suffix = Math.random().toString(36).substring(2, 8);
    const key = `${options.organizationId}/${options.folder}/${Date.now()}-${suffix}.${extension}`;

    try {
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Body: file.buffer,
          ContentType: file.mimetype,
        }),
      );
    } catch (error) {
      this.logger.error('Failed to upload file to S3', error);
      throw new AppException(
        'Failed to upload file to S3',
        ErrorCodes.S3_UPLOAD_FAILED,
      );
    }

    const base = this.endpoint.endsWith('/')
      ? this.endpoint.slice(0, -1)
      : this.endpoint;
    return `${base}/${this.bucket}/${key}`;
  }
}
