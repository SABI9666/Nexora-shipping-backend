import { Storage } from '@google-cloud/storage';
import path from 'path';

// Google Cloud Storage configuration
// For Render deployment, use GOOGLE_APPLICATION_CREDENTIALS_JSON env var
// which contains the service account JSON as a string

let storage: Storage;

if (process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON) {
  // Render deployment: credentials passed as JSON string in env var
  const credentials = JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON);
  storage = new Storage({
    projectId: process.env.GOOGLE_CLOUD_PROJECT_ID,
    credentials,
  });
} else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
  // Local development: path to service account key file
  storage = new Storage({
    projectId: process.env.GOOGLE_CLOUD_PROJECT_ID,
    keyFilename: process.env.GOOGLE_APPLICATION_CREDENTIALS,
  });
} else {
  // Fallback: uses Application Default Credentials (ADC)
  storage = new Storage({
    projectId: process.env.GOOGLE_CLOUD_PROJECT_ID,
  });
}

export const bucket = storage.bucket(process.env.GCS_BUCKET_NAME || 'nexora-shipping-docs');

export async function uploadFileToGCS(
  fileBuffer: Buffer,
  originalName: string,
  mimeType: string,
  folder: string = 'documents'
): Promise<{ url: string; gcsPath: string }> {
  const timestamp = Date.now();
  const safeFileName = originalName.replace(/[^a-zA-Z0-9.-]/g, '_');
  const gcsPath = `${folder}/${timestamp}-${safeFileName}`;

  const file = bucket.file(gcsPath);

  await file.save(fileBuffer, {
    metadata: {
      contentType: mimeType,
      cacheControl: 'public, max-age=31536000',
    },
    public: false, // Keep private, use signed URLs
  });

  const url = `https://storage.googleapis.com/${bucket.name}/${gcsPath}`;
  return { url, gcsPath };
}

export async function getSignedUrl(gcsPath: string, expiresInMinutes: number = 60): Promise<string> {
  const file = bucket.file(gcsPath);
  const [signedUrl] = await file.getSignedUrl({
    version: 'v4',
    action: 'read',
    expires: Date.now() + expiresInMinutes * 60 * 1000,
  });
  return signedUrl;
}

export async function deleteFileFromGCS(gcsPath: string): Promise<void> {
  const file = bucket.file(gcsPath);
  await file.delete({ ignoreNotFound: true });
}

export default storage;
