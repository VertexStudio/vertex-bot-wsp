import { Client as MinioClient } from "minio";
import "dotenv/config";

export const minioClient = new MinioClient({
  endPoint: process.env.MINIO_ENDPOINT,
  port: parseInt(process.env.MINIO_PORT),
  useSSL: process.env.MINIO_USE_SSL === "true",
  accessKey: process.env.MINIO_ROOT_USER,
  secretKey: process.env.MINIO_ROOT_PASSWORD,
  region: process.env.MINIO_REGION,
});
