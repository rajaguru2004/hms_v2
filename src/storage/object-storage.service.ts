import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { AppException } from '../common/exceptions/app.exception';
import { ErrorCodes } from '../common/exceptions/error-codes';

/** What `uploadObject` answers: the key to store, and the URL to show. */
export interface StoredObject {
  /** The bucket-relative key. This is what belongs in a database column. */
  key: string;
  /** The direct URL. Useless on a private bucket — see `getReadUrl`. */
  url: string;
}

/**
 * How long a read URL may live, in seconds.
 *
 * Clamped rather than trusted because the caller is deciding how long a
 * medical document stays readable by anyone holding a link. The floor stops a
 * URL expiring before a slow phone finishes fetching it; the ceiling is the
 * point past which "short-lived" stops being true.
 */
const MIN_READ_URL_TTL_SECONDS = 30;
const MAX_READ_URL_TTL_SECONDS = 3600;

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
   * Kept returning a bare string because that is what the radiology upload
   * route already hands its client. Anything that needs to read the object
   * back later wants `uploadObject` instead: a URL into a private bucket is
   * not a way to fetch anything.
   */
  async upload(
    file: Express.Multer.File,
    options: {
      organizationId: string;
      folder: string;
      allowedMimeTypes: readonly string[];
    },
  ): Promise<string> {
    const stored = await this.uploadObject(file, options);
    return stored.url;
  }

  /**
   * Stores [file] and answers with both the key and the URL.
   *
   * [allowedMimeTypes] is re-checked here rather than only in the route's
   * `fileFilter`: this is a public service API and the next caller may not
   * come through that route.
   */
  async uploadObject(
    file: Express.Multer.File,
    options: {
      organizationId: string;
      folder: string;
      allowedMimeTypes: readonly string[];
    },
  ): Promise<StoredObject> {
    if (!file) {
      throw new AppException('No file uploaded', ErrorCodes.BAD_REQUEST);
    }

    if (!options.allowedMimeTypes.includes(file.mimetype)) {
      throw new AppException(
        `Unsupported file type "${file.mimetype}". Allowed types: ${options.allowedMimeTypes.join(', ')}.`,
        ErrorCodes.VALIDATION_ERROR,
      );
    }

    const extension = safeExtension(file.originalname);
    const suffix = Math.random().toString(36).substring(2, 8);
    const key = `${options.organizationId}/${options.folder}/${Date.now()}-${suffix}${extension}`;

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

    return { key, url: this.publicUrl(key) };
  }

  /**
   * A signed, expiring URL that reads one object.
   *
   * The bucket is private, so until this existed nothing the API stored could
   * ever be shown back to the person who uploaded it — a patient could post a
   * photograph of their prescription and then had no way to see the evidence
   * the extraction was drawn from. Proxying the bytes through Nest would have
   * worked too and is the wrong trade: it puts every page of every scan through
   * the API's event loop to save a signature.
   *
   * This method answers for any key it is given. Deciding *whose* key it is
   * belongs to the caller, which is the only layer that knows the requester —
   * `PatientDocumentsService` loads the row scoped to organisation and patient
   * first, and signs only the key it found there.
   */
  async getReadUrl(key: string, ttlSeconds: number): Promise<string> {
    if (!key) {
      throw new AppException('No object key supplied', ErrorCodes.BAD_REQUEST);
    }

    const expiresIn = Math.min(
      MAX_READ_URL_TTL_SECONDS,
      Math.max(MIN_READ_URL_TTL_SECONDS, Math.trunc(ttlSeconds)),
    );

    try {
      return await getSignedUrl(
        this.client,
        new GetObjectCommand({ Bucket: this.bucket, Key: key }),
        { expiresIn },
      );
    } catch (error) {
      this.logger.error('Failed to sign an S3 read URL', error);
      throw new AppException(
        'Failed to prepare the document for viewing',
        ErrorCodes.S3_SIGN_FAILED,
      );
    }
  }

  /** The unsigned URL for a key. Resolvable only if the bucket is public. */
  publicUrl(key: string): string {
    const base = this.endpoint.endsWith('/')
      ? this.endpoint.slice(0, -1)
      : this.endpoint;
    return `${base}/${this.bucket}/${key}`;
  }
}

/**
 * The file extension, or none at all.
 *
 * `originalname` is whatever the client typed into the multipart part, and it
 * used to reach the key as `name.split('.').pop()`. That is fine for
 * `scan.jpg` and not fine for `scan.jpg/../../../other-org/secret`, which is
 * still "the last segment after a dot" and would have written outside the
 * organisation's prefix. Only a short alphanumeric run survives; anything else
 * gets no extension, which costs a content-type hint and nothing else.
 */
function safeExtension(originalname: string | undefined): string {
  const candidate = (originalname ?? '').split('.').pop() ?? '';
  return /^[A-Za-z0-9]{1,8}$/.test(candidate)
    ? `.${candidate.toLowerCase()}`
    : '';
}
