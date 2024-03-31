import { AbstractFileService, Logger } from '@medusajs/medusa';
import {
  DeleteFileType,
  FileServiceGetUploadStreamResult,
  FileServiceUploadResult,
  GetUploadedFileType,
  UploadStreamDescriptorType,
} from '@medusajs/types';
import { SupabaseClient, createClient } from '@supabase/supabase-js';
import { randomUUID } from 'crypto';
import { createReadStream } from 'fs';
import { PassThrough } from 'stream';

class SupabaseFIleService extends AbstractFileService {
  protected readonly logger: Logger;
  protected readonly storageClient: SupabaseClient;
  protected readonly bucket: string;
  protected readonly signedUrlExpiration = 120;
  protected readonly storageUrl: string;

  constructor(container: any, config: Record<string, unknown> | undefined) {
    super(container);

    const bucket: string =
      (config?.bucketName as string) || process.env.BUCKET_NAME || '';
    const projectURL =
      (config?.projectURL as string) || process.env.SUPABASE_URL || '';
    const apiKey =
      (config?.apiKey as string) || process.env.SUPABASE_SERVICE_KEY || '';
    const referenceID: string =
      (config?.referenceID as string) || process.env.STORAGE_BUCKET_REF || '';
    this.logger = container.logger as Logger;
    this.bucket = bucket;
    this.storageUrl =
      process.env.NODE_ENV === 'production'
        ? `https://${referenceID}.supabase.co/storage/v1/object/public`
        : // CHANGE THIS FOR YOUR OWN SUPABASE LOCAL DEV
          'http://127.0.0.1:54321/storage/v1/object/public';
    this.storageClient = createClient(projectURL, apiKey);
  }

  async upload(
    fileData: Express.Multer.File
  ): Promise<FileServiceUploadResult> {
    const { data, error } = await this.storageClient.storage
      .from(this.bucket)
      .upload(
        `assets/${randomUUID()}.${fileData.originalname.split('.').pop()}`,
        createReadStream(fileData.path),
        { contentType: fileData.mimetype, duplex: 'half' }
      );

    if (!error) {
      this.logger.info(data.path);
    }
    if (error) {
      this.logger.error(error);
      throw new Error('Error uploading file');
    }
    return {
      key: data.path,
      url: `${this.storageUrl}/${this.bucket}/${data.path}`,
    };
  }

  async uploadProtected(
    fileData: Express.Multer.File
  ): Promise<FileServiceUploadResult> {
    const { data, error } = await this.storageClient.storage
      .from(this.bucket)
      .upload(
        `private/${randomUUID()}.${fileData.originalname.split('.').pop()}`,
        createReadStream(fileData.path),
        { contentType: fileData.mimetype, duplex: 'half' }
      );

    if (error) {
      this.logger.error(error);
      throw new Error('Error uploading file');
    }

    const signedURLResult = await this.storageClient.storage
      .from(this.bucket)
      .createSignedUrl(data.path, this.signedUrlExpiration);

    if (signedURLResult.error) {
      this.logger.error(signedURLResult.error);
      throw new Error('Error getting presigned url');
    }

    return {
      key: data.path,
      url: signedURLResult.data.signedUrl,
    };
  }

  async delete(fileData: DeleteFileType): Promise<void> {
    const { data, error } = await this.storageClient.storage
      .from(this.bucket)
      .remove(['assets/34ecd528-0377-4dfa-b3f4-1f3aa9018b8a.jpg']);

    if (data) {
      this.logger.info(fileData.fileKey);
    }
    if (error) {
      this.logger.error(error);
      throw new Error('Error deleting file');
    }
  }

  async getUploadStreamDescriptor(
    fileData: UploadStreamDescriptorType
  ): Promise<FileServiceGetUploadStreamResult> {
    const pass = new PassThrough();
    const key = fileData.isPrivate
      ? `private/${randomUUID()}.${fileData.ext}`
      : `public/${randomUUID()}.${fileData.ext}`;

    const promise = this.storageClient.storage
      .from(this.bucket)
      .upload(key, pass, {
        contentType: fileData.contentType as string,
        duplex: 'half',
      });

    return {
      writeStream: pass,
      promise,
      url: `${this.storageUrl}/${this.bucket}/${key}`,
      fileKey: key,
    };
  }

  async getDownloadStream(
    fileData: GetUploadedFileType
  ): Promise<NodeJS.ReadableStream> {
    const { data, error } = await this.storageClient.storage
      .from(this.bucket)
      .download(fileData.fileKey);

    if (error) {
      this.logger.error('ERROR GETTING file', error);
      throw new Error('Error getting download stream');
    }
    return data.stream();
  }

  async getPresignedDownloadUrl(
    fileData: GetUploadedFileType
  ): Promise<string> {
    const { data, error } = await this.storageClient.storage
      .from(this.bucket)
      .createSignedUrl(fileData.fileKey, this.signedUrlExpiration);

    this.logger.info(fileData);
    if (error) {
      this.logger.error(error);
      throw new Error('Error getting presigned url');
    }

    return data.signedUrl;
  }
}

export default SupabaseFIleService;
