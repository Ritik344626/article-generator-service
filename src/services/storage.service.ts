import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { createReadStream, promises as fsPromises } from 'fs';
import path from 'path';
import logger from '../utils/logger';

interface UploadResult {
    key: string;
    url: string;
}

export class CloudflareR2Service {
    private readonly bucket: string;
    private readonly client: S3Client;
    private readonly accountId: string;
    private readonly publicBaseUrl: string;

    constructor() {
        if (
            !process.env.CLOUDFLARE_R2_BUCKET ||
            !process.env.CLOUDFLARE_R2_ACCESS_KEY_ID ||
            !process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY ||
            !process.env.CLOUDFLARE_R2_ACCOUNT_ID
        ) {
            throw new Error('Cloudflare R2 environment variables missing');
        }

        this.bucket = process.env.CLOUDFLARE_R2_BUCKET;
        this.accountId = process.env.CLOUDFLARE_R2_ACCOUNT_ID;

        // S3 endpoint
        const endpoint = `https://${this.accountId}.r2.cloudflarestorage.com`;

        // If custom domain (optional)
        this.publicBaseUrl =
            process.env.CLOUDFLARE_R2_PUBLIC_URL ||
            `https://${this.accountId}.r2.cloudflarestorage.com/${this.bucket}`;

        this.client = new S3Client({
            region: 'auto',
            endpoint,
            credentials: {
                accessKeyId: process.env.CLOUDFLARE_R2_ACCESS_KEY_ID,
                secretAccessKey: process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY,
            },
        });
    }

    public isEnabled(): boolean {
        return true;
    }

    public async uploadPdfFromPath(filePath: string, keyPrefix?: string): Promise<UploadResult> {
        const fileName = path.basename(filePath);
        const key = path.posix.join(keyPrefix || 'pdf', `${Date.now()}-${fileName}`);

        await this.uploadWithS3(filePath, key);

        return {
            key,
            url: this.buildPublicUrl(key),
        };
    }

    public async deleteLocalFile(filePath: string): Promise<void> {
        try {
            await fsPromises.unlink(filePath);
        } catch (err) {
            logger.warn('Failed to delete temp file', err);
        }
    }

    private buildPublicUrl(key: string): string {
        const sanitizedKey = key.replace(/^\/+/, '');

        if (this.publicBaseUrl) {
            return `${this.publicBaseUrl.replace(/\/+$/, '')}/${sanitizedKey}`;
        }

        if (!this.bucket || !this.accountId) {
            throw new Error('Cloudflare R2 bucket/account configuration missing');
        }

        return `https://${this.accountId}.r2.cloudflarestorage.com/${this.bucket}/${sanitizedKey}`;
    }

    private async uploadWithS3(filePath: string, key: string): Promise<void> {
        const fileStream = createReadStream(filePath);

        await this.client.send(
            new PutObjectCommand({
                Bucket: this.bucket,
                Key: key,
                Body: fileStream,
                ContentType: 'application/pdf',
            })
        );

        logger.info(`Uploaded PDF to R2 → ${key}`);
    }
}

export default CloudflareR2Service;
